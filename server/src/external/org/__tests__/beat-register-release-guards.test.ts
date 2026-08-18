/*
 * external/org/__tests__/beat-register-release-guards.test.ts — the
 * symlink/vanish-window/lock-contention side of the release action's test
 * suite, split out of `beat-register-release.test.ts` to stay under the
 * 300-line file guideline (iterate-2026-08-18-org-route-beat-register).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import * as lockfile from "proper-lockfile";

import { registerBeatRegisterReleaseRoute } from "../beat-register-release.js";

// vi.mock is hoisted above these imports. `importOriginal` gives back the
// real module so every test except the one below (which overrides `lock`
// for a single call via mockImplementationOnce) behaves exactly as if this
// mock were absent -- ESM module namespaces are read-only, so `vi.spyOn`
// cannot wrap `lockfile.lock` directly (see vitest#3300).
vi.mock("proper-lockfile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("proper-lockfile")>();
  return { ...actual, lock: vi.fn(actual.lock) };
});

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function entry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sessionId: SESSION_ID,
    beatId: "beat-1",
    leadId: "acme-lead",
    pid: 1234,
    startedAt: "2026-08-18T00:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

const FAST_LOCK_OPTIONS = {
  stale: 300_000,
  update: 1_000,
  retries: { retries: 1, minTimeout: 20, maxTimeout: 20, factor: 1 },
  realpath: true as const,
};

describe("POST .../beat-register/release — symlink guards, TOCTOU vanish-windows, lock contention", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-beat-release-guards-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function registerPath(leadId = "acme-lead"): string {
    return path.join(leadsRoot, leadId, "beat-register.json");
  }

  function auditPath(leadId = "acme-lead"): string {
    return path.join(leadsRoot, leadId, "audit.jsonl");
  }

  function writeRegister(entries: unknown[], leadId = "acme-lead"): void {
    mkdirSync(path.join(leadsRoot, leadId), { recursive: true });
    writeFileSync(registerPath(leadId), JSON.stringify({ version: 1, entries }), "utf8");
  }

  function readRegister(leadId = "acme-lead"): { version: 1; entries: Array<Record<string, unknown>> } {
    return JSON.parse(readFileSync(registerPath(leadId), "utf8"));
  }

  function app(): Hono {
    const a = new Hono();
    registerBeatRegisterReleaseRoute(a, { leadsRoot, lockOptions: FAST_LOCK_OPTIONS });
    return a;
  }

  function post(a: Hono, leadId: string, body: unknown) {
    return a.request(`/api/external/org/leads/${leadId}/beat-register/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects a symlinked register file (mocked lstat) 403, no write attempted", async () => {
    writeRegister([entry()]);
    const a = new Hono();
    registerBeatRegisterReleaseRoute(a, {
      leadsRoot,
      lockOptions: FAST_LOCK_OPTIONS,
      lstatSync: (p) =>
        path.basename(p) === "beat-register.json" ? { isSymbolicLink: () => true } : lstatSync(p),
    });
    const res = await post(a, "acme-lead", { sessionId: SESSION_ID, reason: "x" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("symlink_forbidden");
    const register = readRegister();
    expect(register.entries[0].closedAt).toBeNull();
  });

  it("code-review fix: a register that vanishes between existsSync and the pre-lock lstat (TOCTOU) is a graceful 404 not-found, not a 500", async () => {
    writeRegister([entry()]);
    const a = new Hono();
    registerBeatRegisterReleaseRoute(a, {
      leadsRoot,
      lockOptions: FAST_LOCK_OPTIONS,
      lstatSync: (p) => {
        if (path.basename(p) === "beat-register.json") {
          const err = new Error("ENOENT") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return lstatSync(p);
      },
    });
    const res = await post(a, "acme-lead", { sessionId: SESSION_ID, reason: "x" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, reason: "not-found", detail: SESSION_ID });
  });

  it("doubt-review fix: a register that vanishes between the pre-lock guard's PASS and lockfile.lock() itself (realpath ENOENT) is a graceful 404 not-found, not a 500", async () => {
    writeRegister([entry()]);
    // The pre-lock guard (checkRegisterReachable) passes normally -- the
    // real file exists and both `lstat` and the containment `realpathSync`
    // succeed against it. The vanish-window under test is strictly BETWEEN
    // that pass and the `lockfile.lock()` call, which is a window no
    // filesystem-level lstat mock can land in deterministically (the two
    // syscalls are back-to-back with no test-observable seam) -- so this
    // spies on `lockfile.lock` itself, precisely reproducing the ENOENT
    // `proper-lockfile`'s own `fs.realpath(file, ...)` raises when the
    // target has disappeared, without touching the unrelated (pre-existing,
    // out of scope for this fix) lstat-vs-realpathSync gap inside
    // `guardExistingTarget` that a real mid-flight delete would also hit.
    vi.mocked(lockfile.lock).mockImplementationOnce(() => {
      const err = new Error("ENOENT: no such file or directory, lstat") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      return Promise.reject(err);
    });
    const res = await post(app(), "acme-lead", { sessionId: SESSION_ID, reason: "x" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, reason: "not-found", detail: SESSION_ID });
    // The register was never touched -- the outcome was decided before any
    // lock was held.
    const register = readRegister();
    expect(register.entries[0].closedAt).toBeNull();
  });

  it("409s with beat_register_locked when the register is already locked (real proper-lockfile contention)", async () => {
    writeRegister([entry()]);
    const release = await lockfile.lock(registerPath(), FAST_LOCK_OPTIONS);
    try {
      const res = await post(app(), "acme-lead", { sessionId: SESSION_ID, reason: "x" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("beat_register_locked");
    } finally {
      await release();
    }
  });

  it("code-review fix: a symlinked audit.jsonl (mocked lstat) is rejected, never written through — even though the register mutation itself already committed", async () => {
    writeRegister([entry()]);
    const a = new Hono();
    registerBeatRegisterReleaseRoute(a, {
      leadsRoot,
      lockOptions: FAST_LOCK_OPTIONS,
      lstatSync: (p) =>
        path.basename(p) === "audit.jsonl" ? { isSymbolicLink: () => true } : lstatSync(p),
    });
    const res = await post(a, "acme-lead", { sessionId: SESSION_ID, reason: "x" });
    expect(res.status).toBe(403);
    // MIRRORED LIMITATION (plan-review PR-9): the register mutation already
    // committed inside the lock before the (post-lock) audit append was
    // attempted and rejected — this is the disclosed non-atomicity gap,
    // not a new bug this test introduces.
    const register = readRegister();
    expect(register.entries[0].closedAt).not.toBeNull();
    // The guard runs BEFORE any write to the file — no audit line, even
    // though `ensureAuditFile` created it as an empty placeholder.
    expect(readFileSync(auditPath(), "utf8")).toBe("");
  });
});

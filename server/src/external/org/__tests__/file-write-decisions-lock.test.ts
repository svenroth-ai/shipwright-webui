/*
 * file-write-decisions-lock.test.ts — plan-review regression guard: a
 * generic PUT to `decision_log.md` / `decisions-proposed.md` must go
 * through the SAME `withDecisionsLock` the countersign action uses, not
 * bypass it. Proven by injecting a fake lock and asserting it is invoked
 * for the two protected kinds and NOT for an ordinary doc.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { registerOrgFileWrite } from "../file-write.js";
import { fileFingerprint } from "../../file/_helpers.js";
import { OrgSymlinkEscapeError, type DecisionsLockContext } from "../decisions-lock.js";
import { errorHandler } from "../../../middleware/error-handler.js";

describe("PUT /api/external/org/file — locked kinds route through withDecisionsLock", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-write-lock-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function appWithSpyLock(calls: string[]): Hono {
    const a = new Hono();
    registerOrgFileWrite(a, {
      leadsRoot,
      withDecisionsLock: async (_deps, fn) => {
        calls.push("locked");
        return fn({} as DecisionsLockContext);
      },
    });
    return a;
  }

  const url = (p: string) => `/api/external/org/file?path=${encodeURIComponent(p)}`;

  it("PUT decision_log.md acquires the lock", async () => {
    const p = path.join(leadsRoot, "decision_log.md");
    writeFileSync(p, "original", "utf8");
    const etag = `"${fileFingerprint(readFileSync(p))}"`;
    const calls: string[] = [];

    const res = await appWithSpyLock(calls).request(url("decision_log.md"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: "updated",
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["locked"]);
  });

  it("PUT decisions-proposed.md acquires the lock", async () => {
    const p = path.join(leadsRoot, "decisions-proposed.md");
    writeFileSync(p, "original", "utf8");
    const etag = `"${fileFingerprint(readFileSync(p))}"`;
    const calls: string[] = [];

    const res = await appWithSpyLock(calls).request(url("decisions-proposed.md"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: "updated",
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["locked"]);
  });

  it("PUT conventions.md does NOT acquire the lock (no cross-process contender)", async () => {
    const p = path.join(leadsRoot, "conventions.md");
    writeFileSync(p, "original", "utf8");
    const etag = `"${fileFingerprint(readFileSync(p))}"`;
    const calls: string[] = [];

    const res = await appWithSpyLock(calls).request(url("conventions.md"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: "updated",
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("end-to-end with the REAL lock: PUT decision_log.md still succeeds normally", async () => {
    const p = path.join(leadsRoot, "decision_log.md");
    writeFileSync(p, "original", "utf8");
    const etag = `"${fileFingerprint(readFileSync(p))}"`;

    const a = new Hono();
    registerOrgFileWrite(a, { leadsRoot });
    const res = await a.request(url("decision_log.md"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: "updated via real lock",
    });
    expect(res.status).toBe(200);
    expect(readFileSync(p, "utf8")).toBe("updated via real lock");
  });

  it(
    "external-review fix: PUT to a missing decisions-proposed.md is 404, NOT an " +
      "auto-vivifying create — the lock's own ensureFile() need (so " +
      "proper-lockfile has something to lock) must not leak into the generic " +
      "PUT's edit-existing-only contract",
    async () => {
      // Not created in beforeEach — this is the one allowlisted kind that is
      // also the lock's own target; withDecisionsLock's ensureFile would
      // create it empty before the lock is taken if reached, but the
      // pre-lock existence probe must return 404 before that ever happens.
      const emptyEtag = `"${fileFingerprint(Buffer.from(""))}"`;
      const a = new Hono();
      registerOrgFileWrite(a, { leadsRoot });
      const res = await a.request(url("decisions-proposed.md"), {
        method: "PUT",
        headers: { "If-Match": emptyEtag },
        body: "first proposal",
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("not_found");
      expect(existsSync(path.join(leadsRoot, "decisions-proposed.md"))).toBe(false);
    },
  );

  it(
    "doubt-review fix: lock contention (ELOCKED) on a locked-kind PUT surfaces " +
      "as the family-standard retryable 409 via the app-level errorHandler " +
      "(CLAUDE.md DO-NOT #6) — not a bare 500",
    async () => {
      const p = path.join(leadsRoot, "decision_log.md");
      writeFileSync(p, "original", "utf8");
      const etag = `"${fileFingerprint(readFileSync(p))}"`;

      const a = new Hono();
      a.onError(errorHandler);
      registerOrgFileWrite(a, {
        leadsRoot,
        withDecisionsLock: async () => {
          throw Object.assign(new Error("Lock file is already being held"), {
            code: "ELOCKED",
          });
        },
      });

      const res = await a.request(url("decision_log.md"), {
        method: "PUT",
        headers: { "If-Match": etag },
        body: "updated",
      });
      expect(res.status).toBe(409);
    },
  );

  it(
    "doubt-review fix: a symlinked decisions-proposed.md/decision_log.md " +
      "detected INSIDE withDecisionsLock (not the PUT target itself) now maps " +
      "to 403 symlink_forbidden instead of falling through to a generic 500 — " +
      "previously uncaught here, unlike countersign.ts's identical guard",
    async () => {
      const p = path.join(leadsRoot, "decision_log.md");
      writeFileSync(p, "original", "utf8");
      const etag = `"${fileFingerprint(readFileSync(p))}"`;

      const a = new Hono();
      a.onError(errorHandler);
      registerOrgFileWrite(a, {
        leadsRoot,
        withDecisionsLock: async () => {
          throw new OrgSymlinkEscapeError(path.join(leadsRoot, "decisions-proposed.md"));
        },
      });

      const res = await a.request(url("decision_log.md"), {
        method: "PUT",
        headers: { "If-Match": etag },
        body: "updated",
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("symlink_forbidden");
    },
  );
});

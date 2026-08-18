import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { registerBeatRegisterReleaseRoute } from "../beat-register-release.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION_ID = "22222222-2222-4222-8222-222222222222";

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

describe("POST /api/external/org/leads/:leadId/beat-register/release", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-beat-release-fixture-"));
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

  function readAuditLines(leadId = "acme-lead"): Array<Record<string, unknown>> {
    const raw = readFileSync(auditPath(leadId), "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  }

  function app(now?: () => Date): Hono {
    const a = new Hono();
    registerBeatRegisterReleaseRoute(a, { leadsRoot, now, lockOptions: FAST_LOCK_OPTIONS });
    return a;
  }

  function post(a: Hono, leadId: string, body: unknown) {
    return a.request(`/api/external/org/leads/${leadId}/beat-register/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("releases an open entry: 200 recovered:true, register closed, exactly one audit line", async () => {
    writeRegister([entry()]);
    const now = () => new Date("2026-08-18T02:00:00.000Z");
    const res = await post(app(now), "acme-lead", { sessionId: SESSION_ID, reason: "hung beat" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.recovered).toBe(true);
    expect(typeof body.residualLockWarning).toBe("string");

    const register = readRegister();
    expect(register.entries[0].closedAt).toBe("2026-08-18T02:00:00.000Z");

    const lines = readAuditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe("beat_recovered");
    expect(lines[0].lead_id).toBe("acme-lead");
    expect(lines[0].beat_id).toBe("beat-1");
    expect(lines[0].data).toEqual({ sessionId: SESSION_ID, reason: "hung beat" });
  });

  it("creates audit.jsonl fresh (with exactly one line) when it doesn't exist yet", async () => {
    writeRegister([entry()]);
    expect(() => readFileSync(auditPath(), "utf8")).toThrow();
    const res = await post(app(), "acme-lead", { sessionId: SESSION_ID, reason: "hung beat" });
    expect(res.status).toBe(200);
    expect(readAuditLines()).toHaveLength(1);
  });

  it("second call on an already-closed entry: 200 recovered:false, no new audit line", async () => {
    writeRegister([entry()]);
    const a = app();
    await post(a, "acme-lead", { sessionId: SESSION_ID, reason: "first" });
    expect(readAuditLines()).toHaveLength(1);

    const res2 = await post(a, "acme-lead", { sessionId: SESSION_ID, reason: "second" });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2).toEqual({ ok: true, recovered: false });
    expect(readAuditLines()).toHaveLength(1);
  });

  it("code-review fix: a duplicate sessionId where the FIRST match is closed and the SECOND is still open returns 409 fault, and neither entry is mutated", async () => {
    const closed = entry({ closedAt: "2026-08-18T01:00:00.000Z" });
    const open = entry(); // same sessionId, still open
    writeRegister([closed, open]);
    const res = await post(app(), "acme-lead", { sessionId: SESSION_ID, reason: "x" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ ok: false, reason: "fault", detail: SESSION_ID });
    // Neither entry was touched, and no audit line was written.
    const register = readRegister();
    expect(register.entries).toEqual([closed, open]);
    expect(() => readFileSync(auditPath(), "utf8")).toThrow();
  });

  it("unknown sessionId with an existing register: 404 not-found", async () => {
    writeRegister([entry()]);
    const res = await post(app(), "acme-lead", { sessionId: OTHER_SESSION_ID, reason: "x" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, reason: "not-found", detail: OTHER_SESSION_ID });
  });

  it("unknown sessionId, register file absent entirely: 404 not-found, nothing created", async () => {
    const res = await post(app(), "acme-lead", { sessionId: SESSION_ID, reason: "x" });
    expect(res.status).toBe(404);
    expect(() => readFileSync(registerPath(), "utf8")).toThrow();
    expect(() => readFileSync(auditPath(), "utf8")).toThrow();
  });

  it("400s on a missing body", async () => {
    writeRegister([entry()]);
    const a = new Hono();
    registerBeatRegisterReleaseRoute(a, { leadsRoot, lockOptions: FAST_LOCK_OPTIONS });
    const res = await a.request("/api/external/org/leads/acme-lead/beat-register/release", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("400s on an invalid sessionId shape", async () => {
    writeRegister([entry()]);
    const res = await post(app(), "acme-lead", { sessionId: "not-a-uuid", reason: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("sessionId_invalid");
  });

  it("400s on a missing/empty reason", async () => {
    writeRegister([entry()]);
    const res = await post(app(), "acme-lead", { sessionId: SESSION_ID, reason: "" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("reason_invalid");
  });

  it("doubt-review fix: an uppercase-but-otherwise-valid UUID no longer passes validation (register entries are exact-match, always lowercase)", async () => {
    // SESSION_ID's hex digits are all decimal (no a-f letters), so
    // .toUpperCase() on it would be a no-op -- use a UUID with actual hex
    // letters so casing the string genuinely changes it.
    const hexSessionId = "aabbccdd-eeff-4abc-8def-abcdefabcdef";
    writeRegister([entry({ sessionId: hexSessionId })]);
    const res = await post(app(), "acme-lead", {
      sessionId: hexSessionId.toUpperCase(),
      reason: "x",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("sessionId_invalid");
    // The real (lowercase) entry was never touched.
    const register = readRegister();
    expect(register.entries[0].closedAt).toBeNull();
  });

  it("resolves parent_lead_id from org-chart.json when available", async () => {
    writeRegister([entry()]);
    writeFileSync(
      path.join(leadsRoot, "org-chart.json"),
      JSON.stringify({
        leads: { "acme-lead": { triggers: { cron: "0 9 * * *" }, reports_to: "parent-lead" } },
      }),
      "utf8",
    );
    await post(app(), "acme-lead", { sessionId: SESSION_ID, reason: "x" });
    const lines = readAuditLines();
    expect(lines[0].parent_lead_id).toBe("parent-lead");
  });

  it("resolves parent_lead_id to null when org-chart.json can't be read — action still succeeds", async () => {
    writeRegister([entry()]);
    const res = await post(app(), "acme-lead", { sessionId: SESSION_ID, reason: "x" });
    expect(res.status).toBe(200);
    const lines = readAuditLines();
    expect(lines[0].parent_lead_id).toBeNull();
  });
});

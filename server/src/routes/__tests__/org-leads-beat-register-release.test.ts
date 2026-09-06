import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createOrgApiRouter } from "../org.js";

/*
 * POST /api/org/leads/:leadId/beat-register/release — the plain-surface
 * mirror of the secret-gated release route (iterate-2026-09-06-org-lead-
 * staleness-register, FR-04.41). Shares `handleReleaseRequest` with the
 * gated route (`beat-register-release.ts`) — this file is deliberately
 * thin, since the release ACTION itself (lock/mutate/audit) is already
 * covered end-to-end by `external/org/__tests__/beat-register-release*.test.ts`.
 */
const CHART = {
  version: 1,
  po: "sven",
  leads: {
    "acme-lead": {
      domain: "acme-lead",
      name: "Acme Lead",
      reports_to: null,
      manages: [],
      charter_path: "acme-lead/charter.md",
    },
  },
};

const TWO_LEAD_CHART = {
  version: 1,
  po: "sven",
  leads: {
    "acme-lead": {
      domain: "acme-lead",
      name: "Acme Lead",
      reports_to: null,
      manages: [],
      charter_path: "acme-lead/charter.md",
    },
    "beta-lead": {
      domain: "beta-lead",
      name: "Beta Lead",
      reports_to: null,
      manages: [],
      charter_path: "beta-lead/charter.md",
    },
  },
};

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("POST /api/org/leads/:leadId/beat-register/release — plain-surface proxy", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-api-release-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function post(app: ReturnType<typeof createOrgApiRouter>, leadId: string, body: unknown) {
    return app.request(`/api/org/leads/${leadId}/beat-register/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("refuses an unregistered leadId (403) BEFORE touching the register — no lstatSync/now deps supplied", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
    // Deliberately no `lstatSync` / `now` — the route must default them
    // itself (finding #11: a production call without test-only deps must
    // not crash).
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await post(app, "ghost-lead", { sessionId: SESSION_ID, reason: "stuck beat" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("unknown_lead");
  });

  it("releases an open entry for a real lead, closing it and appending one audit line", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    const entry = {
      sessionId: SESSION_ID,
      beatId: "beat-1",
      leadId: "acme-lead",
      pid: 4242,
      startedAt: "2026-09-06T00:00:00Z",
      closedAt: null,
    };
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "beat-register.json"),
      JSON.stringify({ version: 1, entries: [entry] }),
      "utf8",
    );
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await post(app, "acme-lead", { sessionId: SESSION_ID, reason: "stuck beat, verified dead" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      recovered: true,
      residualLockWarning: expect.stringContaining(".beat.lock is untouched"),
    });

    const register = JSON.parse(readFileSync(path.join(leadsRoot, "acme-lead", "beat-register.json"), "utf8"));
    expect(register.entries[0].closedAt).not.toBeNull();

    const auditLines = readFileSync(path.join(leadsRoot, "acme-lead", "audit.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(auditLines).toHaveLength(1);
    expect(JSON.parse(auditLines[0]).kind).toBe("beat_recovered");
  });

  it("a not-found sessionId reads 404 with the same shape as the secret-gated route", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await post(app, "acme-lead", { sessionId: SESSION_ID, reason: "no register at all" });
    expect(res.status).toBe(404);
    expect((await res.json()).reason).toBe("not-found");
  });

  it("an invalid sessionId shape is rejected 400 before any register access", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await post(app, "acme-lead", { sessionId: "not-a-uuid", reason: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("sessionId_invalid");
  });

  it("a whitespace-only reason is rejected 400 before any register access (external-review fix, OpenAI — .length alone accepted it)", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await post(app, "acme-lead", { sessionId: SESSION_ID, reason: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("reason_invalid");
  });

  it("a sessionId that belongs to a DIFFERENT lead's register is not-found, never releases the other lead's entry (external-review fix)", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(TWO_LEAD_CHART), "utf8");
    mkdirSync(path.join(leadsRoot, "beta-lead"), { recursive: true });
    const betaEntry = {
      sessionId: SESSION_ID,
      beatId: "beat-beta",
      leadId: "beta-lead",
      pid: 99,
      startedAt: "2026-09-06T00:00:00Z",
      closedAt: null,
    };
    writeFileSync(
      path.join(leadsRoot, "beta-lead", "beat-register.json"),
      JSON.stringify({ version: 1, entries: [betaEntry] }),
      "utf8",
    );
    // No acme-lead register at all — releasing beta's sessionId THROUGH
    // acme's route must never reach across into beta's register file. The
    // path is derived solely from the route's own `leadId` param
    // (`registerPathFor(leadsRoot, leadId)`), never from the request body.
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await post(app, "acme-lead", { sessionId: SESSION_ID, reason: "trying cross-lead release" });
    expect(res.status).toBe(404);
    expect((await res.json()).reason).toBe("not-found");

    // beta-lead's entry is untouched.
    const betaRegister = JSON.parse(
      readFileSync(path.join(leadsRoot, "beta-lead", "beat-register.json"), "utf8"),
    );
    expect(betaRegister.entries[0].closedAt).toBeNull();
  });

  it("a duplicate-session-id fault is refused 409, never silently picks one entry", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    const dup = [
      { sessionId: SESSION_ID, beatId: "beat-a", leadId: "acme-lead", pid: 1, startedAt: "2026-09-06T00:00:00Z", closedAt: null },
      { sessionId: SESSION_ID, beatId: "beat-b", leadId: "acme-lead", pid: 2, startedAt: "2026-09-06T01:00:00Z", closedAt: null },
    ];
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "beat-register.json"),
      JSON.stringify({ version: 1, entries: dup }),
      "utf8",
    );
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await post(app, "acme-lead", { sessionId: SESSION_ID, reason: "trying to fix the fault" });
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("fault");
  });
});

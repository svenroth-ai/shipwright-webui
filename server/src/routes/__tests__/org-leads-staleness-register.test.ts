import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createOrgApiRouter } from "../org.js";

/*
 * GET /api/org/leads — staleness + beat-register health
 * (iterate-2026-09-06-org-lead-staleness-register, FR-04.06 / FR-04.41).
 * Split out of org.test.ts to keep both files under the 300-line
 * convention (same precedent as org-charter-write.test.ts). The composite
 * roster read must surface the staleness verdict and the beat-register
 * health verbatim — never recomputed, never discarded, and a read failure
 * must never be silently reported as "clear" (see `types/org.ts`'s
 * `LeadRegisterView` doc comment).
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

const CHART_WITH_CRON = {
  version: 1,
  po: "sven",
  leads: {
    "acme-lead": {
      domain: "acme-lead",
      name: "Acme Lead",
      reports_to: null,
      manages: [],
      charter_path: "acme-lead/charter.md",
      triggers: { cron: "*/5 * * * *" }, // every 5 min -> 15 min stale threshold
    },
  },
};

describe("GET /api/org/leads — staleness + beat-register health (FR-04.06 / FR-04.41)", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-api-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  it("a last run well past 3x cadence reads staleness: 'stale', threaded through 'now'", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART_WITH_CRON), "utf8");
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "last-run.json"),
      JSON.stringify({
        lastRunAt: new Date(Date.now() - 40 * 60_000).toISOString(),
        sessionId: "11111111-1111-1111-1111-111111111111",
      }),
      "utf8",
    );
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/leads");
    const body = await res.json();
    const now = body.leads[0].now;
    expect(now.state).toBe("resting");
    expect(now.lastRun.measured).toBe(true);
    expect(now.lastRun.staleness).toBe("stale");
    expect(now.lastRun.cadenceUnresolvedReason).toBeUndefined();
  });

  it("no `triggers.cron` on the lead reads staleness: 'unknown' with a named reason, never fabricated as fresh", async () => {
    // No `triggers.cron` on this chart at all — mirrors org.test.ts's
    // "no cron resolvable" case. `readLeadOrgInfo` reports this as
    // `org_chart_invalid` (org-chart-lookup.ts line ~121) — the same reason
    // a corrupt chart file gets. `invalid_cron` is a DIFFERENT, narrower
    // case: `triggers.cron` present as a string but unparseable (below).
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "last-run.json"),
      JSON.stringify({
        lastRunAt: new Date(Date.now() - 60_000).toISOString(),
        sessionId: "11111111-1111-1111-1111-111111111111",
      }),
      "utf8",
    );
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/leads");
    const body = await res.json();
    const now = body.leads[0].now;
    expect(now.lastRun.staleness).toBe("unknown");
    expect(now.lastRun.cadenceUnresolvedReason).toBe("org_chart_invalid");
  });

  it("an unparseable `triggers.cron` string reads staleness: 'unknown' with reason 'invalid_cron'", async () => {
    const chartWithBadCron = {
      ...CHART,
      leads: {
        "acme-lead": { ...CHART.leads["acme-lead"], triggers: { cron: "not a cron" } },
      },
    };
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(chartWithBadCron), "utf8");
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "last-run.json"),
      JSON.stringify({
        lastRunAt: new Date(Date.now() - 60_000).toISOString(),
        sessionId: "11111111-1111-1111-1111-111111111111",
      }),
      "utf8",
    );
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/leads");
    const body = await res.json();
    const now = body.leads[0].now;
    expect(now.lastRun.staleness).toBe("unknown");
    expect(now.lastRun.cadenceUnresolvedReason).toBe("invalid_cron");
  });

  it("an open beat-register entry surfaces on 'register' AND keeps 'now.state' === 'running' (unchanged)", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    const entry = {
      sessionId: "22222222-2222-2222-2222-222222222222",
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
    const res = await app.request("/api/org/leads");
    const body = await res.json();
    const leadEntry = body.leads[0];
    expect(leadEntry.now).toEqual({ state: "running" });
    expect(leadEntry.register).toEqual({ leadId: "acme-lead", status: "open", entry });
  });

  it("a clear register reads register.status === 'clear' (steady state, unchanged from before this field existed)", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/leads");
    const body = await res.json();
    expect(body.leads[0].register).toEqual({ leadId: "acme-lead", status: "clear" });
  });

  it("a symlinked beat-register.json degrades 'now' to not-measured AND 'register' to unknown — NEVER 'clear' (internal-plan-review fix, HIGH)", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    const app = createOrgApiRouter({
      leadsRoot,
      honoHost: "127.0.0.1",
      lstatSync: (p) =>
        path.basename(p) === "beat-register.json" ? { isSymbolicLink: () => true } : lstatSync(p),
    });
    const res = await app.request("/api/org/leads");
    const body = await res.json();
    const leadEntry = body.leads[0];
    expect(leadEntry.now).toEqual({ state: "not-measured" });
    expect(leadEntry.register).toEqual({ leadId: "acme-lead", status: "unknown" });
  });

  it("a corrupt beat-register.json also degrades 'register' to unknown, not 'clear'", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(path.join(leadsRoot, "acme-lead", "beat-register.json"), "{not json", "utf8");
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/leads");
    const body = await res.json();
    expect(body.leads[0].now).toEqual({ state: "not-measured" });
    expect(body.leads[0].register).toEqual({ leadId: "acme-lead", status: "unknown" });
  });

  it("a duplicate-session-id fault surfaces on 'register' too (both fields see the SAME read, not two)", async () => {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    const dup = [
      {
        sessionId: "33333333-3333-3333-3333-333333333333",
        beatId: "beat-a",
        leadId: "acme-lead",
        pid: 1,
        startedAt: "2026-09-06T00:00:00Z",
        closedAt: null,
      },
      {
        sessionId: "33333333-3333-3333-3333-333333333333",
        beatId: "beat-b",
        leadId: "acme-lead",
        pid: 2,
        startedAt: "2026-09-06T01:00:00Z",
        closedAt: null,
      },
    ];
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "beat-register.json"),
      JSON.stringify({ version: 1, entries: dup }),
      "utf8",
    );
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/leads");
    const body = await res.json();
    const leadEntry = body.leads[0];
    expect(leadEntry.now).toEqual({ state: "needs-attention", reason: "duplicate-session" });
    expect(leadEntry.register).toEqual({
      leadId: "acme-lead",
      status: "fault",
      reason: "duplicate-session-id",
      sessionId: "33333333-3333-3333-3333-333333333333",
      entries: dup,
    });
  });
});

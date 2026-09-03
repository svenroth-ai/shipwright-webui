import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createOrgApiRouter } from "../org.js";

// The "file GET" / "charter PUT" / mount-collision (AC-9) groups live in the
// sibling org-charter-write.test.ts — split out to keep both files under the
// 300-line convention.
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

describe("createOrgApiRouter — /api/org/* plain-surface proxy", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-api-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  describe("host allowlist", () => {
    it("GET /api/org/org-chart — disallowed host is 403 host_not_allowed", async () => {
      const app = createOrgApiRouter({ leadsRoot, honoHost: "0.0.0.0" });
      const res = await app.request("/api/org/org-chart");
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("host_not_allowed");
    });

    it("Tailscale-range host is allowed through the gate", async () => {
      const res = await createOrgApiRouter({
        leadsRoot,
        honoHost: "100.64.1.2",
      }).request("/api/org/org-chart");
      expect(res.status).toBe(404); // reaches the handler — no org-chart.json yet
    });
  });

  describe("GET /api/org/org-chart", () => {
    it("forwards org_chart_missing as 404 (the nav-gating signal)", async () => {
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/org-chart");
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("org_chart_missing");
    });

    it("forwards org_chart_invalid as 502 (distinct from missing)", async () => {
      writeFileSync(path.join(leadsRoot, "org-chart.json"), "{not json", "utf8");
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/org-chart");
      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe("org_chart_invalid");
    });

    it("returns the strict five-field projection on success", async () => {
      writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/org-chart");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(CHART);
    });
  });

  describe("GET /api/org/leads", () => {
    it("forwards the org-chart error when the chart itself is missing", async () => {
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads");
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("org_chart_missing");
    });

    it("returns one composite roster entry per lead, degrading unmeasured figures honestly", async () => {
      writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.leads).toHaveLength(1);
      const entry = body.leads[0];
      expect(entry.leadId).toBe("acme-lead");
      expect(entry.domain).toBe("acme-lead");
      expect(entry.role).toEqual({ measured: false }); // no charter.md on disk
      // No beat-register.json is the steady "clear" state (mirrors leadwright's
      // own readRegisterUnlocked), and no last-run.json is `measured: false`.
      expect(entry.now).toEqual({ state: "resting", lastRun: { measured: false } });
      expect(entry.cadence).toEqual({ measured: false }); // no cron resolvable
      expect(entry.usage).toEqual({ leadId: "acme-lead", measured: false });
    });

    it("extracts the role sentence when charter.md is present", async () => {
      writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
      mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
      writeFileSync(
        path.join(leadsRoot, "acme-lead", "charter.md"),
        "# Acme Lead\n\nYou own the acme domain end to end.\n",
        "utf8",
      );
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads");
      const body = await res.json();
      expect(body.leads[0].role).toEqual({
        measured: true,
        text: "You own the acme domain end to end.",
      });
    });

    it("reports usage figures with a non-7 windowDays (regression fence — never hardcode 7)", async () => {
      writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
      mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
      writeFileSync(
        path.join(leadsRoot, "acme-lead", "usage.json"),
        JSON.stringify({ costUsd: 12.5, runCount: 4, windowDays: 30, asOf: "2026-08-01T00:00:00Z" }),
        "utf8",
      );
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads");
      const body = await res.json();
      expect(body.leads[0].usage).toEqual({
        leadId: "acme-lead",
        measured: true,
        costUsd: 12.5,
        runCount: 4,
        windowDays: 30,
        asOf: "2026-08-01T00:00:00Z",
      });
    });

    it("surfaces unpricedCallsTotal and anyNotMeasured through the composite roster read (code-review fix — was untested end-to-end)", async () => {
      writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
      mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
      writeFileSync(
        path.join(leadsRoot, "acme-lead", "usage.json"),
        JSON.stringify({
          costUsd: 5,
          runCount: 2,
          windowDays: 7,
          asOf: "2026-08-01T00:00:00Z",
          unpricedCallsTotal: 3,
          anyNotMeasured: true,
        }),
        "utf8",
      );
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads");
      const body = await res.json();
      expect(body.leads[0].usage).toEqual({
        leadId: "acme-lead",
        measured: true,
        costUsd: 5,
        runCount: 2,
        windowDays: 7,
        asOf: "2026-08-01T00:00:00Z",
        unpricedCallsTotal: 3,
        anyNotMeasured: true,
      });
    });
  });
});

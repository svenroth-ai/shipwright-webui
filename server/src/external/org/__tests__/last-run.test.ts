import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, lstatSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { registerLastRunRoute } from "../last-run.js";

describe("GET /api/external/org/leads/:leadId/last-run", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-last-run-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function writeChart(cron: string, leadId = "acme-lead"): void {
    writeFileSync(
      path.join(leadsRoot, "org-chart.json"),
      JSON.stringify({ leads: { [leadId]: { triggers: { cron }, reports_to: null } } }),
      "utf8",
    );
  }

  function writeLastRun(lastRunAt: string, sessionId = "sess-1", leadId = "acme-lead"): void {
    mkdirSync(path.join(leadsRoot, leadId), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, leadId, "last-run.json"),
      JSON.stringify({ lastRunAt, sessionId }),
      "utf8",
    );
  }

  function app(now?: () => Date): Hono {
    const a = new Hono();
    registerLastRunRoute(a, { leadsRoot, now });
    return a;
  }

  it("reports measured:false when last-run.json doesn't exist (not-measured, not stale)", async () => {
    const res = await app().request("/api/external/org/leads/acme-lead/last-run");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leadId: "acme-lead", measured: false });
  });

  it("reports measured:false when the lead directory doesn't exist at all", async () => {
    const res = await app().request("/api/external/org/leads/never-seen/last-run");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ leadId: "never-seen", measured: false });
  });

  it("reports fresh well within a 10-min cadence (30-min threshold)", async () => {
    writeChart("*/10 * * * *"); // 10-min cadence -> 30-min threshold
    writeLastRun("2026-08-18T00:00:00.000Z");
    const now = () => new Date("2026-08-18T00:05:00.000Z"); // 5 min age
    const res = await app(now).request("/api/external/org/leads/acme-lead/last-run");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.measured).toBe(true);
    expect(body.staleness).toBe("fresh");
    expect(body.thresholdMs).toBe(30 * 60_000);
    expect(body.cadenceMs).toBe(10 * 60_000);
  });

  it("reports fresh at EXACTLY the 3x-cadence boundary", async () => {
    writeChart("*/10 * * * *");
    writeLastRun("2026-08-18T00:00:00.000Z");
    const now = () => new Date("2026-08-18T00:30:00.000Z"); // exactly 30 min age
    const res = await app(now).request("/api/external/org/leads/acme-lead/last-run");
    const body = await res.json();
    expect(body.staleness).toBe("fresh");
  });

  it("reports stale one millisecond past the 3x-cadence boundary", async () => {
    writeChart("*/10 * * * *");
    writeLastRun("2026-08-18T00:00:00.000Z");
    const now = () => new Date("2026-08-18T00:30:00.001Z");
    const res = await app(now).request("/api/external/org/leads/acme-lead/last-run");
    const body = await res.json();
    expect(body.staleness).toBe("stale");
  });

  it("reports staleness:unknown when org-chart.json is missing", async () => {
    writeLastRun("2026-08-18T00:00:00.000Z");
    const res = await app().request("/api/external/org/leads/acme-lead/last-run");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.measured).toBe(true);
    expect(body.staleness).toBe("unknown");
    expect(body.thresholdMs).toBeNull();
    expect(body.cadenceMs).toBeNull();
    expect(body.cadenceUnresolvedReason).toBe("org_chart_missing");
  });

  it("reports staleness:unknown when the lead isn't in org-chart.json", async () => {
    writeChart("*/10 * * * *", "other-lead");
    writeLastRun("2026-08-18T00:00:00.000Z");
    const res = await app().request("/api/external/org/leads/acme-lead/last-run");
    const body = await res.json();
    expect(body.staleness).toBe("unknown");
    expect(body.cadenceUnresolvedReason).toBe("lead_not_found");
  });

  it("reports staleness:unknown when the cron string is unparseable", async () => {
    writeChart("99 99 * * *");
    writeLastRun("2026-08-18T00:00:00.000Z");
    const res = await app().request("/api/external/org/leads/acme-lead/last-run");
    const body = await res.json();
    expect(body.staleness).toBe("unknown");
    expect(body.cadenceUnresolvedReason).toBe("invalid_cron");
  });

  it("rejects an invalid leadId with 400 before touching the filesystem", async () => {
    const res = await app().request(
      "/api/external/org/leads/" + encodeURIComponent("..%2F..%2Fetc") + "/last-run",
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_lead_id");
  });

  it("502s on malformed last-run.json", async () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(path.join(leadsRoot, "acme-lead", "last-run.json"), "{not json", "utf8");
    const res = await app().request("/api/external/org/leads/acme-lead/last-run");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("last_run_invalid");
  });

  it("502s when last-run.json is missing required fields", async () => {
    mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "last-run.json"),
      JSON.stringify({ lastRunAt: "2026-08-18T00:00:00.000Z" }),
      "utf8",
    );
    const res = await app().request("/api/external/org/leads/acme-lead/last-run");
    expect(res.status).toBe(502);
  });

  it(
    "rejects a symlinked last-run.json (mocked lstat) 403, never reading it",
    async () => {
      mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
      const a = new Hono();
      registerLastRunRoute(a, {
        leadsRoot,
        lstatSync: (p) =>
          path.basename(p) === "last-run.json" ? { isSymbolicLink: () => true } : lstatSync(p),
      });

      const res = await a.request("/api/external/org/leads/acme-lead/last-run");
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("symlink_forbidden");
    },
  );
});

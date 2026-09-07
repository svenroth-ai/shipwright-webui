/*
 * verdict.test.ts — POST /api/external/org/verdict
 * (iterate-2026-09-07-leadwright-setup-wizard, W14).
 *
 * The wizard's "Because you said X -> Y" preview step: merges the proposed
 * new lead into the CURRENT on-disk org-chart/daemon-config (never a
 * client-assembled guess — leadwright-proposal-merge.ts is the single
 * merge point, shared with the commit route) and runs it through L19's
 * real check-setup.ts subprocess. Never re-implements that validation.
 */
import { describe, it, expect, vi } from "vitest";

import { verdictCore, type VerdictCoreDeps, type VerdictRequestBody } from "./verdict.js";
import type { PreflightOrgChart, PreflightResult } from "../../types/leadwright-preflight.js";

const EMPTY_ORG_CHART: PreflightOrgChart = { version: 2, po: "sven", leads: {} };

const VALID_LEAD = {
  name: "New Lead",
  domain: "billing",
  reports_to: null,
  manages: [],
  charter_path: "new-lead/charter.md",
  learnings_path: "new-lead/learnings.md",
  triggers: { cron: "0 * * * *", on: [] },
  max_concurrent_tasks: 1,
  budget: { window: "rolling-7d", usd: null, pause_at: 0.85, hard_stop_at: 0.95 },
  projects: ["p1"],
  allowed_skills: ["/x"],
  allowed_tools: [],
  escalation_target: "po",
  model: "balanced",
  paused: false,
};

const VALID_BODY: VerdictRequestBody = {
  leadId: "new-lead",
  lead: VALID_LEAD,
  daemonConfigAdditions: { path: "/abs/p1", actionId: "/x", pluginDirs: [] },
  charterContent: "# New Lead",
};

function baseDeps(overrides: Partial<VerdictCoreDeps> = {}): VerdictCoreDeps {
  return {
    leadsRoot: "/leads",
    leadwrightCheckoutRoot: "/leadwright",
    webuiBaseUrl: "http://localhost:5173",
    readOrgChartFullFn: vi.fn(() => ({ status: 200 as const, body: EMPTY_ORG_CHART })),
    daemonConfigReadFn: vi.fn(() => ({
      status: 200 as const,
      body: { found: false as const, template: { orgChartPath: "/leads/org-chart.json", webuiBaseUrl: "http://localhost:5173" } },
    })),
    runLeadwrightPreflightFn: vi.fn(async () => ({
      ranOk: true as const,
      result: { ok: true, findings: [] } satisfies PreflightResult,
    })),
    ...overrides,
  };
}

describe("verdictCore", () => {
  it("503s leadwright_not_configured when leadwrightCheckoutRoot is unset", async () => {
    const deps = baseDeps({ leadwrightCheckoutRoot: undefined });
    const result = await verdictCore(deps, VALID_BODY);
    expect(result).toEqual({ status: 503, body: { error: "leadwright_not_configured" } });
    expect(deps.runLeadwrightPreflightFn).not.toHaveBeenCalled();
  });

  it("400s on a malformed request body", async () => {
    const deps = baseDeps();
    const result = await verdictCore(deps, { leadId: "", lead: null, daemonConfigAdditions: null } as unknown as VerdictRequestBody);
    expect(result.status).toBe(400);
  });

  it("merges the proposal against the CURRENT org chart and daemon config, then runs it through the real transport", async () => {
    const deps = baseDeps();
    const result = await verdictCore(deps, VALID_BODY);
    expect(result.status).toBe(200);
    expect(deps.runLeadwrightPreflightFn).toHaveBeenCalledTimes(1);
    const [checkoutRoot, proposal] = (deps.runLeadwrightPreflightFn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(checkoutRoot).toBe("/leadwright");
    expect(proposal.orgChart.leads["new-lead"]).toEqual(VALID_LEAD);
    if (result.status === 200) {
      expect(result.body.ranOk).toBe(true);
      expect(typeof result.body.proposalDigest).toBe("string");
    }
  });

  it("propagates ranOk:false with a reason when leadwright is not reachable — this is the state that blocks finish", async () => {
    const deps = baseDeps({
      runLeadwrightPreflightFn: vi.fn(async () => ({ ranOk: false as const, reason: "leadwright check-setup produced no parsable output" })),
    });
    const result = await verdictCore(deps, VALID_BODY);
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body).toMatchObject({ ranOk: false, reason: expect.stringContaining("no parsable output") });
    }
  });

  it("propagates a non-200 org-chart read as its own error (e.g. missing org-chart.json)", async () => {
    const deps = baseDeps({
      readOrgChartFullFn: vi.fn(() => ({ status: 404 as const, body: { error: "org_chart_missing" } })),
    });
    const result = await verdictCore(deps, VALID_BODY);
    expect(result).toEqual({ status: 404, body: { error: "org_chart_missing" } });
    expect(deps.runLeadwrightPreflightFn).not.toHaveBeenCalled();
  });

  it("propagates a non-200 daemon-config read as its own error (e.g. malformed JSON)", async () => {
    const deps = baseDeps({
      daemonConfigReadFn: vi.fn(() => ({ status: 502 as const, body: { error: "daemon_config_invalid" } })),
    });
    const result = await verdictCore(deps, VALID_BODY);
    expect(result).toEqual({ status: 502, body: { error: "daemon_config_invalid" } });
    expect(deps.runLeadwrightPreflightFn).not.toHaveBeenCalled();
  });
});

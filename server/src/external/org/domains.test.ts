import { describe, it, expect } from "vitest";

import { domainsCore, type DomainsRouteDeps, type TaskDomainLookup } from "./domains.js";
import type { PreflightOrgChart } from "../../types/leadwright-preflight.js";

const LEAD_FIELDS = {
  reports_to: null,
  manages: [],
  charter_path: "x/charter.md",
  learnings_path: "x/learnings.md",
  triggers: { cron: "0 * * * *", on: [] },
  max_concurrent_tasks: 1,
  budget: { window: "rolling-7d" as const, usd: null, pause_at: 0.85, hard_stop_at: 0.95 },
  projects: [],
  allowed_skills: [],
  allowed_tools: [],
  escalation_target: "po",
  model: "balanced" as const,
  paused: false,
};

function storeOf(tasks: Array<{ state?: string; domain?: string; claimToken?: string }>): TaskDomainLookup {
  return { list: () => tasks };
}

function orgChartWithDomains(domains: string[]): PreflightOrgChart {
  const leads: PreflightOrgChart["leads"] = {};
  domains.forEach((d, i) => {
    leads[`lead-${i}`] = { name: `Lead ${i}`, domain: d, ...LEAD_FIELDS };
  });
  return { version: 2, po: "sven", leads };
}

describe("domainsCore", () => {
  it("unions org-chart domains with task-store domains, deduplicated and sorted", () => {
    const deps: DomainsRouteDeps = {
      leadsRoot: "/leads",
      store: storeOf([{ domain: "checkout" }, { domain: "billing" }]),
      readOrgChartFullFn: () => ({ status: 200, body: orgChartWithDomains(["billing", "growth"]) }),
    };
    const result = domainsCore(deps);
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.domains).toEqual(["billing", "checkout", "growth"]);
    }
  });

  it("counts unclaimed cards (state=draft, no claimToken) per domain, mirroring isClaimableByLead", () => {
    const deps: DomainsRouteDeps = {
      leadsRoot: "/leads",
      store: storeOf([
        { domain: "billing", state: "draft" },
        { domain: "billing", state: "draft" },
        { domain: "billing", state: "draft", claimToken: "already-claimed" },
        { domain: "billing", state: "done" },
        { domain: "growth", state: "draft" },
      ]),
      readOrgChartFullFn: () => ({ status: 200, body: orgChartWithDomains([]) }),
    };
    const result = domainsCore(deps);
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.unclaimedCounts).toEqual({ billing: 2, growth: 1 });
    }
  });

  it("ignores tasks with no domain", () => {
    const deps: DomainsRouteDeps = {
      leadsRoot: "/leads",
      store: storeOf([{ state: "draft" }]),
      readOrgChartFullFn: () => ({ status: 200, body: orgChartWithDomains([]) }),
    };
    const result = domainsCore(deps);
    expect(result).toEqual({ status: 200, body: { domains: [], unclaimedCounts: {} } });
  });

  it("propagates a non-200 org-chart read", () => {
    const deps: DomainsRouteDeps = {
      leadsRoot: "/leads",
      store: storeOf([]),
      readOrgChartFullFn: () => ({ status: 404, body: { error: "org_chart_missing" } }),
    };
    const result = domainsCore(deps);
    expect(result).toEqual({ status: 404, body: { error: "org_chart_missing" } });
  });
});

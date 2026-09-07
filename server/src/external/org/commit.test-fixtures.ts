/*
 * commit.test-fixtures.ts — shared request/deps builders for commit.ts's
 * test suite, split across commit.test.ts (validation/digest/write-order)
 * and commit-lock.test.ts (lock/symlink error mapping) so neither file
 * ratchets past the bloat ceiling.
 */
import { vi } from "vitest";

import type { CommitCoreDeps } from "./commit.js";
import type { CommitRequestBody } from "./commit-validate.js";
import { computeProposalDigest } from "./leadwright-proposal-merge.js";
import type { PreflightLead, PreflightOrgChart } from "../../types/leadwright-preflight.js";

export const EMPTY_ORG_CHART: PreflightOrgChart = { version: 2, po: "sven", leads: {} };

export const VALID_LEAD = {
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
} satisfies PreflightLead;

export const ADDITIONS = { path: "/abs/p1", actionId: "/x", pluginDirs: ["/abs/plugins"] };

export function correctDigest(): string {
  const merged: PreflightOrgChart = { ...EMPTY_ORG_CHART, leads: { "new-lead": VALID_LEAD } };
  return computeProposalDigest({
    orgChart: merged,
    charters: [{ leadId: "new-lead", content: "# New Lead" }],
    daemonConfig: {
      orgChartPath: "/leads/org-chart.json",
      webuiBaseUrl: "http://localhost:5173",
      leadProjectRoots: { "new-lead": ADDITIONS.path },
      leadActionIds: { "new-lead": ADDITIONS.actionId },
      leadPluginDirs: { "new-lead": ADDITIONS.pluginDirs },
    },
  });
}

export function validBody(overrides: Partial<CommitRequestBody> = {}): CommitRequestBody {
  return {
    leadId: "new-lead",
    lead: VALID_LEAD,
    daemonConfigAdditions: ADDITIONS,
    charterContent: "# New Lead",
    expectedProposalDigest: correctDigest(),
    ...overrides,
  };
}

export function baseDeps(overrides: Partial<CommitCoreDeps> = {}): CommitCoreDeps {
  return {
    leadsRoot: "/leads",
    leadwrightCheckoutRoot: "/leadwright",
    webuiBaseUrl: "http://localhost:5173",
    readOrgChartFullFn: vi.fn(() => ({ status: 200 as const, body: EMPTY_ORG_CHART })),
    daemonConfigReadFn: vi.fn(() => ({
      status: 200 as const,
      body: { found: false as const, template: { orgChartPath: "/leads/org-chart.json", webuiBaseUrl: "http://localhost:5173" } },
    })),
    writeCharterFn: vi.fn(),
    runLeadwrightPreflightFn: vi.fn(async () => ({ ranOk: true as const, result: { ok: true, findings: [] } })),
    ...overrides,
  };
}

/*
 * leadwright-proposal-merge.test.ts — the ONE place that merges a new lead's
 * answers into the current org-chart/daemon-config state to build the full
 * PreflightStdinInput, reused by both the verdict route (preview) and the
 * commit route (write) so they can never see a different merged proposal
 * for "the same" submission (external-review finding, both legs, round 2:
 * the first draft let the client assemble daemonConfig from scratch,
 * drifting from the real on-disk state).
 */
import { describe, it, expect, vi } from "vitest";

import { mergeLeadProposal, computeProposalDigest } from "./leadwright-proposal-merge.js";
import { readExistingLeadCharters } from "./existing-charters-read.js";
import type { PreflightLead, PreflightOrgChart } from "../../types/leadwright-preflight.js";

const EXISTING_ORG_CHART: PreflightOrgChart = {
  version: 2,
  po: "sven",
  leads: {
    "existing-lead": {
      name: "Existing Lead",
      domain: "existing",
      reports_to: null,
      manages: [],
      charter_path: "existing-lead/charter.md",
      learnings_path: "existing-lead/learnings.md",
      triggers: { cron: "0 * * * *", on: ["chat_session_ended"] },
      max_concurrent_tasks: 2,
      budget: { window: "rolling-7d", usd: 50, pause_at: 0.85, hard_stop_at: 0.95 },
      projects: ["proj-a"],
      allowed_skills: ["/existing-action"],
      allowed_tools: [],
      escalation_target: "po",
      model: "balanced",
      paused: false,
    },
  },
};

const NEW_LEAD: PreflightLead = {
  name: "New Lead",
  domain: "new-domain",
  reports_to: null,
  manages: [],
  charter_path: "new-lead/charter.md",
  learnings_path: "new-lead/learnings.md",
  triggers: { cron: "*/15 * * * *", on: ["chat_session_ended"] },
  max_concurrent_tasks: 2,
  budget: { window: "rolling-7d", usd: 100, pause_at: 0.85, hard_stop_at: 0.95 },
  projects: ["proj-b"],
  allowed_skills: ["/new-action"],
  allowed_tools: [],
  escalation_target: "po",
  model: "balanced",
  paused: false,
};

describe("mergeLeadProposal", () => {
  it("adds the new lead alongside the existing one, never dropping or reordering it", () => {
    const merged = mergeLeadProposal({
      orgChart: EXISTING_ORG_CHART,
      daemonConfig: { found: true, config: { orgChartPath: "/leads/org-chart.json", webuiBaseUrl: "http://x" } },
      leadId: "new-lead",
      lead: NEW_LEAD,
      daemonConfigAdditions: { path: "/projects/b", actionId: "action-b", pluginDirs: [] },
    });
    expect(Object.keys(merged.proposal.orgChart.leads)).toEqual(["existing-lead", "new-lead"]);
    expect(merged.proposal.orgChart.leads["existing-lead"]).toEqual(EXISTING_ORG_CHART.leads["existing-lead"]);
    expect(merged.proposal.orgChart.leads["new-lead"]).toEqual(NEW_LEAD);
  });

  it("merges the new lead's daemon-config additions into the EXISTING daemon-config, preserving other leads' entries", () => {
    const merged = mergeLeadProposal({
      orgChart: EXISTING_ORG_CHART,
      daemonConfig: {
        found: true,
        config: {
          orgChartPath: "/leads/org-chart.json",
          webuiBaseUrl: "http://x",
          leadProjectRoots: { "existing-lead": "/projects/a" },
          leadActionIds: { "existing-lead": "action-a" },
          leadPluginDirs: { "existing-lead": ["/plugins/a"] },
        },
      },
      leadId: "new-lead",
      lead: NEW_LEAD,
      daemonConfigAdditions: { path: "/projects/b", actionId: "action-b", pluginDirs: ["/plugins/b"] },
    });
    expect(merged.proposal.daemonConfig.leadProjectRoots).toEqual({
      "existing-lead": "/projects/a",
      "new-lead": "/projects/b",
    });
    expect(merged.proposal.daemonConfig.leadActionIds).toEqual({
      "existing-lead": "action-a",
      "new-lead": "action-b",
    });
    expect(merged.proposal.daemonConfig.leadPluginDirs).toEqual({
      "existing-lead": ["/plugins/a"],
      "new-lead": ["/plugins/b"],
    });
  });

  it("uses the daemonConfig template's orgChartPath/webuiBaseUrl when found:false (no daemon-config.json yet)", () => {
    const merged = mergeLeadProposal({
      orgChart: EXISTING_ORG_CHART,
      daemonConfig: { found: false, template: { orgChartPath: "/leads/org-chart.json", webuiBaseUrl: "http://y" } },
      leadId: "new-lead",
      lead: NEW_LEAD,
      daemonConfigAdditions: { path: "/projects/b", actionId: "action-b", pluginDirs: [] },
    });
    expect(merged.proposal.daemonConfig.orgChartPath).toBe("/leads/org-chart.json");
    expect(merged.proposal.daemonConfig.webuiBaseUrl).toBe("http://y");
    expect(merged.daemonConfigFileExists).toBe(false);
  });

  it("builds a charter entry for the new lead from charterContent, when no existingCharters are passed", () => {
    const merged = mergeLeadProposal({
      orgChart: EXISTING_ORG_CHART,
      daemonConfig: { found: true, config: { orgChartPath: "/x", webuiBaseUrl: "http://x" } },
      leadId: "new-lead",
      lead: NEW_LEAD,
      daemonConfigAdditions: { path: "/projects/b", actionId: "action-b", pluginDirs: [] },
      charterContent: "# New Lead Charter\n\n## Band 1\n...",
    });
    expect(merged.proposal.charters).toEqual([{ leadId: "new-lead", content: "# New Lead Charter\n\n## Band 1\n..." }]);
  });

  // External-review fix (GLM, medium, round 3): leadwright's
  // runSetupPreflight validates charter-bands:<leadId> for EVERY lead in
  // orgChart.leads, not just the one being proposed — an existing lead with
  // no matching charters[] entry fails its own "no charter provided" MUSS
  // finding, which would make ANY submission's overall verdict red once a
  // second lead exists. existingCharters must be included ahead of the new
  // lead's own inline entry.
  it("includes existingCharters ahead of the new lead's own inline charter entry", () => {
    const merged = mergeLeadProposal({
      orgChart: EXISTING_ORG_CHART,
      daemonConfig: { found: true, config: { orgChartPath: "/x", webuiBaseUrl: "http://x" } },
      leadId: "new-lead",
      lead: NEW_LEAD,
      daemonConfigAdditions: { path: "/projects/b", actionId: "action-b", pluginDirs: [] },
      charterContent: "# New Lead Charter",
      existingCharters: [{ leadId: "existing-lead", content: "# Existing Lead Charter" }],
    });
    expect(merged.proposal.charters).toEqual([
      { leadId: "existing-lead", content: "# Existing Lead Charter" },
      { leadId: "new-lead", content: "# New Lead Charter" },
    ]);
  });

  it("defaults charterContent to empty string when omitted (a valid submission per the published contract)", () => {
    const merged = mergeLeadProposal({
      orgChart: EXISTING_ORG_CHART,
      daemonConfig: { found: true, config: { orgChartPath: "/x", webuiBaseUrl: "http://x" } },
      leadId: "new-lead",
      lead: NEW_LEAD,
      daemonConfigAdditions: { path: "/projects/b", actionId: "action-b", pluginDirs: [] },
    });
    expect(merged.proposal.charters).toEqual([{ leadId: "new-lead", content: "" }]);
  });
});

describe("readExistingLeadCharters", () => {
  it("reads every lead in orgChart.leads except the excluded one, via <leadId>/charter.md", () => {
    const orgChart = {
      version: 2 as const,
      po: "sven",
      leads: { "lead-a": EXISTING_ORG_CHART.leads["existing-lead"], "lead-b": NEW_LEAD },
    };
    const readFn = vi.fn((_deps: { leadsRoot: string }, relpath: string | undefined) => ({
      status: 200 as const,
      kind: "file" as const,
      body: Buffer.from(`# charter for ${relpath}`),
      headers: {},
    }));
    const result = readExistingLeadCharters("/leads", orgChart, "lead-b", readFn);
    expect(result).toEqual([{ leadId: "lead-a", content: "# charter for lead-a/charter.md" }]);
    expect(readFn).toHaveBeenCalledWith({ leadsRoot: "/leads" }, "lead-a/charter.md");
    expect(readFn).not.toHaveBeenCalledWith(expect.anything(), "lead-b/charter.md");
  });

  it("treats a missing/unreadable charter.md as an empty charter, never a thrown error", () => {
    const orgChart = { version: 2 as const, po: "sven", leads: { "lead-a": EXISTING_ORG_CHART.leads["existing-lead"] } };
    const readFn = vi.fn(() => ({ status: 404 as const, kind: "json" as const, body: { error: "not_found" } }));
    const result = readExistingLeadCharters("/leads", orgChart, "new-lead", readFn);
    expect(result).toEqual([{ leadId: "lead-a", content: "" }]);
  });
});

describe("computeProposalDigest", () => {
  it("is deterministic for the same merged proposal", () => {
    const merged = mergeLeadProposal({
      orgChart: EXISTING_ORG_CHART,
      daemonConfig: { found: true, config: { orgChartPath: "/x", webuiBaseUrl: "http://x" } },
      leadId: "new-lead",
      lead: NEW_LEAD,
      daemonConfigAdditions: { path: "/projects/b", actionId: "action-b", pluginDirs: [] },
    });
    expect(computeProposalDigest(merged.proposal)).toBe(computeProposalDigest(merged.proposal));
  });

  it("changes when any field of the proposal changes", () => {
    const base = mergeLeadProposal({
      orgChart: EXISTING_ORG_CHART,
      daemonConfig: { found: true, config: { orgChartPath: "/x", webuiBaseUrl: "http://x" } },
      leadId: "new-lead",
      lead: NEW_LEAD,
      daemonConfigAdditions: { path: "/projects/b", actionId: "action-b", pluginDirs: [] },
    });
    const changed = mergeLeadProposal({
      orgChart: EXISTING_ORG_CHART,
      daemonConfig: { found: true, config: { orgChartPath: "/x", webuiBaseUrl: "http://x" } },
      leadId: "new-lead",
      lead: { ...NEW_LEAD, model: "deep" },
      daemonConfigAdditions: { path: "/projects/b", actionId: "action-b", pluginDirs: [] },
    });
    expect(computeProposalDigest(base.proposal)).not.toBe(computeProposalDigest(changed.proposal));
  });

  it("is stable under key-order permutation of the input objects (canonical JSON, not raw JSON.stringify)", () => {
    const a = { ...NEW_LEAD };
    const bKeys = Object.keys(a).reverse();
    const b: Record<string, unknown> = {};
    for (const k of bKeys) b[k] = (a as unknown as Record<string, unknown>)[k];

    const mergedA = mergeLeadProposal({
      orgChart: EXISTING_ORG_CHART,
      daemonConfig: { found: true, config: { orgChartPath: "/x", webuiBaseUrl: "http://x" } },
      leadId: "new-lead",
      lead: a,
      daemonConfigAdditions: { path: "/projects/b", actionId: "action-b", pluginDirs: [] },
    });
    const mergedB = mergeLeadProposal({
      orgChart: EXISTING_ORG_CHART,
      daemonConfig: { found: true, config: { orgChartPath: "/x", webuiBaseUrl: "http://x" } },
      leadId: "new-lead",
      lead: b as unknown as PreflightLead,
      daemonConfigAdditions: { path: "/projects/b", actionId: "action-b", pluginDirs: [] },
    });
    expect(computeProposalDigest(mergedA.proposal)).toBe(computeProposalDigest(mergedB.proposal));
  });
});

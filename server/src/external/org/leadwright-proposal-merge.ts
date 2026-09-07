/*
 * leadwright-proposal-merge.ts — the ONE place that merges a new lead's
 * answers into the current org-chart/daemon-config state to build the full
 * PreflightStdinInput (iterate-2026-09-07-leadwright-setup-wizard, W14).
 *
 * Reused by both the verdict route (preview — read-only) and the commit
 * route (write) so they can never see a different merged proposal for "the
 * same" submission — external-review finding, both legs, round 2: the
 * first draft let the client assemble `daemonConfig` from scratch, which
 * drifts from the real on-disk state (missing other leads' entries,
 * missing `orgChartPath`/`webuiBaseUrl`).
 */
import { createHash } from "node:crypto";

import type {
  PreflightCharter,
  PreflightDaemonConfig,
  PreflightLead,
  PreflightOrgChart,
  PreflightStdinInput,
} from "../../types/leadwright-preflight.js";

export type { PreflightCharter };

export type DaemonConfigReadResult =
  | { found: true; config: PreflightDaemonConfig }
  | { found: false; template: { orgChartPath: string; webuiBaseUrl: string } };

export interface DaemonConfigAdditions {
  path: string;
  actionId: string;
  pluginDirs: string[];
}

export interface MergeLeadProposalInput {
  orgChart: PreflightOrgChart;
  daemonConfig: DaemonConfigReadResult;
  leadId: string;
  lead: PreflightLead;
  daemonConfigAdditions: DaemonConfigAdditions;
  /** This lead's charter.md content. Defaults to "" (a valid submission per
   *  the published contract — an empty charter surfaces as its own finding,
   *  never a submission error). */
  charterContent?: string;
  /** External-review fix (GLM, medium, round 3): leadwright's
   *  `runSetupPreflight` validates `charter-bands:<leadId>` for EVERY lead
   *  in `orgChart.leads`, not just the one being proposed — an entry with
   *  no matching `charters[]` item fails its own unsatisfied MUSS finding
   *  ("no charter provided for lead '<leadId>'"), which would make ANY
   *  submission's overall verdict red the moment a second lead exists.
   *  There is no "path mode" fallback for the inline stdin contract
   *  (`daemon/setup-preflight-input-contract.ts`) — every lead's content
   *  must be submitted explicitly. Callers must read every OTHER lead's
   *  charter.md from disk and pass it here (see `existing-charters-read.ts`);
   *  never include the lead being proposed (`leadId`) — its content comes
   *  from `charterContent` above. */
  existingCharters?: PreflightCharter[];
}

export interface MergeLeadProposalResult {
  proposal: PreflightStdinInput;
  /** Whether daemon-config.json exists on disk today — the commit route's
   *  "show a fragment instead of writing" branch keys off this. */
  daemonConfigFileExists: boolean;
}

/** Canonical (key-sorted, recursive) JSON stringify — stable regardless of
 *  input object key insertion order, so the digest reflects VALUE identity
 *  only, matching what a re-submission with reordered keys should mean. */
export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeProposalDigest(proposal: PreflightStdinInput): string {
  return createHash("sha256").update(canonicalStringify(proposal)).digest("hex");
}

export function mergeLeadProposal(input: MergeLeadProposalInput): MergeLeadProposalResult {
  const { orgChart, daemonConfig, leadId, lead, daemonConfigAdditions, charterContent, existingCharters } = input;

  const mergedLeads: Record<string, PreflightLead> = { ...orgChart.leads, [leadId]: lead };
  const mergedOrgChart: PreflightOrgChart = { ...orgChart, leads: mergedLeads };

  const baseDaemonConfig: PreflightDaemonConfig =
    daemonConfig.found ? daemonConfig.config : { orgChartPath: daemonConfig.template.orgChartPath, webuiBaseUrl: daemonConfig.template.webuiBaseUrl };

  const mergedDaemonConfig: PreflightDaemonConfig = {
    ...baseDaemonConfig,
    leadProjectRoots: { ...(baseDaemonConfig.leadProjectRoots ?? {}), [leadId]: daemonConfigAdditions.path },
    leadActionIds: { ...(baseDaemonConfig.leadActionIds ?? {}), [leadId]: daemonConfigAdditions.actionId },
    leadPluginDirs: { ...(baseDaemonConfig.leadPluginDirs ?? {}), [leadId]: daemonConfigAdditions.pluginDirs },
  };

  const charters: PreflightCharter[] = [...(existingCharters ?? []), { leadId, content: charterContent ?? "" }];

  return {
    proposal: { orgChart: mergedOrgChart, charters, daemonConfig: mergedDaemonConfig },
    daemonConfigFileExists: daemonConfig.found,
  };
}

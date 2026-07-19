/*
 * external/mission-context/facts.ts — the scenario inputs the resolver cannot
 * derive on its own, gathered SERVER-side from authoritative sources only.
 *
 * Every value here comes from the server's own reads (the project's actions
 * catalog, its run-config, its campaign records). None of it is taken from the
 * request — that is the whole point of the §5.1 input trust boundary: a client
 * cannot claim "this is a custom-actions project" or "this title is a campaign"
 * and have the resolver believe it.
 */

import { loadActionsForProject } from "../../core/project-actions-loader.js";
import { readCampaigns } from "../../core/campaign-store.js";
import { resolveCampaignsDir } from "../../core/campaign-paths.js";
import { buildPipelineFact, getCampaignFact } from "./facts-slice3.js";
import type { RunConfigReadResult } from "../../core/run-config-reader.js";
import type { ExternalTask } from "../../core/sdk-sessions-store.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import type { ResolveRequest } from "../../core/mission-context/resolver.js";

/**
 * Parse `campaign: <slug>` from an orchestrator task title.
 *
 * Verbatim mirror of `client/src/lib/campaignSlug.ts` (DO-NOT #7 — the two
 * workspaces never import each other). Prefix-anchored and case-sensitive on
 * the exact producer breadcrumb, so a human-typed "Campaign: Q3" never parses.
 */
export function parseCampaignSlug(title: string | null | undefined): string | null {
  if (typeof title !== "string") return null;
  const match = /^campaign:\s*(\S.*)$/.exec(title.trim());
  if (!match) return null;
  const slug = match[1].trim();
  return slug.length > 0 ? slug : null;
}

export interface ScenarioFacts {
  actions: ResolveRequest["actions"];
  hasValidRunConfig: boolean;
  campaignSlug: string | null;
  hasCampaignRecord: boolean;
  /** S3 — the native pipeline fact (scenario 3). */
  pipeline: ResolveRequest["pipeline"];
  /** S3 — the native campaign fact (scenario 5). */
  campaign: ResolveRequest["campaign"];
}

export interface FactsDeps {
  readRunConfig: (projectPath: string) => Promise<RunConfigReadResult>;
}

/**
 * Gather the facts for one resolve. Every branch degrades to the SAFE default
 * (`actions: null` → not custom-actions → Mission stays visible), because the
 * failure mode of guessing wrong here is hiding a useful tab (Review-2 GPT #12).
 */
export async function getScenarioFacts(
  project: ExternalRouteProjectView,
  task: ExternalTask,
  deps: FactsDeps,
): Promise<ScenarioFacts> {
  let actions: ScenarioFacts["actions"] = null;
  try {
    const loaded = loadActionsForProject(project.path);
    actions = {
      fromUser: loaded.fromUser,
      hasDiagnostics: loaded.diagnostics.length > 0,
      actionIds: loaded.actions.actions.map((a) => a.id),
    };
  } catch {
    actions = null; // unreadable catalog → ambiguous → never hide the tab
  }

  // ONE run-config read serves both the custom-actions gate and the S3 pipeline
  // fact — a second read could observe a different file mid-write and let the
  // two disagree about the same run.
  let runConfig: RunConfigReadResult = { status: "missing" };
  try {
    runConfig = await deps.readRunConfig(project.path);
  } catch {
    runConfig = { status: "invalid", reason: "read_failed" };
  }
  const hasValidRunConfig = runConfig.status === "ok";

  const campaignSlug = parseCampaignSlug(task.title);
  let hasCampaignRecord = false;
  if (campaignSlug) {
    try {
      // A TITLE is not evidence — a real record must back it (§4 precedence 4).
      const dir = resolveCampaignsDir({ path: project.path, synthesized: project.synthesized });
      if (dir.ok) {
        hasCampaignRecord = readCampaigns(dir.absolute, dir.projectRoot).some(
          (c) => c.slug === campaignSlug,
        );
      }
    } catch {
      hasCampaignRecord = false;
    }
  }

  return {
    actions,
    hasValidRunConfig,
    campaignSlug,
    hasCampaignRecord,
    pipeline: buildPipelineFact(runConfig, task.phaseTaskId ?? null),
    // Resolved only for a scenario that will actually use it; a `campaign:`
    // title with no record stays `hasCampaignRecord: false` and never becomes
    // a campaign, so there is nothing to read.
    campaign: hasCampaignRecord ? getCampaignFact(project, campaignSlug) : null,
  };
}

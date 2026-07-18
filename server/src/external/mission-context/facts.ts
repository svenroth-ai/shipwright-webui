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

  let hasValidRunConfig = false;
  try {
    hasValidRunConfig = (await deps.readRunConfig(project.path)).status === "ok";
  } catch {
    hasValidRunConfig = false;
  }

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

  return { actions, hasValidRunConfig, campaignSlug, hasCampaignRecord };
}

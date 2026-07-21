/*
 * core/mission-context/resolver-io.ts — the resolver's INPUT and OUTPUT shapes.
 *
 * Split out of resolver.ts (300-LOC rule) rather than merged into types.ts: this
 * file describes the SERVER-INTERNAL call contract between the route and the
 * resolver, while types.ts is the versioned WIRE contract the client mirrors.
 * Keeping them apart is what stops an internal field from drifting into the
 * mirrored surface by accident (the drift guard checks types.ts, not this).
 */

import type { MergeCheckDeps } from "./merge-check.js";
import type { CampaignFact } from "./campaign-artifacts.js";
import type { PipelineFact } from "./pipeline-artifacts.js";
import type { ScenarioInputs } from "./scenario.js";
import type { GitRunner } from "./worktree-roots.js";
import type { MissionContext, MissionContextAssociation } from "./types.js";

export interface ResolveRequest {
  taskId: string;
  sessionUuid: string;
  projectId: string;
  projectRoot: string;
  /** Server-read transcript (bounded tail) — never client-supplied (§5.1). */
  transcript: string;
  /** Task facts the server owns (from its own store, not the client). */
  phaseTaskId: string | null;
  taskRunId: string | null;
  campaignSlug: string | null;
  hasCampaignRecord: boolean;
  actions: ScenarioInputs["actions"];
  runConfigStatus: ScenarioInputs["runConfigStatus"];
  /**
   * S3 — native scenario facts, gathered server-side (external/facts-slice3.ts).
   * Optional so existing callers/tests compile; absent behaves as `unavailable`,
   * which SHOWS the artifacts rather than hiding them.
   */
  pipeline?: PipelineFact | null;
  campaign?: CampaignFact | null;
  /**
   * The task's persisted association. Read from the server's own store; it is
   * how a FINALIZED iterate still resolves after its pointer was pruned.
   */
  association?: MissionContextAssociation | null;
}

export interface ResolveDeps {
  git?: GitRunner;
  merge?: MergeCheckDeps;
}

export interface ResolveResult {
  context: MissionContext;
  /** The run id to persist onto the task, or null when nothing may be written. */
  associateRunId: string | null;
  /** Which source identified it — carried into the association for provenance. */
  associateSource: MissionContextAssociation["source"];
}

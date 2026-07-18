/*
 * core/mission-context/scenario.ts — the §4 ORDERED decision table.
 *
 * First match wins, in this exact order. The ordering is the fix for
 * external-review GPT #9: a title alone is not evidence, and a leftover
 * pointer must not out-rank a project that is genuinely in custom-actions mode.
 *
 *   1. custom_actions — a VALIDATED custom-actions project → HIDE the Mission
 *      tab entirely (only Files & Terminal).
 *   2. iterate        — a VALIDATED `iterate_active` pointer.
 *   3. pipeline       — phaseTaskId + runId (run-config v2 phase_tasks).
 *   4. campaign       — a `campaign:<slug>` title AND a real campaign record.
 *   5. plain          — everything else (scenarios 1/4): narration, no rail.
 *
 * Two DECIDED asymmetries, both "fail toward showing the tab":
 *   - A MALFORMED actions file or a DUAL-MODE project (custom actions sitting
 *     alongside the builtin SDLC actions) falls back to SHOWING Mission.
 *     Hiding a useful tab because of a stale or ambiguous file is the worse
 *     failure (Review-2 GPT #12).
 *   - A `campaign:` TITLE without a matching record is NOT a campaign. Titles
 *     are user-editable; a record is evidence.
 */

import type { MissionContextAssociation, MissionScenario } from "./types.js";
import type { ReadPointerResult } from "./pointer.js";

/** The four builtin action ids. Anything else is a user-defined custom action. */
export const BUILTIN_ACTION_IDS: ReadonlySet<string> = new Set([
  "new-task",
  "new-pipeline",
  "new-iterate",
  "new-plain",
]);

export interface ScenarioInputs {
  /** Result of reading `.shipwright/iterate_active/<uuid>.json`. */
  pointer: ReadPointerResult;
  /**
   * The DURABLE association persisted on the task, if any.
   *
   * Load-bearing after Finalize: `prune_stale_run_pointers` deletes the pointer
   * once the worktree is gone, so from that moment the pointer can never
   * identify the run again. Without this fallback the resolver would answer
   * `plain` for every finished iterate — reintroducing precisely the data loss
   * the association was added to close, and breaking AC2 (a finalized iterate
   * must still show its commit + merge state, never "No run data yet").
   */
  association?: MissionContextAssociation | null;
  /** Actions catalog facts, resolved SERVER-side from the project. */
  actions: {
    /** True when `.shipwright-webui/actions.json` was actually used. */
    fromUser: boolean;
    /** Loader diagnostics — any entry means "ambiguous", so do NOT hide. */
    hasDiagnostics: boolean;
    /** Every resolved action id. */
    actionIds: readonly string[];
  } | null;
  /** True when the project has a VALID SDLC run-config (status === "ok"). */
  hasValidRunConfig: boolean;
  /** The task's phase-task linkage (scenario 3). */
  phaseTaskId: string | null;
  taskRunId: string | null;
  /** Parsed `campaign:<slug>` from the title, and whether a record exists. */
  campaignSlug: string | null;
  hasCampaignRecord: boolean;
}

/**
 * Is this project VALIDLY in custom-actions mode?
 *
 * All four must hold — the conjunction is the point. Presence of an
 * actions.json is explicitly NOT sufficient (§4 precedence 1).
 */
export function isValidatedCustomActions(inputs: ScenarioInputs): boolean {
  const a = inputs.actions;
  if (!a) return false;
  if (!a.fromUser) return false; // bundled default → an ordinary SDLC project
  if (a.hasDiagnostics) return false; // malformed / partially parsed → ambiguous
  if (a.actionIds.length === 0) return false; // nothing resolved → ambiguous
  // Dual-mode: a builtin SDLC action survives alongside the custom ones.
  if (a.actionIds.some((id) => BUILTIN_ACTION_IDS.has(id))) return false;
  // A valid SDLC run-config means the project genuinely runs the pipeline too.
  if (inputs.hasValidRunConfig) return false;
  return true;
}

export interface ScenarioDecision {
  scenario: MissionScenario;
  missionTabVisible: boolean;
  /** Set only for `iterate` — the run id the whole resolve joins on. */
  runId: string | null;
  /** Set when a pointer existed but could not be trusted (§5.1e) → `unavailable`. */
  pointerInvalidReason: string | null;
}

export function detectScenario(inputs: ScenarioInputs): ScenarioDecision {
  const base = { runId: null, pointerInvalidReason: null };

  // 1 — custom-actions wins over a leftover pointer, but ONLY when validated.
  if (isValidatedCustomActions(inputs)) {
    return { ...base, scenario: "custom_actions", missionTabVisible: false };
  }

  // 2 — a validated iterate pointer.
  if (inputs.pointer.status === "ok") {
    return {
      scenario: "iterate",
      missionTabVisible: true,
      runId: inputs.pointer.pointer.runId,
      pointerInvalidReason: null,
    };
  }

  // An INVALID pointer is remembered so the artifacts can say `unavailable`
  // honestly — but it does NOT make this an iterate session. Fall through.
  const pointerInvalidReason =
    inputs.pointer.status === "invalid" ? inputs.pointer.reason : null;

  // 2b — the pointer is GONE (pruned at Finalize) but this task was validly
  // observed running an iterate. The association is server-written and
  // server-trusted, so it identifies the run when the bridge no longer can.
  // Deliberately ranked BELOW a live pointer (fresher, carries the worktree)
  // and BELOW custom-actions, but ABOVE pipeline/campaign — a task that ran an
  // iterate is an iterate, whatever else it later looks like.
  //
  // An INVALID pointer does NOT get this fallback: a pointer that failed
  // validation is a signal something is wrong, and quietly resolving via a
  // stored id would mask it.
  if (inputs.pointer.status === "absent" && inputs.association?.runId) {
    return {
      scenario: "iterate",
      missionTabVisible: true,
      runId: inputs.association.runId,
      pointerInvalidReason: null,
    };
  }

  // 3 — pipeline phase task. Behavior unchanged until its native slice.
  if (inputs.phaseTaskId && inputs.taskRunId) {
    return { scenario: "pipeline", missionTabVisible: true, runId: null, pointerInvalidReason };
  }

  // 4 — campaign, only with a real record behind the title.
  if (inputs.campaignSlug && inputs.hasCampaignRecord) {
    return { scenario: "campaign", missionTabVisible: true, runId: null, pointerInvalidReason };
  }

  // 5 — plain / pure.
  return { scenario: "plain", missionTabVisible: true, runId: null, pointerInvalidReason };
}

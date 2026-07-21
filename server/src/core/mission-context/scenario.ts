/*
 * core/mission-context/scenario.ts — the §4 ORDERED decision table.
 *
 * First match wins, in this exact order. The ordering is the fix for
 * external-review GPT #9: a title alone is not evidence, and a leftover
 * pointer must not out-rank a project that is genuinely in custom-actions mode.
 *
 *   1. custom_actions — a VALIDATED custom-actions project → HIDE the Mission
 *      tab entirely (only Files & Terminal).
 *   2. iterate        — a VALIDATED `iterate_active` pointer, or the persisted
 *      association once that pointer has been pruned.
 *   3. pipeline       — phaseTaskId + runId (run-config v2 phase_tasks).
 *   4. campaign       — a `campaign:<slug>` title AND a real campaign record.
 *   5. iterate        — a CORROBORATED `Run-ID` footer in this session's own
 *      transcript (run-id-recovery.ts). Last resort, and deliberately ranked
 *      below pipeline/campaign — see `transcriptRunId`.
 *   6. plain          — everything else (scenarios 1/4): narration, no rail.
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

/**
 * What we know about the project's SDLC run-config — THREE states, not a boolean.
 *
 * `RunConfigReadResult` has four (`ok` / `missing` / `v1_legacy` / `invalid`) and
 * only ONE of them, `missing`, is evidence that the project does not run the
 * pipeline. A config that is present but corrupt, legacy, or written to a schema
 * this build does not know is a config we COULD NOT READ — which says nothing
 * about whether the project is an SDLC project.
 *
 * Collapsing the other three into "no run-config" is how an unreadable file
 * silently deletes the Mission tab (internal code review, BLOCKING).
 */
export type RunConfigPresence =
  /** Parsed as a valid v2 config — the project demonstrably runs the pipeline. */
  | "ok"
  /** No run-config file at all — the ONLY state that permits a hide. */
  | "missing"
  /** Present but unparseable / legacy / unknown schema / unreadable. We do not know. */
  | "unreadable";

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
  /**
   * A run id recovered from this session's OWN transcript and already
   * corroborated by the project's records (`run-id-recovery.ts`).
   *
   * The last-resort identification source, for the tasks that ran before this
   * build shipped: measured 2026-07-21, only 19 of this project's 150 sessions
   * could be identified from a pointer or an association, because the pointer is
   * pruned at Finalize and the association is only written while the Mission tab
   * is open during the run.
   *
   * Ranked BELOW pipeline and campaign, unlike the association: an association
   * is a SERVER-OBSERVED fact (this session really was running that iterate),
   * whereas the footer is text the session happens to contain. Measured, a
   * campaign session quotes its sub-iterates' footers — ranking this higher
   * would demote a genuine campaign to `iterate`.
   */
  transcriptRunId?: string | null;
  /** Actions catalog facts, resolved SERVER-side from the project. */
  actions: {
    /** True when `.shipwright-webui/actions.json` was actually used. */
    fromUser: boolean;
    /** Loader diagnostics — any entry means "ambiguous", so do NOT hide. */
    hasDiagnostics: boolean;
    /** Every resolved action id. */
    actionIds: readonly string[];
  } | null;
  /** What we know about the project's SDLC run-config. See `RunConfigPresence`. */
  runConfigStatus: RunConfigPresence;
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
 * Every clause must hold — the conjunction is the point. Presence of an
 * actions.json is explicitly NOT sufficient (§4 precedence 1).
 *
 * S3 — the `actionIds: readonly string[]` type is a CLAIM, not a guarantee: the
 * values cross a JSON boundary (`.shipwright-webui/actions.json`) where nothing
 * enforces it. MEASURED on the real loader + a real temp project (S3 probe):
 * `{"schemaVersion":1,"actions":[{"foo":"bar"}]}` parses fine, the loader reports
 * `fromUser: true` with ZERO diagnostics because `JSON.parse` succeeded and
 * `checkContractVersion` only WARNS, and `facts.ts` maps `a.id` to `undefined`.
 * That produced a one-element id list matching no builtin — and this function
 * returned true, HIDING the Mission tab for a project whose actions file is
 * simply the wrong shape. Malformed and truncated files were already safe (they
 * throw, so the loader falls back to the bundled default); valid-JSON-wrong-shape
 * was the hole between "parses" and "means anything".
 *
 * The asymmetry is deliberate and load-bearing: hiding a whole tab is
 * irreversible from the user's side and gives no error and no cause, so EVERY
 * ambiguous input must resolve to SHOWING (CONTRACT §4.1, Review-2 GPT #12).
 */
export function isValidatedCustomActions(inputs: ScenarioInputs): boolean {
  const a = inputs.actions;
  if (!a) return false;
  if (!a.fromUser) return false; // bundled default → an ordinary SDLC project
  if (a.hasDiagnostics) return false; // malformed / partially parsed → ambiguous
  if (!Array.isArray(a.actionIds)) return false; // not even a list → ambiguous
  if (a.actionIds.length === 0) return false; // nothing resolved → ambiguous
  // A file whose entries carry no usable id is the wrong SHAPE, not a catalog of
  // custom actions. We cannot tell what it declares, so we must not act on it.
  if (!a.actionIds.every((id) => typeof id === "string" && id.length > 0)) return false;
  // Dual-mode: a builtin SDLC action survives alongside the custom ones.
  if (a.actionIds.some((id) => BUILTIN_ACTION_IDS.has(id))) return false;
  // ONLY a definitively ABSENT run-config permits the hide. `ok` means the
  // project runs the pipeline too (dual mode); `unreadable` means we could not
  // find out, and "we could not read it" is not "it is not there" — the same
  // rule the actions catalog above already follows, where every read failure
  // short-circuits to false.
  if (inputs.runConfigStatus !== "missing") return false;
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

  // 5 — the session's own commit footer, corroborated by this project's records.
  // Same asymmetry as 2b: an INVALID pointer gets no fallback, because a pointer
  // that failed validation is a signal something is wrong and quietly resolving
  // the run another way would mask it.
  if (inputs.pointer.status === "absent" && inputs.transcriptRunId) {
    return {
      scenario: "iterate",
      missionTabVisible: true,
      runId: inputs.transcriptRunId,
      pointerInvalidReason: null,
    };
  }

  // 6 — plain / pure.
  return { scenario: "plain", missionTabVisible: true, runId: null, pointerInvalidReason };
}

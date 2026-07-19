/*
 * stage-derivation.ts — the honest "Where it stands" lifecycle derivation
 * (FR-01.66, campaign 2026-07-18-mission-artifacts S4).
 *
 * WHY THIS EXISTS. `inferStage` used to be furthest-along-wins over COARSE tool
 * signals: the first `Edit`/`Write` to any non-spec file set Build, and Build
 * outranks Analyze. So the stepper left Analyze while the iterate was still
 * scouting — a scratchpad probe script or a memory note was enough to claim
 * "Build". Measured over 114 real iterate transcripts from `~/.claude/projects`
 * (READ-ONLY probe, S4 confidence calibration): 17 of them (15%) had a
 * scratch/bookkeeping write as their FIRST edit, inside the scope window, ahead
 * of every strong marker — i.e. 15% of real iterates mis-read as Build during
 * Analyze.
 *
 * WHAT REPLACED IT. The stage is derived from REAL phase markers
 * (`stage-markers.ts`), and an INCIDENTAL edit no longer advances an iterate past
 * Analyze. A PRODUCT-source edit still does — it is genuine build work, and
 * claiming Analyze there would be the opposite lie.
 *
 * MEASURED DEVIATION FROM THE S4 BRIEF. The brief named the iterate's
 * `TodoWrite` phase tasks as the PRIMARY signal ("gibt ja alles tasks"). The
 * same probe falsifies that premise for the sessions the WebUI observes:
 * `TodoWrite` appears in 10 of 114 real iterate transcripts (9%), and where it
 * does appear the task text is free-form campaign unit lists ("A18
 * files-terminal-three-card — RISKIEST: ..."), not the phase vocabulary
 * (repo_scout → interview → iterate_spec → …). Keyword-matching a stage out of
 * that free text would FABRICATE a phase — exactly what the campaign's honesty
 * principle forbids. `TodoWrite` therefore stays what it always was: a planning
 * (Analyze) marker. The markers that ARE real, by measured frequency:
 * `gh pr` 93% · `setup_iterate_worktree` 89% · `finalize_iterate` 85% ·
 * spec/planning write 68% · `classify_complexity` 66%.
 *
 * SCENARIO-GATED. The six-stage Analyze→Merge lifecycle is an ITERATE concept.
 * The sticky-Analyze rule runs ONLY for a scenario that actually has that
 * lifecycle (`iterate`, and `campaign` — whose window IS its active
 * sub-iterate). A `pipeline` task takes its phase from the run-config, never a
 * tool-signal guess. A `plain` session gets a coarse "what it's doing now" read
 * and NO stage at all — a plain session has no lifecycle to be at a position in,
 * and inventing one is a fabrication.
 *
 * Pure + deterministic: input is the parsed transcript plus the scenario. No
 * I/O, no clock, no randomness — the same input always yields the same stage.
 */

import type { ParsedEvent } from "../external/session-parser";
import { collectMarkers, lastActivity, type Markers } from "./stage-markers";

export { classifyEditPath, isIterateStart, type EditKind } from "./stage-markers";

/** The six fixed lifecycle-stage labels (FR-01.67 AC1 — verbatim, Sven's call:
 *  Shipwright phase nouns, NOT gerunds). A test pins these six strings. */
export const STAGE_LABELS = ["Analyze", "Spec", "Build", "Test", "Finalize", "Merge"] as const;
export type LifecycleStage = (typeof STAGE_LABELS)[number];

/** The scenario the S1 `MissionContext` resolver reports. `null` = not resolved
 *  yet / older server: fall back to reading iterate-ness off the transcript's own
 *  kickoff marker rather than guessing a scenario. */
export type StageScenario = "iterate" | "pipeline" | "campaign" | "plain";

/** How the claim was reached — stated, so the stepper's basis is never implied. */
export type StageBasis =
  | "iterate_phase_markers"
  | "pipeline_phase"
  | "coarse_activity"
  | "none";

export interface StageDerivation {
  /** The formal lifecycle position, or null → the honest "—". */
  stage: LifecycleStage | null;
  /** A plain "what it's doing now" for a session with no formal lifecycle.
   *  Never a stage name, never presented as one. Null when nothing is evidenced. */
  activity: string | null;
  basis: StageBasis;
}

export interface StageOptions {
  scenario?: StageScenario | null;
  /** The authoritative run-config phase for a `pipeline` task (S3 resolves it). */
  phase?: string | null;
}

const NOTHING: StageDerivation = { stage: null, activity: null, basis: "none" };

/**
 * The iterate lifecycle — furthest-along-wins over REAL phase markers, with the
 * sticky-Analyze rule: an incidental edit never contributes Build. Also used for
 * a `campaign`, whose window (via `currentIterateEvents`) IS its active
 * sub-iterate, so the same phase reading is the honest one.
 */
function iterateStage(m: Markers): LifecycleStage | null {
  if (m.merge) return "Merge";
  if (m.finalize) return "Finalize";
  if (m.test) return "Test";
  // THE FIX: only a real build command or a PRODUCT edit reaches Build. An
  // incidental scratch/bookkeeping write leaves the stage in Analyze.
  if (m.build || m.productEdit) return "Build";
  if (m.spec) return "Spec";
  if (m.scope) return "Analyze";
  return null;
}

/**
 * The run-config pipeline phases (`server/src/types/run-config-v2.ts` RunPhase)
 * mapped onto the six labels. Authoritative — never a tool-signal guess (AC4).
 * An unknown/absent phase yields null, not a guess.
 */
const PIPELINE_PHASE_STAGE: Record<string, LifecycleStage> = {
  project: "Analyze",
  design: "Analyze",
  plan: "Spec",
  build: "Build",
  test: "Test",
  security: "Test",
  changelog: "Finalize",
  deploy: "Merge",
};

function fromIterate(m: Markers): StageDerivation | null {
  const stage = iterateStage(m);
  return stage ? { stage, activity: null, basis: "iterate_phase_markers" } : null;
}

/**
 * The no-lifecycle answer: what the session is doing RIGHT NOW, in plain words.
 *
 * `lastActivity` is a tail scan rather than a priority scan over `Markers` —
 * see its doc. A window with events but nothing recognisable evidences nothing,
 * so it collapses to `NOTHING` rather than an empty `coarse_activity` claim.
 */
function fromCoarse(events: readonly ParsedEvent[]): StageDerivation {
  const activity = lastActivity(events);
  return activity ? { stage: null, activity, basis: "coarse_activity" } : NOTHING;
}

/**
 * Derive the lifecycle stage for a transcript window, gated on the scenario.
 *
 * Callers pass the window from `currentIterateEvents` so a campaign reflects its
 * CURRENT sub-iterate rather than latching a merged earlier one.
 */
export function deriveStage(
  events: readonly ParsedEvent[],
  options: StageOptions = {},
): StageDerivation {
  if (events.length === 0) return NOTHING;
  const m = collectMarkers(events);
  const scenario = options.scenario ?? null;

  if (scenario === "pipeline") {
    const phase = options.phase ? options.phase.toLowerCase() : null;
    const stage = phase ? PIPELINE_PHASE_STAGE[phase] ?? null : null;
    // No readable phase is an honest "—", NEVER a fallback to the tool-signal
    // guess the phase was supposed to replace (AC4).
    return stage ? { stage, activity: null, basis: "pipeline_phase" } : fromCoarse(events);
  }

  // A CONFIRMED plain session: the resolver looked and found no iterate,
  // pipeline or campaign record. The lifecycle does not apply, so the stage is
  // suppressed in favour of a coarse activity read (AC5).
  //
  // The `m.iterateKickoff` escape is load-bearing and is NOT a loophole in the
  // AC4 gate. `plain` means "no RECORD found", which is not the same claim as
  // "no iterate ran": a campaign whose record has not landed yet, or an iterate
  // whose run pointer was already pruned, both resolve `plain` while the
  // kickoff sits plainly in the transcript. Withholding the stage there would
  // be a fabrication in the other direction — denying a position the transcript
  // genuinely evidences.
  if (scenario === "plain" && !m.iterateKickoff) return fromCoarse(events);

  // Everything else — `iterate`, `campaign`, a `plain` card with real kickoff
  // evidence, and the UNRESOLVED case — reads the lifecycle from the markers.
  //
  // Unresolved deliberately does NOT behave like `plain`. `null` means the
  // resolver has not answered (still loading, older server, request failed);
  // `plain` is a positive finding. Treating "don't know" as "confirmed plain"
  // would collapse missing information into a definite claim — the exact shape
  // of the S2/S3 findings this campaign keeps turning up — and would silently
  // strip the stage from every session whenever the resolver is merely slow.
  return fromIterate(m) ?? fromCoarse(events);
}

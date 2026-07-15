/*
 * run-data-types.ts — shape contract for the per-run data join
 * (`run-data-join.ts`, A02, campaign webui-wow-usability-2026-07-10).
 *
 * A02 turns A01's raw event projection (`event-log-reader.ts`) into the
 * per-run shape Mission Control / the Ship's-Log gallery / the board consume:
 * a run's `runId` (== `task.runId` == `adr_id`) joined to its affected FRs,
 * test counts, DERIVED gate lamps, iterate phase-timings, plus a grade-trend
 * series folded from `grade_snapshot` events.
 *
 * Honesty is the hard contract (spec AC3):
 *   - Durations are NEVER synthesized. `phaseDurations` comes back `null` when
 *     the emitter produced no `phase_timings` (the common case today) — the
 *     consumer renders `n/a`. Pipeline `phase_started`/`phase_completed` pairs
 *     are aggregated by (phase, splitId) at PROJECT level; they carry no run
 *     join key so they are never attributed to a single run.
 *   - Gate lamps are DERIVED WebUI-side (no `gate_verdict` object exists in the
 *     emitters) and carry a permanent `derived: true` honesty flag.
 *
 * Split out to keep the join body under the 300-LOC ceiling (CLAUDE.md
 * file-size rule); verbatim-mirrored client-side in `client/src/lib/runDataApi.ts`
 * (ADR-080 — no cross-package import).
 */

import type { RunTests } from "./event-log-types.js";

export type { RunTests } from "./event-log-types.js";

/** A derived gate lamp state — NEVER an authoritative producer verdict. */
export type GateState = "pass" | "fail" | "unknown";

/**
 * Gate lamps DERIVED WebUI-side. No `gate_verdict` object exists in the
 * emitters (backend audit MISSING-2), so these are computed from the run's own
 * facts and flagged `derived: true` permanently. A consumer MUST render them
 * as derived, never as a producer verdict. Today only `test` carries a real
 * signal (the run's own suite); `review`/`security` have no per-run signal in
 * the event log and stay `"unknown"` until a producer emits an authoritative
 * verdict.
 */
export interface RunGates {
  derived: true;
  /** From the run's own tests: `pass` when total>0 && passed===total. */
  test: GateState;
  /** No per-run review signal in the event log → `"unknown"` today. */
  review: GateState;
  /** No per-run security signal in the event log → `"unknown"` today. */
  security: GateState;
}

/**
 * One projected iterate phase-timing mark, from `work_completed.phase_timings`
 * (the flat 5-mark list: scope · build · review · test · finalize). Present
 * per-run and unambiguous. `durationMs`/`startedAt` are read THROUGH — a mark
 * missing either is preserved as `null`, never back-filled.
 */
export interface PhaseDuration {
  phase: string;
  startedAt: string | null;
  durationMs: number | null;
}

/**
 * One (phase, splitId) duration from a pipeline `phase_started`/`phase_completed`
 * pair. A phase may have MULTIPLE splits (monorepo #369) → multiple ends; each
 * split is paired independently. `durationMs` is `null` unless BOTH ends parsed.
 */
export interface PhaseSplitDuration {
  splitId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

/**
 * Pipeline phase durations AGGREGATED by (phase, splitId). PROJECT-LEVEL: the
 * phase transitions carry no run-join key, so this is NEVER attributed to a
 * single run — attributing the whole transition array to one run would silently
 * mis-attribute or drop durations (spec upstream note). A phase with N splits
 * has N ends: `totalMs` sums the computable ones, `complete` is true only when
 * every split paired.
 */
export interface AggregatedPhase {
  phase: string;
  splits: PhaseSplitDuration[];
  /** Sum of non-null split durations, or `null` when none are computable. */
  totalMs: number | null;
  /** true only when every split has a computable duration (both ends parsed). */
  complete: boolean;
}

/** A grade-trend point folded from a `grade_snapshot` event. */
export interface GradeSnapshot {
  /** ISO timestamp of the snapshot, or `null` when absent. */
  ts: string | null;
  /** Control-grade letter (A / B+ / C- …). */
  grade: string;
  /** Numeric score (0-100), or `null` when absent/unparseable. */
  score: number | null;
}

/**
 * The per-run join: `runId` joined to its FRs, tests, DERIVED gates and iterate
 * phase-timings. `runId == adr_id == task.runId` (the documented contract). An
 * unknown `runId` yields `null` upstream (never a throw). Every optional source
 * field degrades to `null`/`[]`.
 */
export interface RunDataJoin {
  /** The event `adr_id` — the task-join key (`task.runId == adr_id`). */
  runId: string;
  ts: string | null;
  source: string | null;
  intent: string | null;
  changeType: string | null;
  summary: string | null;
  description: string | null;
  commit: string | null;
  /** `spec_impact` normalized to lowercase (none/modify/add/remove); `null` when absent. */
  specImpact: string | null;
  /** Raw `spec_impact`, case preserved (the reader's `specImpact`). */
  specImpactRaw: string | null;
  affectedFrs: string[];
  newFrs: string[];
  tests: RunTests | null;
  /** DERIVED gates (`derived: true`), or `null` when nothing is derivable. */
  gates: RunGates | null;
  /** Iterate phase-timing marks (`phase_timings`), or `null` — render **n/a**. */
  phaseDurations: PhaseDuration[] | null;
  campaign: string | null;
  subIterateId: string | null;
}

/**
 * The full run-data bundle behind the three A02 endpoints. Read once per
 * request from the project's `shipwright_events.jsonl`; the endpoints pick the
 * slice they serve. An absent/unreadable log → an empty bundle (graceful).
 */
export interface RunDataBundle {
  /** Per-run joins, latest `work_completed` per `adr_id`, ts-desc. */
  runs: RunDataJoin[];
  /** `runs.length` (of the returned, possibly runId-filtered set). */
  runCount: number;
  /** `grade_snapshot` trend, chronological ascending; `[]` when absent. */
  gradeTrend: GradeSnapshot[];
  /** Pipeline phase durations aggregated by (phase, splitId); PROJECT-level. */
  pipelinePhaseDurations: AggregatedPhase[];
  /** Non-empty lines that FAILED to parse (torn/corrupt) — skipped, not fatal. */
  skippedLines: number;
}

export interface ReadRunDataOptions {
  /** When set, `runs` is filtered to this single `adr_id` (detail view). */
  runId?: string;
}

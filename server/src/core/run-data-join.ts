/*
 * run-data-join.ts — per-run data join over A01's tolerant event projection
 * (A02, campaign webui-wow-usability-2026-07-10). Read-only, stateless, tolerant.
 *
 * Consumes `event-log-reader.ts` (A01) and turns each `work_completed` run into
 * the shape Mission Control / the Ship's-Log / the board render, plus a
 * grade-trend series folded from `grade_snapshot` events (which A01 skips). An
 * absent/unreadable log → an empty bundle, an unknown `runId` → `null`, NEVER a
 * throw or a 500.
 *
 * Honesty (spec AC3), enforced structurally:
 *   - `phaseDurations` comes ONLY from a run's own `phase_timings` (absent →
 *     `null`); pipeline transitions are aggregated by (phase, splitId) project-wide, never pinned to one run.
 *   - Durations are never synthesized/interpolated/estimated/back-filled.
 *   - Gates are DERIVED (`derived: true`, no `gate_verdict` object exists); only
 *     `test` carries a real per-run signal today. Current grade is NOT re-derived
 *     here — that stays with `compliance-reader.ts`; this file adds the trend.
 */

import { existsSync, readFileSync } from "node:fs";

import { pathGuard } from "./path-guard.js";
import {
  EVENT_FILE,
  projectEventLog,
  type PhaseTransition,
  type RunProjection,
  type RunTests,
} from "./event-log-reader.js";
import type {
  AggregatedPhase,
  GateState,
  GradeSnapshot,
  PhaseDuration,
  PhaseSplitDuration,
  ReadRunDataOptions,
  RunDataBundle,
  RunDataJoin,
  RunGates,
} from "./run-data-types.js";

export * from "./run-data-types.js";

function tsEpoch(ts: unknown): number {
  if (typeof ts !== "string" || !ts) return -Infinity;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : -Infinity;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asFiniteNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Lowercase-normalize `spec_impact` (none/modify/add/remove); null when absent. */
function normalizeSpecImpact(raw: string | null): string | null {
  if (raw === null) return null;
  const t = raw.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/** The test gate from a run's own tests: pass when total>0 && passed===total. */
export function deriveTestGate(tests: RunTests | null): GateState {
  if (!tests) return "unknown";
  const { passed, total } = tests;
  if (total === null || total <= 0 || passed === null) return "unknown";
  return passed === total ? "pass" : "fail";
}

/**
 * DERIVED gate lamps for a run. Returns `null` when nothing is derivable (no
 * tests). `derived: true` is permanent — never an authoritative verdict.
 * `review`/`security` have no per-run signal in the event log today → "unknown".
 */
export function deriveGates(run: RunProjection): RunGates | null {
  if (!run.tests) return null;
  return {
    derived: true,
    test: deriveTestGate(run.tests),
    review: "unknown",
    security: "unknown",
  };
}

/**
 * Project a run's `phase_timings` (the iterate flat mark-list) into normalized
 * `PhaseDuration[]`, or `null` when absent/empty/malformed (the honest n/a
 * signal). Each mark's `startedAt`/`durationMs` is read THROUGH — a mark missing
 * either is preserved as `null`, never back-filled. NEVER synthesized.
 */
export function projectPhaseDurations(phaseTimings: unknown): PhaseDuration[] | null {
  if (!Array.isArray(phaseTimings) || phaseTimings.length === 0) return null;
  const out: PhaseDuration[] = [];
  for (const raw of phaseTimings) {
    if (typeof raw !== "object" || raw === null) continue;
    const o = raw as Record<string, unknown>;
    const phase = asString(o.phase);
    if (phase === null) continue; // a mark with no phase name is unusable
    out.push({
      phase,
      startedAt: asString(o.started) ?? asString(o.startedAt),
      durationMs: asFiniteNumberOrNull(o.duration_ms ?? o.durationMs),
    });
  }
  return out.length > 0 ? out : null;
}

/** Build the per-run join from one A01 `RunProjection`. */
export function joinRunData(run: RunProjection): RunDataJoin {
  return {
    runId: run.runId,
    ts: run.ts,
    source: run.source,
    intent: run.intent,
    changeType: run.changeType,
    summary: run.summary,
    description: run.description,
    commit: run.commit,
    specImpact: normalizeSpecImpact(run.specImpact),
    specImpactRaw: run.specImpact,
    affectedFrs: run.affectedFrs,
    newFrs: run.newFrs,
    tests: run.tests,
    gates: deriveGates(run),
    phaseDurations: projectPhaseDurations(run.phaseTimings),
    campaign: run.campaign,
    subIterateId: run.subIterateId,
  };
}

/**
 * Aggregate pipeline `phase_started`/`phase_completed` transitions by
 * (phase, splitId). PROJECT-level ONLY — transitions carry no run-join key, so
 * this is never attributed to a single run. A phase may have MULTIPLE splits
 * (monorepo #369): each split is paired independently (start→end), and the
 * phase `totalMs` sums the computable split durations (`phase_failed` also
 * closes a split); `complete` is true only when every split paired.
 */
export function aggregatePhaseTransitions(
  transitions: PhaseTransition[],
): AggregatedPhase[] {
  // phase -> splitId -> accumulator, insertion-ordered. A JS Map keys `null`
  // distinctly from any string, so a null splitId gets its own bucket without a
  // sentinel (a string sentinel could collide with a real splitId value).
  const byPhase = new Map<string, Map<string | null, PhaseSplitDuration>>();

  for (const t of transitions) {
    if (t.phase === null) continue;
    if (t.type !== "phase_started" && t.type !== "phase_completed" && t.type !== "phase_failed") {
      continue;
    }
    let splits = byPhase.get(t.phase);
    if (!splits) {
      splits = new Map<string | null, PhaseSplitDuration>();
      byPhase.set(t.phase, splits);
    }
    let acc = splits.get(t.splitId);
    if (!acc) {
      acc = { splitId: t.splitId, startedAt: null, completedAt: null, durationMs: null };
      splits.set(t.splitId, acc);
    }
    if (t.type === "phase_started") {
      acc.startedAt = t.ts ?? acc.startedAt;
    } else {
      // phase_completed | phase_failed both close the split (last end wins).
      acc.completedAt = t.ts ?? acc.completedAt;
    }
  }

  const out: AggregatedPhase[] = [];
  for (const [phase, splits] of byPhase) {
    const splitList: PhaseSplitDuration[] = [];
    let total = 0;
    let anyDuration = false;
    let complete = true;
    for (const acc of splits.values()) {
      const s = tsEpoch(acc.startedAt);
      const e = tsEpoch(acc.completedAt);
      const paired =
        Number.isFinite(s) && Number.isFinite(e) && acc.startedAt !== null && acc.completedAt !== null;
      // A negative interval (end before start) is a corrupt pair → honest null.
      acc.durationMs = paired && e - s >= 0 ? e - s : null;
      if (acc.durationMs !== null) {
        total += acc.durationMs;
        anyDuration = true;
      } else {
        complete = false;
      }
      splitList.push(acc);
    }
    out.push({ phase, splits: splitList, totalMs: anyDuration ? total : null, complete });
  }
  return out;
}

/**
 * Fold `grade_snapshot` events into a chronological `[{ts, grade, score}]`
 * trend. A01's reader intentionally skips this event type, so this pass reads
 * the raw lines directly (tolerant: a torn line is skipped). Ascending by ts
 * (oldest→newest, parity with the prototype's `gradeTrend`); unparseable ts is
 * treated as earliest and kept in file order.
 */
export function projectGradeTrend(lines: Iterable<string>): GradeSnapshot[] {
  const rows: { idx: number; key: number; snap: GradeSnapshot }[] = [];
  let idx = 0;
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    const i = idx++;
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // torn/corrupt — skip, never fatal
    }
    if (typeof ev !== "object" || ev === null || Array.isArray(ev)) continue;
    const o = ev as Record<string, unknown>;
    if (o.type !== "grade_snapshot") continue;
    const grade = asString(o.grade);
    if (grade === null) continue; // a snapshot with no grade is unusable
    const ts = asString(o.ts);
    rows.push({
      idx: i,
      key: tsEpoch(ts),
      snap: { ts, grade, score: asFiniteNumberOrNull(o.score) },
    });
  }
  rows.sort((a, b) => (a.key !== b.key ? a.key - b.key : a.idx - b.idx));
  return rows.map((r) => r.snap);
}

/**
 * Pure bundle projection over an event log's lines: per-run joins + grade trend
 * + project-level pipeline phase durations. Reuses A01's `projectEventLog` for
 * the run dedup + phase transitions. `opts.runId` filters `runs` to one `adr_id`.
 */
export function projectRunData(
  lines: string[],
  opts: ReadRunDataOptions = {},
): RunDataBundle {
  const projection = projectEventLog(lines, opts);
  const runs = projection.runs.map(joinRunData);
  return {
    runs,
    runCount: runs.length,
    gradeTrend: projectGradeTrend(lines),
    pipelinePhaseDurations: aggregatePhaseTransitions(projection.phaseTransitions),
    skippedLines: projection.skippedLines,
  };
}

/** Empty (graceful) bundle — an absent/unreadable/guarded-out log. */
function emptyBundle(): RunDataBundle {
  return {
    runs: [],
    runCount: 0,
    gradeTrend: [],
    pipelinePhaseDurations: [],
    skippedLines: 0,
  };
}

/**
 * File-loading wrapper: read `<projectRoot>/shipwright_events.jsonl` ONCE and
 * project the full bundle. `pathGuard` defends the constant filename; a
 * missing/unreadable/guarded-out log yields the empty bundle (spec AC1).
 */
export function readRunData(
  projectRoot: string,
  opts: ReadRunDataOptions = {},
): RunDataBundle {
  const guard = pathGuard(projectRoot, EVENT_FILE);
  if (!guard.ok) return emptyBundle();
  if (!existsSync(guard.absolute)) return emptyBundle();
  let text: string;
  try {
    text = readFileSync(guard.absolute, "utf-8");
  } catch {
    return emptyBundle();
  }
  return projectRunData(text.split("\n"), opts);
}

/**
 * Detail helper: the single run joined for `runId`, or `null` when no
 * `work_completed` event carries that `adr_id` (the tested miss-case — spec
 * AC2). Never throws.
 */
export function readRunDetail(
  projectRoot: string,
  runId: string,
): RunDataJoin | null {
  if (!runId) return null;
  const bundle = readRunData(projectRoot, { runId });
  return bundle.runs.length > 0 ? bundle.runs[0]! : null;
}

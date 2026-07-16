/*
 * projectLogStats.ts — derive a project's Ship's-Log preview-card model from
 * A02's per-run join (A15, campaign webui-wow-usability-2026-07-10, FR-01.59).
 *
 * ⚠️ PROVENANCE-HONESTY (spec AC3). The prototype's `logStats()` is DEMO
 * scaffolding: it hardcodes a fixed run count, a full-coverage FR string and a
 * literal spark array for the one project named 'Shipwright WebUI'. NONE of
 * those literals live here. Every number is derived from the real
 * `RunsResponse` (A02) + the compliance score (FR-01.43), and an empty payload
 * returns `{ graded: false }` — an absent logbook is a sentence on the card,
 * never an invented sparkline.
 */

import type { RunDataJoin, RunsResponse } from "./runDataApi";

export interface ProjectLogModel {
  /** true iff A02 returned at least one run for this project. */
  graded: boolean;
  /** Total completed runs (A02 `runCount`). */
  runs: number;
  /** Distinct FRs touched across the runs (affected ∪ new). NOT a fake ratio. */
  frCount: number;
  /** Compliance Control-Grade score, or null when no dashboard was read. */
  score: number | null;
  /** Sparkline heights — real per-point values, [] when nothing is derivable. */
  spark: number[];
  /** The most-recent run's summary (fallback runId), or null. */
  lastProof: string | null;
}

const EMPTY: ProjectLogModel = {
  graded: false,
  runs: 0,
  frCount: 0,
  score: null,
  spark: [],
  lastProof: null,
};

/** Chronological (oldest→newest) copy — order-independent inputs, stable output. */
function byTsAsc<T extends { ts: string | null }>(list: readonly T[]): T[] {
  return list
    .slice()
    .sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));
}

/**
 * The sparkline is REAL data, in this order of preference:
 *   1. the grade-trend score series (the meaningful trajectory), else
 *   2. per-run test pass-ratio (0–100) where tests are present, else
 *   3. one unit bar per run — pure run-count activity (each bar = a real run;
 *      no per-run height is invented).
 */
function buildSparkline(runs: RunsResponse): number[] {
  const trend = byTsAsc(runs.gradeTrend)
    .map((g) => g.score)
    .filter((s): s is number => typeof s === "number");
  if (trend.length > 0) return trend;

  const ratios = byTsAsc(runs.runs)
    .map((r) =>
      r.tests && typeof r.tests.total === "number" && r.tests.total > 0
        ? ((r.tests.passed ?? 0) / r.tests.total) * 100
        : null,
    )
    .filter((v): v is number => v !== null);
  if (ratios.length > 0) return ratios;

  return runs.runs.map(() => 1);
}

function lastProofOf(list: readonly RunDataJoin[]): string | null {
  if (list.length === 0) return null;
  let best = list[0];
  for (const r of list) {
    if (r.ts && (!best.ts || r.ts > best.ts)) best = r;
  }
  const text = best.summary ?? best.runId;
  return text && text.trim().length > 0 ? text : null;
}

export function buildProjectLogModel(
  runs: RunsResponse | undefined,
  complianceScore: number | null | undefined,
): ProjectLogModel {
  // Gate on ACTUAL run rows, not just the count: a "graded" card must be able to
  // render its sparkline + proof, so a positive `runCount` with an empty `runs`
  // array (the server keeps them equal, but never trust that here) is NOT graded.
  if (!runs || runs.status !== "ok" || runs.runCount <= 0 || runs.runs.length === 0) {
    return EMPTY;
  }

  const frs = new Set<string>();
  for (const r of runs.runs) {
    for (const fr of r.affectedFrs ?? []) frs.add(fr);
    for (const fr of r.newFrs ?? []) frs.add(fr);
  }

  return {
    graded: true,
    runs: runs.runCount,
    frCount: frs.size,
    score: typeof complianceScore === "number" ? complianceScore : null,
    spark: buildSparkline(runs),
    lastProof: lastProofOf(runs.runs),
  };
}

/** The card's stats line — "N runs · M FRs · SS/100", omitting absent segments. */
export function statsLine(m: ProjectLogModel): string {
  const parts = [`${m.runs} run${m.runs === 1 ? "" : "s"}`];
  if (m.frCount > 0) parts.push(`${m.frCount} FR${m.frCount === 1 ? "" : "s"}`);
  if (m.score !== null) parts.push(`${m.score}/100`);
  return parts.join(" · ");
}

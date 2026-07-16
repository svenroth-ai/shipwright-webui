/*
 * useGradeReport — reads POST /api/wizard/grade, the read-only Grade door route
 * (A09b, FR-01.53). The server runs `shipwright-grade`'s grade.py and returns a
 * discriminated grade OUTCOME; this hook turns it into the wizard's
 * `GradeReportState` and hands the card the REAL `ReportModel`.
 *
 * Honesty rules (AC5):
 *   - the report shape is validated on THIS side (reportShape.parseReportModel —
 *     the cross-repo contract guard, ADR-045); a shape the card can't render
 *     safely becomes "shape-unrecognised", never a half-empty card;
 *   - nothing fabricates a grade: an underivable dimension stays null → "n/a";
 *   - every server outcome maps to an honest state (grade-failed /
 *     engine-unavailable / shape-unrecognised), never a silent success.
 *
 * A grade is a point-in-time reading of a repo, so the query is `staleTime:
 * Infinity` + `retry: false` — no refetch-spin, no auto-retry on an honest
 * failure. The wizard enables it only once the user commits a target (step ≥ 2),
 * so a bare `/wizard/grade` (step 1) spawns nothing.
 */

import { useQuery } from "@tanstack/react-query";

import { parseReportModel } from "./reportShape";
import type { GradeReportState } from "./contract";
import type { ReportModel } from "./types";

/** The wire response of POST /api/wizard/grade — one status per honest server
 *  outcome (mirrors the server's grade-runner.GradeOutcome verbatim; a shared
 *  import would cross the package boundary, DO-NOT #7). Exported so tests +
 *  future consumers reference ONE declared shape, not an inline literal. */
export interface GradeServerOutcome {
  status: "report-ready" | "grade-failed" | "engine-unavailable" | "shape-unrecognised";
  model?: unknown;
  reason?: string;
  repairCommand?: string;
}

export interface GradeReport {
  state: GradeReportState;
  /** The validated model — present ONLY when state === "report-ready". */
  model: ReportModel | null;
  /** Plain-language reason for a non-ready state (null when ready/idle). */
  reason: string | null;
  /** engine-unavailable only — the one command that installs the engine. */
  repairCommand: string | null;
}

const IDLE: GradeReport = { state: "idle", model: null, reason: null, repairCommand: null };

async function fetchGrade(target: string, isRemote: boolean): Promise<GradeServerOutcome> {
  const res = await fetch("/api/wizard/grade", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ target, isRemote }),
  });
  // The route returns 200 for every grade OUTCOME; even a 4xx/5xx carries our
  // JSON body. Read it; only synthesize a grade-failed if there's no usable body.
  let body: GradeServerOutcome | null = null;
  try {
    body = (await res.json()) as GradeServerOutcome;
  } catch {
    body = null;
  }
  if (body && typeof body.status === "string") return body;
  return { status: "grade-failed", reason: `The grade request failed (${res.status}).` };
}

/**
 * @param target   repo path or URL (null when no target yet)
 * @param opts.isRemote  the client's remote hint (the server re-derives its own)
 * @param opts.enabled   fire the grade only when the user has committed a target
 */
export function useGradeReport(
  target: string | null,
  opts: { isRemote: boolean; enabled: boolean },
): GradeReport {
  const active = opts.enabled && !!target;
  const q = useQuery<GradeServerOutcome>({
    queryKey: ["wizard-grade", target],
    queryFn: () => fetchGrade(target as string, opts.isRemote),
    enabled: active,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!active) return IDLE;
  if (q.isLoading) return { state: "grading", model: null, reason: null, repairCommand: null };
  if (q.isError || !q.data) {
    return { state: "grade-failed", model: null, reason: "The grade request failed.", repairCommand: null };
  }

  const out = q.data;
  if (out.status === "report-ready") {
    const parsed = parseReportModel(out.model);
    if (parsed.ok) return { state: "report-ready", model: parsed.model, reason: null, repairCommand: null };
    // The server said ready but the shape drifted — refuse to half-render it.
    return { state: "shape-unrecognised", model: null, reason: parsed.reason, repairCommand: null };
  }
  if (out.status === "engine-unavailable") {
    return {
      state: "engine-unavailable",
      model: null,
      reason: out.reason ?? null,
      repairCommand: out.repairCommand ?? null,
    };
  }
  if (out.status === "shape-unrecognised") {
    return { state: "shape-unrecognised", model: null, reason: out.reason ?? null, repairCommand: null };
  }
  // grade-failed (or any unrecognised status) — an honest failure, never a card.
  return { state: "grade-failed", model: null, reason: out.reason ?? null, repairCommand: null };
}

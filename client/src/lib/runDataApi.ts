/*
 * runDataApi.ts — fetch wrappers for the per-run data join endpoints
 * (FR-01.47, A02, campaign webui-wow-usability-2026-07-10):
 *   GET /api/external/projects/:id/runs
 *   GET /api/external/projects/:id/runs/:runId
 *   GET /api/external/projects/:id/grade-trend
 *
 * Its OWN lib file — externalApi.ts is at the bloat ceiling, no new wrappers
 * there — but reuses its exported httpJson + EXTERNAL_API so endpoint strings
 * live in one place.
 *
 * SoT for the wire shape: server/src/core/run-data-types.ts. Verbatim mirror
 * per ADR-080 — DO NOT add a cross-package import. Honesty flags travel on the
 * wire: `gates.derived: true` (a derived lamp, never an authoritative verdict)
 * and `phaseDurations: null` (render **n/a**, never a synthesized duration).
 */

import { EXTERNAL_API, httpJson } from "./externalApi";

export type GateState = "pass" | "fail" | "unknown";

export interface RunGates {
  derived: true;
  test: GateState;
  review: GateState;
  security: GateState;
}

export interface RunTests {
  passed: number | null;
  total: number | null;
}

export interface PhaseDuration {
  phase: string;
  startedAt: string | null;
  durationMs: number | null;
}

export interface PhaseSplitDuration {
  splitId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export interface AggregatedPhase {
  phase: string;
  splits: PhaseSplitDuration[];
  totalMs: number | null;
  complete: boolean;
}

export interface GradeSnapshot {
  ts: string | null;
  grade: string;
  score: number | null;
}

export interface RunDataJoin {
  runId: string;
  ts: string | null;
  source: string | null;
  intent: string | null;
  changeType: string | null;
  summary: string | null;
  description: string | null;
  commit: string | null;
  /** spec_impact normalized to lowercase; null when absent. */
  specImpact: string | null;
  /** Raw spec_impact, case preserved. */
  specImpactRaw: string | null;
  affectedFrs: string[];
  newFrs: string[];
  tests: RunTests | null;
  /** DERIVED gates (`derived: true`), or null when nothing is derivable. */
  gates: RunGates | null;
  /** Iterate phase-timings, or null — render **n/a** (never synthesized). */
  phaseDurations: PhaseDuration[] | null;
  campaign: string | null;
  subIterateId: string | null;
}

export interface RunsResponse {
  status: "ok";
  runs: RunDataJoin[];
  runCount: number;
  gradeTrend: GradeSnapshot[];
  pipelinePhaseDurations: AggregatedPhase[];
  skippedLines: number;
}

export interface RunDetailResponse {
  status: "ok";
  /** null for an unknown runId (graceful — the endpoint never 404s a miss). */
  run: RunDataJoin | null;
}

export interface GradeTrendResponse {
  status: "ok";
  gradeTrend: GradeSnapshot[];
}

const base = (projectId: string) =>
  `${EXTERNAL_API}/projects/${encodeURIComponent(projectId)}`;

export async function getProjectRuns(projectId: string): Promise<RunsResponse> {
  return await httpJson<RunsResponse>(`${base(projectId)}/runs`);
}

export async function getProjectRun(
  projectId: string,
  runId: string,
): Promise<RunDetailResponse> {
  return await httpJson<RunDetailResponse>(
    `${base(projectId)}/runs/${encodeURIComponent(runId)}`,
  );
}

export async function getGradeTrend(
  projectId: string,
): Promise<GradeTrendResponse> {
  return await httpJson<GradeTrendResponse>(`${base(projectId)}/grade-trend`);
}

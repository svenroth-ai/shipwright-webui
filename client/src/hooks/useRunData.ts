/*
 * useRunData.ts — TanStack Query wrappers for the per-run data join
 * (FR-01.47, A02, campaign webui-wow-usability-2026-07-10):
 *   useProjectRuns(projectId)         → the logbook list + grade trend + pipeline agg
 *   useRunDetail(projectId, runId)     → the Record-rail per-run detail
 *   useGradeTrend(projectId)           → the grade-trend series alone
 *
 * Sequential poll, aligned with the transcript/run-config observers (not live):
 * the event log is appended once per completed run, so a 30 s cadence is ample.
 * Disabled without a projectId (and, for detail, a runId). `retry: false` — a
 * path-less/unknown project is a stable 4xx, not a transient failure; the
 * surface just renders an honest empty state. Pure observer — the WebUI never
 * writes the event log (Architecture rule 1).
 */

import { useQuery } from "@tanstack/react-query";

import {
  getGradeTrend,
  getProjectRun,
  getProjectRuns,
  type GradeTrendResponse,
  type RunDetailResponse,
  type RunsResponse,
} from "../lib/runDataApi";

/** 30 s — the event log changes per completed run, not live. */
export const RUN_DATA_POLL_MS = 30_000;

const runsKey = (projectId: string | null | undefined) =>
  ["run-data", "runs", projectId ?? "__none__"] as const;

const runDetailKey = (
  projectId: string | null | undefined,
  runId: string | null | undefined,
) => ["run-data", "run", projectId ?? "__none__", runId ?? "__none__"] as const;

const gradeTrendKey = (projectId: string | null | undefined) =>
  ["run-data", "grade-trend", projectId ?? "__none__"] as const;

/**
 * Shared query-options for the per-project run bundle. Exported so a consumer
 * that fans out over N projects at once (the Projects gallery's `useQueries`,
 * A15) reuses the EXACT same cache key + fetcher as `useProjectRuns` — one
 * cache entry per project, no drift, no double fetch. `null`/`undefined`
 * disables the query (synthesized rows never hit the endpoint).
 */
export function projectRunsQueryOptions(projectId: string | null | undefined) {
  return {
    queryKey: runsKey(projectId),
    queryFn: () => getProjectRuns(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: RUN_DATA_POLL_MS as number | false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    retry: false,
  };
}

export function useProjectRuns(projectId: string | null | undefined) {
  return useQuery<RunsResponse>(projectRunsQueryOptions(projectId));
}

export function useRunDetail(
  projectId: string | null | undefined,
  runId: string | null | undefined,
) {
  return useQuery<RunDetailResponse>({
    queryKey: runDetailKey(projectId, runId),
    queryFn: () => getProjectRun(projectId!, runId!),
    enabled: Boolean(projectId) && Boolean(runId),
    refetchInterval: RUN_DATA_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    retry: false,
  });
}

export function useGradeTrend(projectId: string | null | undefined) {
  return useQuery<GradeTrendResponse>({
    queryKey: gradeTrendKey(projectId),
    queryFn: () => getGradeTrend(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: RUN_DATA_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    retry: false,
  });
}

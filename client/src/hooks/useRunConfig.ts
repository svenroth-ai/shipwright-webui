/*
 * TanStack Query wrapper around `getRunConfig(projectId)`.
 *
 * Poll cadence is status-aware (plan B3):
 *   - `ok` + `config.status === "in_progress"`     → 5s
 *   - `ok` + `config.status === "needs_validation"` → 60s (low-frequency
 *      continued polling — recovery happens out-of-band; review O #14)
 *   - `ok` + `config.status === "complete" | "failed"` → off + refetch on focus
 *   - `missing | v1_legacy | invalid`              → off (no pipeline UI to drive)
 *
 * Webui never writes the run-config; this hook is a pure observer.
 */

import { useQuery } from "@tanstack/react-query";

import { getRunConfig } from "../lib/externalApi";
import type { RunConfigResponse } from "../lib/run-config-v2";

const RUN_CONFIG_KEY = (projectId: string | null | undefined) =>
  ["run-config", projectId ?? "__none__"] as const;

const POLL_IN_PROGRESS_MS = 5_000;
const POLL_NEEDS_VALIDATION_MS = 60_000;

export function runConfigPollIntervalMs(
  data: RunConfigResponse | undefined,
): number | false {
  if (!data || data.status !== "ok") return false;
  if (data.config.status === "in_progress") return POLL_IN_PROGRESS_MS;
  if (data.config.status === "needs_validation") {
    return POLL_NEEDS_VALIDATION_MS;
  }
  return false;
}

export function useRunConfig(projectId: string | null | undefined) {
  return useQuery<RunConfigResponse>({
    queryKey: RUN_CONFIG_KEY(projectId),
    queryFn: () => getRunConfig(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: (q) => runConfigPollIntervalMs(q.state.data),
    refetchOnWindowFocus: true,
    staleTime: 1_000,
  });
}

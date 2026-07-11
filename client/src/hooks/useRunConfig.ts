/*
 * TanStack Query wrapper around `getRunConfig(projectId)`.
 *
 * Poll cadence is status-aware (plan B3):
 *   - `ok` + `config.status === "in_progress"`     → 5s
 *   - `ok` + `config.status === "needs_validation"` → 60s (low-frequency
 *      continued polling — recovery happens out-of-band; review O #14)
 *   - `ok` + `config.status === "complete" | "failed"` → off + refetch on focus
 *   - `missing | v1_legacy`                        → off (stable no-pipeline)
 *   - `invalid`                                    → keep polling on a mild
 *      backoff (F15). A single torn run-config read (Windows rename window)
 *      surfaces as `invalid`; latching OFF would vanish the pipeline lane
 *      mid-run and never recover without a manual refocus. Keep polling so a
 *      transient flap self-heals; the server already masks most torn reads
 *      via its 30s last-good cache, so a client-visible `invalid` is rare.
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
// A transient `invalid` (torn run-config read) keeps polling on this backoff
// so the flap self-heals; slower than in_progress so a genuinely-broken config
// is not hammered (F15).
const POLL_INVALID_RETRY_MS = 10_000;

export function runConfigPollIntervalMs(
  data: RunConfigResponse | undefined,
): number | false {
  if (!data) return false;
  if (data.status === "invalid") return POLL_INVALID_RETRY_MS;
  if (data.status !== "ok") return false;
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

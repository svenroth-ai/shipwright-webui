/*
 * useProjectCompliance.ts — TanStack Query wrapper around
 * getProjectCompliance(projectId) (FR-01.43).
 *
 * 30 s poll (the dashboard regenerates between phases, not live). Disabled
 * without a projectId. `retry: false` — a path-less / unknown project is a
 * stable 4xx, not a transient failure worth retrying; the badge just renders
 * nothing. Webui never writes the dashboard; this hook is a pure observer.
 */

import { useQuery } from "@tanstack/react-query";

import { getProjectCompliance, type ComplianceResponse } from "../lib/complianceApi";

const POLL_MS = 30_000;

const complianceKey = (projectId: string | null | undefined) =>
  ["compliance", projectId ?? "__none__"] as const;

export function useProjectCompliance(projectId: string | null | undefined) {
  return useQuery<ComplianceResponse>({
    queryKey: complianceKey(projectId),
    queryFn: () => getProjectCompliance(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    retry: false,
  });
}

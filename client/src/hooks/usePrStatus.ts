import { useQuery } from "@tanstack/react-query";

import { getPrStatus, type PrStatus } from "../lib/prStatusApi";

/**
 * Open/merged status for a transcript PR card (iterate-2026-05-30-pr-card-status).
 *
 * Thin React-Query wrapper over GET /api/external/pr-status. `staleTime` 60 s +
 * `retry: false` so transcript re-renders and the 1 s poll don't hammer the
 * gh-backed route; any error leaves `data` undefined and the card simply shows
 * no badge.
 */
export function usePrStatus(prUrl: string | undefined) {
  return useQuery<PrStatus>({
    queryKey: ["pr-status", prUrl],
    queryFn: () => getPrStatus(prUrl as string),
    enabled: typeof prUrl === "string" && prUrl.length > 0,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

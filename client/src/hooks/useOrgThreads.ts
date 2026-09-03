/*
 * useOrgThreads — the Org page's per-lead follow-up-thread query (FR-04.42,
 * V4c). Wraps `GET /api/org/threads`, the composite read of every lead's
 * `lead-question-threads.json` (leadwright#35's producer, wired server-side
 * in `routes/org-threads-composite.ts`). Same shape and refresh cadence as
 * `useOrgRoster` — one round trip, `{data, isLoading, error}` — since it
 * backs the same page at the same rhythm.
 */

import { useQuery } from "@tanstack/react-query";

import { fetchOrgThreads, LEADS_USAGE_REFRESH_INTERVAL_MS } from "../lib/orgApi";

export const ORG_THREADS_QUERY_KEY = ["org", "threads"] as const;

export function useOrgThreads() {
  return useQuery({
    queryKey: ORG_THREADS_QUERY_KEY,
    queryFn: fetchOrgThreads,
    staleTime: LEADS_USAGE_REFRESH_INTERVAL_MS,
    refetchInterval: LEADS_USAGE_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

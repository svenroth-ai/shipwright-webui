/*
 * useOrgRoster — wraps `GET /api/org/leads`, the one composite roster read
 * (iterate spec Design Notes, "One composite endpoint, not N+1"). Refresh
 * cadence is the existing, named `LEADS_USAGE_REFRESH_INTERVAL_MS` — never
 * a newly-invented interval.
 */

import { useQuery } from "@tanstack/react-query";

import { fetchLeadsRoster, LEADS_USAGE_REFRESH_INTERVAL_MS } from "../lib/orgApi";

export const ORG_ROSTER_QUERY_KEY = ["org", "leads-roster"] as const;
const QUERY_KEY = ORG_ROSTER_QUERY_KEY;

export function useOrgRoster() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchLeadsRoster,
    staleTime: LEADS_USAGE_REFRESH_INTERVAL_MS,
    refetchInterval: LEADS_USAGE_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

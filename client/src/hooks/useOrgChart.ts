/*
 * useOrgChart — the ONE cached `GET /api/org/org-chart` read, shared by
 * `useOrgChartPresence()` (nav-gating) and `OrgPage.tsx` (chart body +
 * page-level broken state). Code-review fix: both previously ran their own
 * `useQuery` under DIFFERENT keys (`chart-presence` vs. `chart-presence-
 * detail`) calling the same `fetchOrgChart()`, so every Org page load fired
 * the request twice. One key, one cache entry, one fetch.
 *
 * E2E-discovery fix (AC-7's broken-chart scenario): THREE consumers share
 * this one query key (SidebarNav, CommandCenter, OrgPage), all mounted on
 * every `/org` load. TanStack Query's `retryOnMount` default (`true`) means
 * every one of those three observers, mounting against an already-errored
 * query, independently triggers its own fresh fetch attempt — each of which
 * fails and re-errors the query just as a LATER-settling sibling observer's
 * mount effect is checking the same "errored, so retry on mount" condition.
 * Measured: this cascade drove 1000+ requests/sec against `org-chart` on a
 * real 502 (malformed org-chart.json) before the fix landed, never
 * terminating within the test's timeout. `retry: false` alone does not
 * prevent it — that governs only the INNER retry decision within one fetch
 * attempt, not whether a newly-mounted observer re-triggers the OUTER fetch
 * at all. `retryOnMount: false` stops a new mount from re-fetching an
 * already-erroring query; the existing `staleTime: 60_000` still lets a
 * later genuine revisit refetch once that window passes.
 */

import { useQuery } from "@tanstack/react-query";

import { fetchOrgChart } from "../lib/orgApi";

export const ORG_CHART_QUERY_KEY = ["org", "chart"] as const;

export function useOrgChart() {
  return useQuery({
    queryKey: ORG_CHART_QUERY_KEY,
    queryFn: fetchOrgChart,
    retry: false,
    retryOnMount: false,
    staleTime: 60_000,
  });
}

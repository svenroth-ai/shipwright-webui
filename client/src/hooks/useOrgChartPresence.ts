/*
 * useOrgChartPresence — the SINGLE source of truth for "does the Org nav
 * entry show" (iterate spec Design Notes, "Nav presence"). Both
 * `SidebarNav.tsx` and `CommandCenter.tsx`'s consumption of
 * `getNavDestinations()` filter on THIS hook's signal — `navDestinations.ts`
 * itself stays a pure, synchronous, untouched module (A21/FR-01.65); a
 * hand-typed conditional there would be a second source of truth.
 *
 * Four states, never a bare boolean — `"absent"` fires ONLY on a confirmed
 * `org_chart_missing` 404 (never on network error, while loading, or on a
 * 502) so a transient failure never wipes the entry the operator needs to
 * see the failure on (AC-7).
 */

import { OrgChartMissingError } from "../lib/orgApi";
import { useOrgChart } from "./useOrgChart";

export type OrgChartPresence = "loading" | "present" | "absent" | "broken";

/**
 * Derives the 4-state nav-gating signal from the SAME shared `useOrgChart()`
 * cache entry `OrgPage.tsx` reads for the chart body — one fetch, two
 * consumers, no duplicate `GET /api/org/org-chart` (code-review fix).
 */
export function useOrgChartPresence(): OrgChartPresence {
  const query = useOrgChart();

  if (query.isPending) return "loading";
  if (query.isSuccess) return "present";
  return query.error instanceof OrgChartMissingError ? "absent" : "broken";
}

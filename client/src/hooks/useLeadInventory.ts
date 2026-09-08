/*
 * useLeadInventory — the Lead Inventory page's composite query
 * (iterate-2026-09-08-lead-inventory-page). Wraps `GET /api/org/inventory`.
 * Same shape and refresh cadence as `useOrgThreads` — one round trip,
 * `{data, isLoading, error}` — since it backs a similarly-paced page.
 */

import { useQuery } from "@tanstack/react-query";

import { fetchOrgInventory } from "../lib/leadInventoryApi";
import { LEADS_USAGE_REFRESH_INTERVAL_MS } from "../lib/orgApi";

export const LEAD_INVENTORY_QUERY_KEY = ["org", "inventory"] as const;

export function useLeadInventory() {
  return useQuery({
    queryKey: LEAD_INVENTORY_QUERY_KEY,
    queryFn: fetchOrgInventory,
    staleTime: LEADS_USAGE_REFRESH_INTERVAL_MS,
    refetchInterval: LEADS_USAGE_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

/*
 * useTriage.ts — TanStack Query hooks for the Triage tab + sidebar badge.
 *
 * Polling cadence: 30 s (matches transcript poll). Auto-suppressed when
 * the tab is not active (TanStack `enabled` flag). Sidebar counts hook
 * has exponential-backoff on 5xx after 3 consecutive failures (LOW
 * external review #14).
 */

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  dismissTriageItem,
  fetchTriage,
  getTriageCounts,
  promoteTriageItem,
  snoozeTriageItem,
  type PromoteBody,
  type PromoteResult,
  type StatusFlipBody,
  type TriageCountsResponse,
  type TriageItem,
  type TriageListResponse,
  type TriageOrigin,
} from "../lib/triageApi";

const POLL_MS = 30_000;

const itemsKey = (projectId: string) => ["triage", "items", projectId] as const;
const countsKey = ["triage", "counts"] as const;

const DEGRADED_ORIGIN: TriageOrigin = { available: false, behind: null };

/**
 * Shared query config for the triage list endpoint. `useTriageItems` and
 * `useTriageDrift` reuse the SAME queryKey + queryFn so TanStack fetches once
 * and each hook applies its own `select` — no duplicate request.
 */
function triageListQuery(projectId: string | undefined, enabled: boolean) {
  return {
    queryKey: itemsKey(projectId ?? ""),
    queryFn: (): Promise<TriageListResponse> =>
      projectId
        ? fetchTriage(projectId)
        : Promise.resolve({ items: [], origin: DEGRADED_ORIGIN }),
    enabled: Boolean(projectId) && enabled,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  };
}

export function useTriageItems(
  projectId: string | undefined,
  opts: { enabled?: boolean } = {},
) {
  return useQuery<TriageListResponse, Error, TriageItem[]>({
    ...triageListQuery(projectId, opts.enabled ?? true),
    select: (r) => r.items,
  });
}

/**
 * Origin drift for the staleness banner (shares the list query — no extra
 * fetch). `behind > 0` means locally-visible dismisses may lag until a pull.
 */
export function useTriageDrift(
  projectId: string | undefined,
  opts: { enabled?: boolean } = {},
) {
  return useQuery<TriageListResponse, Error, TriageOrigin>({
    ...triageListQuery(projectId, opts.enabled ?? true),
    select: (r) => r.origin,
  });
}

/**
 * Derived from `triageListQuery` — same queryKey AND queryFn (the raw
 * `TriageListResponse`, not a pre-selected shape) — so a `useQueries`
 * caller (TriagePage, for the Domain filter's live option list + the
 * page-level aggregate hidden-count) shares the exact cache entry
 * `useTriageItems`/`useTriageDrift` already populate. TanStack caches
 * by queryKey regardless of which call populates it first — a queryFn
 * returning a DIFFERENT shape under the same key would poison the
 * cache for whichever hook runs second (caught before it shipped: an
 * earlier draft duplicated `triageListQuery`'s shape by hand with its
 * queryFn pre-selecting `.items`, which would have broken
 * `useTriageItems`'s own `select: r => r.items` the moment this hook's
 * fetch won the race — deriving from the one shared function instead
 * of re-declaring it structurally guarantees the two can't drift, per
 * code-reviewer). `refetchInterval: false` deliberately overridden —
 * the section-owned `useTriageItems` observer on the same key already
 * drives the 30s poll; this aggregation only needs to read what's
 * already cached; see iterate-2026-08-08-triage-filters-sort-parked
 * plan review finding 6.
 */
function triageItemsQueryOptions(projectId: string) {
  return { ...triageListQuery(projectId, true), refetchInterval: false as const };
}

export function useAllTriageItems(projectIds: readonly string[]) {
  return useQueries({
    queries: projectIds.map((id) => ({
      ...triageItemsQueryOptions(id),
      select: (r: TriageListResponse) => r.items,
    })),
  });
}

export function useTriageCounts(opts: { enabled?: boolean } = {}) {
  return useQuery<TriageCountsResponse>({
    queryKey: countsKey,
    queryFn: getTriageCounts,
    enabled: opts.enabled ?? true,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: (failureCount, _error) => failureCount < 3,
    retryDelay: (failureCount) => Math.min(15_000 * 2 ** failureCount, 300_000),
  });
}

export function usePromoteTriageItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation<PromoteResult, Error, PromoteBody>({
    mutationFn: (body) => promoteTriageItem(projectId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itemsKey(projectId) });
      void qc.invalidateQueries({ queryKey: countsKey });
      void qc.invalidateQueries({ queryKey: ["external-tasks"] });
    },
  });
}

export function useDismissTriageItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StatusFlipBody) => dismissTriageItem(projectId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itemsKey(projectId) });
      void qc.invalidateQueries({ queryKey: countsKey });
    },
  });
}

export function useSnoozeTriageItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StatusFlipBody) => snoozeTriageItem(projectId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itemsKey(projectId) });
      void qc.invalidateQueries({ queryKey: countsKey });
    },
  });
}

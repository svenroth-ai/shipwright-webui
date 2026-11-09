/*
 * useTriage.ts — TanStack Query hooks for the Triage tab + sidebar badge.
 *
 * Polling cadence: 30 s (matches transcript poll). Auto-suppressed when
 * the tab is not active (TanStack `enabled` flag). Sidebar counts hook
 * has exponential-backoff on 5xx after 3 consecutive failures (LOW
 * external review #14).
 */

import { useCallback } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { snoozeMutationKey } from "./useSnoozePending";
import {
  amendTriageItem,
  dismissTriageItem,
  fetchTriage,
  getTriageCounts,
  promoteTriageItem,
  snoozeTriageItem,
  type AmendBody,
  type PromoteBody,
  type PromoteResult,
  type StatusFlipBody,
  type TriageCountsResponse,
  type TriageItem,
  type TriageListResponse,
  type TriageOrigin,
} from "../lib/triageApi";
import type { TriageEntry } from "../lib/triageFilterSort";

const POLL_MS = 30_000;
const WRITE_AVAILABILITY_RETRY_MS = 1_000;

const itemsKey = (projectId: string) => ["triage", "items", projectId] as const;
const countsKey = ["triage", "counts"] as const;

const DEGRADED_ORIGIN: TriageOrigin = { available: false, behind: null };

/**
 * Shared query config for the triage list endpoint. `useTriageItems` and
 * `useTriageDrift` reuse the SAME queryKey + queryFn so TanStack fetches once
 * and each hook applies its own `select` — no duplicate request.
 */
function triageListQuery(projectId: string | undefined, enabled: boolean, poll = true) {
  return {
    queryKey: itemsKey(projectId ?? ""),
    queryFn: (): Promise<TriageListResponse> =>
      projectId
        ? fetchTriage(projectId)
        : Promise.resolve({ items: [], origin: DEGRADED_ORIGIN }),
    enabled: Boolean(projectId) && enabled,
    refetchInterval: poll
      ? (query: { state: { data?: TriageListResponse } }) =>
          query.state.data?.origin.write?.checking === true ? WRITE_AVAILABILITY_RETRY_MS : POLL_MS
      : (false as const),
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
  // Read-only observer: every card mounts one, and each observer would run its
  // own interval timer — the page's useAllTriageItems owns the polling.
  return useQuery<TriageListResponse, Error, TriageOrigin>({
    ...triageListQuery(projectId, opts.enabled ?? true, false),
    select: (r) => r.origin,
  });
}

/**
 * Aggregated view for the Triage page (iterate-2026-11-08-triage-page-redesign).
 * Derived from `triageListQuery` — same queryKey AND queryFn (the raw
 * `TriageListResponse`) — so it shares the exact cache entry the per-card
 * `useTriageDrift` / modal `useTriageItems` observers use. It is now the
 * POLLING OWNER of the page (the per-project sections that used to drive the
 * 30 s poll are gone), so the refetch interval is NOT overridden here.
 * `combine` is a module-level function so the aggregate keeps a stable
 * identity until a query result actually changes.
 */
export interface TriageProjectStatus {
  projectId: string;
  isLoading: boolean;
  isError: boolean;
  behind: number | null;
  originAvailable: boolean;
  refetch: () => void;
}

export interface TriageAggregate {
  entries: TriageEntry[];
  statuses: TriageProjectStatus[];
}

export function useAllTriageItems(projectIds: readonly string[]): TriageAggregate {
  const combine = useCallback(
    (results: UseQueryResult<TriageListResponse>[]): TriageAggregate => ({
      entries: results.flatMap((r, i) =>
        (r.data?.items ?? []).map((item) => ({ projectId: projectIds[i], item })),
      ),
      statuses: results.map((r, i) => ({
        projectId: projectIds[i],
        isLoading: r.isLoading,
        isError: r.isError,
        behind: r.data?.origin.behind ?? null,
        originAvailable: r.data?.origin.available !== false,
        refetch: () => void r.refetch(),
      })),
    }),
    [projectIds],
  );
  return useQueries({
    queries: projectIds.map((id) => triageListQuery(id, true)),
    combine,
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
    mutationKey: snoozeMutationKey(projectId),
    mutationFn: (body: StatusFlipBody) => snoozeTriageItem(projectId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itemsKey(projectId) });
      void qc.invalidateQueries({ queryKey: countsKey });
    },
  });
}

/**
 * Live-refetching view of a single item — a caller (TriageDetailModal) that
 * holds `item` as a one-time prop snapshot from a parent's card click stays
 * current after a mutation invalidates the shared list cache (e.g. Edit /
 * amend), instead of displaying stale pre-mutation content in an already-open
 * modal. Falls back to the prop when the cache has no entry yet (first paint)
 * or the item fell out of the resolved set.
 */
export function useTriageDisplayItem(projectId: string, item: TriageItem): TriageItem {
  const liveItems = useTriageItems(projectId);
  return liveItems.data?.find((i) => i.id === item.id) ?? item;
}

export function useAmendTriageItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AmendBody) => amendTriageItem(projectId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itemsKey(projectId) });
    },
  });
}

/*
 * useTriage.ts — TanStack Query hooks for the Triage tab + sidebar badge.
 *
 * Polling cadence: 30 s (matches transcript poll). Auto-suppressed when
 * the tab is not active (TanStack `enabled` flag). Sidebar counts hook
 * has exponential-backoff on 5xx after 3 consecutive failures (LOW
 * external review #14).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

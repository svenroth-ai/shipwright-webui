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
  getTriageCounts,
  listTriageItems,
  promoteTriageItem,
  snoozeTriageItem,
  type PromoteBody,
  type PromoteResult,
  type StatusFlipBody,
  type TriageCountsResponse,
  type TriageItem,
} from "../lib/triageApi";

const POLL_MS = 30_000;

const itemsKey = (projectId: string) => ["triage", "items", projectId] as const;
const countsKey = ["triage", "counts"] as const;

export function useTriageItems(
  projectId: string | undefined,
  opts: { enabled?: boolean } = {},
) {
  return useQuery<TriageItem[]>({
    queryKey: itemsKey(projectId ?? ""),
    queryFn: () => {
      if (!projectId) return Promise.resolve([]);
      return listTriageItems(projectId);
    },
    enabled: Boolean(projectId) && (opts.enabled ?? true),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
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

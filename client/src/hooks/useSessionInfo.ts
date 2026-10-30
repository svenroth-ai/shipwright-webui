/*
 * useSessionInfo — the read-only session-info query behind the Mission right
 * sidebar (campaign mission-desktop-style, M3).
 *
 * COST CONTRACT: the endpoint rescans up to 48 MB per request, so there is NO
 * timer at all (operator decision on the M3 architecture review). Data is
 * fetched on Mission entry (mount, once stale), on window focus, on a task-state
 * change, and on an explicit manual refresh (`refetch`). staleTime keeps rapid
 * tab flips from re-scanning.
 *
 * Remote Control is informational only (a recycled pid can read as active after
 * a crash); with no polling there is nothing to debounce, so the pill is just
 * the last answer — or "unknown" when there is none.
 */

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  fetchSessionInfo,
  type SessionInfoResponse,
} from "../lib/sessionInfoApi";

/** Mount/focus refetches within this window of the last answer are no-ops (an explicit `refetch` is not). */
export const SESSION_INFO_STALE_MS = 30_000;

const infoKey = (taskId: string | null | undefined) =>
  ["session-info", taskId ?? "__none__"] as const;

export function useSessionInfo(
  taskId: string | null | undefined,
  taskState: string | null | undefined,
) {
  const query = useQuery<SessionInfoResponse>({
    queryKey: infoKey(taskId),
    queryFn: () => fetchSessionInfo(taskId as string),
    enabled: Boolean(taskId),
    staleTime: SESSION_INFO_STALE_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // A task-state change (launch, idle, done) is exactly when the numbers moved.
  const { refetch } = query;
  const lastState = useRef(taskState);
  useEffect(() => {
    if (lastState.current === taskState) return;
    lastState.current = taskState;
    if (taskId) void refetch();
  }, [taskId, taskState, refetch]);

  return query;
}

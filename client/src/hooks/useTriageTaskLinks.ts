/*
 * useTriageTaskLinks — the Fix-now task each triage item already has
 * (iterate-2026-11-09-triage-fixnow-task). Shares the all-projects task list
 * query with the Board (same key, so one fetch); only the page-level caller
 * polls, the per-card callers just read the cache.
 */

import { useQuery } from "@tanstack/react-query";

import { listTasks, type ExternalTask } from "../lib/externalApi";
import { buildTaskLinks } from "../lib/triageTaskLinks";

const POLL_MS = 5_000;
const EMPTY: Map<string, ExternalTask> = new Map();

export function useTriageTaskLinks(poll = false): Map<string, ExternalTask> {
  const q = useQuery<ExternalTask[], Error, Map<string, ExternalTask>>({
    queryKey: ["external-tasks", null] as const,
    queryFn: () => listTasks({ projectId: null }),
    select: buildTaskLinks,
    refetchInterval: poll ? POLL_MS : false,
    refetchIntervalInBackground: false,
    // Card-level readers must not refetch the whole list on every mount; the
    // polling page owns freshness (a cold cache still fetches once).
    refetchOnMount: poll,
  });
  return q.data ?? EMPTY;
}

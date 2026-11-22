/*
 * useReminders — the one shared read of what is due (campaign reminders-webui,
 * W3). ONE query key for the Inbox page and the sidebar count, so they never
 * disagree and never cost a second CLI run. The server asks the Shipwright
 * reminder CLI (the WebUI never reads or writes reminders.jsonl itself).
 *
 * The count is an alert, so it only counts what was actually READ: a project
 * whose answer is a problem state contributes nothing to the number, and the
 * Inbox page shows the problem itself (never as "nothing due").
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchRemindersDue,
  hasData,
  reminderAdd,
  reminderDone,
  reminderSnooze,
  type ReminderAddBody,
  type RemindersDueResponse,
  type ReminderProjectDue,
} from "../lib/remindersApi";

export const REMINDERS_KEY = ["reminders-due"] as const;

/** Due reminders change by the day, not by the second; a focus refetch covers the rest. */
const POLL_MS = 120_000;

export function useRemindersDue() {
  return useQuery<RemindersDueResponse>({
    queryKey: REMINDERS_KEY,
    queryFn: fetchRemindersDue,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: 60_000, // a tab refocus must not start a burst of tool runs (writes invalidate explicitly)
    retry: false,
  });
}

/** Items the operator has to look at: due reminders + expired parked triage. */
export function countDueItems(projects: readonly ReminderProjectDue[] | undefined): number {
  let n = 0;
  for (const p of projects ?? []) if (hasData(p)) n += p.items?.length ?? 0;
  return n;
}

function useWrite<V>(fn: (v: V) => ReturnType<typeof reminderDone>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (r.ok) void qc.invalidateQueries({ queryKey: REMINDERS_KEY });
    },
  });
}

export const useReminderDone = () =>
  useWrite<{ projectId: string; id: string }>((v) => reminderDone(v.projectId, v.id));

export const useReminderSnooze = () =>
  useWrite<{ projectId: string; id: string; until: string }>((v) => reminderSnooze(v.projectId, v.id, v.until));

export const useReminderAdd = () =>
  useWrite<{ projectId: string; body: ReminderAddBody }>((v) => reminderAdd(v.projectId, v.body));

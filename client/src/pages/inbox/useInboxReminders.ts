/*
 * useInboxReminders — the reminder half of the Inbox data (campaign
 * reminders-webui, W3). Reads the ONE shared due query (the sidebar count reads
 * the same one), flattens it into entries, summarises what is wrong with the
 * answer, and merges the entries into the project groups the page already
 * renders. A kept-apart hook (not part of useInboxData) so the session-entry
 * derivation stays exactly as it was.
 *
 * Rule: a problem is never "nothing due". While the first answer is on its way
 * `isLoading` is true; after a failed request `problems.requestFailed` is true.
 */
import { useMemo } from "react";

import { useRemindersDue } from "../../hooks/useReminders";
import { UNASSIGNED_PROJECT_ID } from "../../lib/projectIds";
import type { Project } from "../../types";
import { entriesForProject, type ReminderEntry } from "./reminderModel";
import { reminderProblems, type ReminderProblems } from "./reminderProblems";
import type { ProjectGroup } from "./types";

export interface InboxReminders {
  entries: ReminderEntry[];
  problems: ReminderProblems;
  isLoading: boolean;
  refetch: () => void;
}

export function useInboxReminders(): InboxReminders {
  const q = useRemindersDue();
  const projects = q.data?.projects;
  const entries = useMemo(() => (projects ?? []).flatMap(entriesForProject), [projects]);
  const problems = useMemo(() => reminderProblems(projects, q.isError), [projects, q.isError]);
  return { entries, problems, isLoading: q.isLoading, refetch: () => void q.refetch({ cancelRefetch: false }) };
}

/** Put each entry into its project's group (creating the group when the project has no session entries). */
export function mergeReminders(
  groups: readonly ProjectGroup[],
  entries: readonly ReminderEntry[],
  projectsById: ReadonlyMap<string, Project>,
): ProjectGroup[] {
  if (entries.length === 0) return [...groups];
  const map = new Map<string, ProjectGroup>(groups.map((g) => [g.projectId, { ...g }]));
  for (const e of entries) {
    const existing = map.get(e.projectId);
    if (existing) {
      existing.reminders = [...(existing.reminders ?? []), e];
      existing.totalItems += 1;
      continue;
    }
    const project = projectsById.get(e.projectId);
    map.set(e.projectId, {
      projectId: e.projectId,
      projectName: project?.name ?? "Unassigned",
      project: e.projectId === UNASSIGNED_PROJECT_ID ? undefined : project,
      sessions: [],
      reminders: [e],
      totalItems: 1,
    });
  }
  return Array.from(map.values());
}

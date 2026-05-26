/*
 * useInboxData — thin derivation hook for the Inbox page (C7 — 2026-05-26).
 *
 * Wraps the three TanStack hooks that InboxPage used directly:
 *   - useExternalInbox()  — refetchInterval: 3s (per useExternalInbox.ts)
 *   - useExternalTasks()
 *   - useProjects()
 *
 * The hook owns ONLY pure derivation (session-grouping, project-grouping,
 * openCount). It MUST NOT mutate query keys, refetch cadence, or argument
 * shape (see external-plan-review HIGH findings).
 *
 * useMemo deps unpack `.data` from each query (gemini HIGH — wrapper objects
 * ref-change on refetch). isLoading mirrors the source: only inboxQuery's
 * loading state was consumed in the spinner (openai MED).
 *
 * Polling cadence is INHERITED from useExternalInbox; this hook does NOT
 * call useQuery itself, so CLAUDE.md Architecture rule 7 (no SSE, polling)
 * remains structurally enforced upstream.
 */
import { useMemo } from "react";

import { useExternalInbox } from "../../hooks/useExternalInbox";
import { useExternalTasks } from "../../hooks/useExternalTasks";
import { useProjects } from "../../hooks/useProjects";
import { UNASSIGNED_PROJECT_ID } from "../../lib/projectIds";
import type {
  ExternalTask,
  InboxItem,
} from "../../lib/externalApi";
import type { Project } from "../../types";
import type { ProjectGroup, SessionGroup } from "./types";

export interface InboxData {
  projectGroups: ProjectGroup[];
  openCount: number;
  isLoading: boolean;
  tasksById: Map<string, ExternalTask>;
}

export function useInboxData(): InboxData {
  const inboxQuery = useExternalInbox();
  const tasksQuery = useExternalTasks();
  const projectsQuery = useProjects();

  // Hoist .data references so useMemo dep arrays depend on the underlying
  // data, not the TanStack wrapper objects (gemini HIGH).
  const items = inboxQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const isLoading = inboxQuery.isLoading;

  const tasksById = useMemo(() => {
    const m = new Map<string, ExternalTask>();
    for (const t of tasks) m.set(t.taskId, t);
    return m;
  }, [tasks]);

  const projectsById = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);

  const sessionGroups = useMemo(() => groupBySession(items), [items]);

  // Bucket session groups by project. A session without a matching task (or
  // an "unassigned" task) falls into the "Unassigned" project.
  const projectGroups = useMemo<ProjectGroup[]>(() => {
    const map = new Map<string, ProjectGroup>();
    for (const sg of sessionGroups) {
      const task = tasksById.get(sg.taskId);
      const projectId =
        task && task.projectId !== UNASSIGNED_PROJECT_ID
          ? task.projectId
          : UNASSIGNED_PROJECT_ID;
      const projectName = resolveProjectName(task, projectsById);
      const project =
        projectId === UNASSIGNED_PROJECT_ID
          ? undefined
          : projectsById.get(projectId);
      const existing = map.get(projectId);
      if (existing) {
        existing.sessions.push(sg);
        existing.totalItems += sg.items.length;
      } else {
        map.set(projectId, {
          projectId,
          projectName,
          project,
          sessions: [sg],
          totalItems: sg.items.length,
        });
      }
    }
    return Array.from(map.values());
  }, [sessionGroups, tasksById, projectsById]);

  const openCount = useMemo(
    () => projectGroups.reduce((sum, pg) => sum + pg.totalItems, 0),
    [projectGroups],
  );

  return { projectGroups, openCount, isLoading, tasksById };
}

function groupBySession(items: InboxItem[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const item of items) {
    const existing = groups.get(item.sessionUuid);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(item.sessionUuid, {
        sessionUuid: item.sessionUuid,
        taskId: item.taskId,
        taskTitle: item.taskTitle,
        items: [item],
      });
    }
  }
  return Array.from(groups.values());
}

function resolveProjectName(
  task: ExternalTask | undefined,
  projectsById: Map<string, Project>,
): string {
  if (!task) return "Unassigned";
  if (task.projectId === UNASSIGNED_PROJECT_ID) return "Unassigned";
  return projectsById.get(task.projectId)?.name ?? "Unassigned";
}

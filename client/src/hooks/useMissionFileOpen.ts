/*
 * useMissionFileOpen — V6: lets file chips in the Mission chat open the Smart
 * Viewer in the info sidebar through the SAME path the Outputs rows use. The
 * request object is new per open, so repeating the same file re-opens the Viewer.
 */

import { useEffect, useMemo, useState } from "react";

import type { FileOpenValue } from "../components/external/FileOpenContext";
import type { ExternalTask } from "../lib/externalApi";
import { UNASSIGNED_PROJECT_ID } from "../lib/projectIds";
import type { ViewerTarget } from "../lib/viewerTarget";
import { useProject } from "./useProjects";

export interface ViewerRequest {
  target: ViewerTarget;
  nonce: number;
}

/** Project root + readiness of a task's project (shared by every file-open surface). */
export function useTaskFileScope(task: ExternalTask | undefined) {
  const unassigned = !task || task.projectId === UNASSIGNED_PROJECT_ID;
  const projectQ = useProject(unassigned ? "" : task.projectId);
  const projectRoot = projectQ.data?.path ?? null;
  // isSuccess only: a failed project query must not tag inside files as "outside project".
  return { projectRoot, ready: unassigned || projectQ.isSuccess };
}

export function useMissionFileOpen(task: ExternalTask, onOpened: () => void) {
  const { projectRoot, ready } = useTaskFileScope(task);
  // Remembers which task asked, so a request never leaks into the next task's sidebar.
  const [asked, setAsked] = useState<(ViewerRequest & { taskId: string }) | null>(null);
  // Leaving a task forgets its request, so returning to it never replays the last chip click.
  useEffect(() => setAsked(null), [task.taskId]);
  const request = useMemo<ViewerRequest | null>(
    () => (asked && asked.taskId === task.taskId ? { target: asked.target, nonce: asked.nonce } : null),
    [asked, task.taskId],
  );
  const fileOpen = useMemo<FileOpenValue>(
    () => ({
      projectRoot,
      cwd: task.cwd,
      ready,
      open: (target) => {
        setAsked((prev) => ({ taskId: task.taskId, target, nonce: (prev?.nonce ?? 0) + 1 }));
        onOpened();
      },
    }),
    [projectRoot, task.cwd, ready, onOpened, task.taskId],
  );
  return { fileOpen, request };
}

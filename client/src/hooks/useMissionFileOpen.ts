/*
 * useMissionFileOpen — V6: lets file chips in the Mission chat open the Smart
 * Viewer in the info sidebar through the SAME path the Outputs rows use. The
 * request object is new per open, so repeating the same file re-opens the Viewer.
 */

import { useMemo, useState } from "react";

import type { FileOpenValue } from "../components/external/FileOpenContext";
import type { ExternalTask } from "../lib/externalApi";
import { UNASSIGNED_PROJECT_ID } from "../lib/projectIds";
import type { ViewerTarget } from "../lib/viewerTarget";
import { useProject } from "./useProjects";

export interface ViewerRequest {
  target: ViewerTarget;
  nonce: number;
}

export function useMissionFileOpen(task: ExternalTask, onOpened: () => void) {
  const unassigned = task.projectId === UNASSIGNED_PROJECT_ID;
  const projectRoot = useProject(unassigned ? "" : task.projectId).data?.path ?? null;
  const [request, setRequest] = useState<ViewerRequest | null>(null);
  const fileOpen = useMemo<FileOpenValue>(
    () => ({
      projectRoot,
      open: (target) => {
        setRequest((prev) => ({ target, nonce: (prev?.nonce ?? 0) + 1 }));
        onOpened();
      },
    }),
    [projectRoot, onOpened],
  );
  return { fileOpen, request };
}

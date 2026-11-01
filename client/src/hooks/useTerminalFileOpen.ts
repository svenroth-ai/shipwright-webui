/*
 * useTerminalFileOpen - the FileOpenValue for the Files & Terminal page's terminal
 * links (FR-01.28): the same project-root / cwd / ready derivation the Mission chat
 * chips use (`useTaskFileScope`), with the page-owned `open` (it sets the shared
 * Viewer request, which switches the right card to the Viewer).
 */
import { useMemo } from "react";

import type { FileOpenValue } from "../components/external/FileOpenContext";
import type { ExternalTask } from "../lib/externalApi";
import type { ViewerTarget } from "../lib/viewerTarget";
import { useTaskFileScope } from "./useMissionFileOpen";

export function useTerminalFileOpen(task: ExternalTask | undefined, open: (target: ViewerTarget) => void): FileOpenValue | undefined {
  const { projectRoot, ready } = useTaskFileScope(task);
  const cwd = task?.cwd;
  return useMemo(() => (task ? { projectRoot, cwd, ready, open } : undefined), [task, projectRoot, cwd, ready, open]);
}

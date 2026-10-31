/*
 * FileOpenContext — lets markdown rendered inside the Mission tab turn file
 * paths (backticks / markdown links) into `.mc-file` chips that open the Smart
 * Viewer through the SAME path as the Outputs rows (V6). Outside a provider
 * (inbox, skill cards, the plain transcript) the context is null and markdown
 * renders exactly as before.
 */

import { createContext, useContext } from "react";

import { targetFromText, type ViewerTarget } from "../../lib/viewerTarget";

export interface FileOpenValue {
  /** Registered project root (null = unassigned task). */
  projectRoot: string | null;
  /** False while the task's project is still loading: inside paths cannot be resolved yet, so no chips. Default true. */
  ready?: boolean;
  open: (target: ViewerTarget) => void;
}

export const FileOpenContext = createContext<FileOpenValue | null>(null);

export function useFileOpen(): FileOpenValue | null {
  return useContext(FileOpenContext);
}

/** Text -> openable target under the current provider; null when none / not a file. */
export function useFileTarget(raw: string, decode = false): ViewerTarget | null {
  const ctx = useFileOpen();
  return ctx && ctx.ready !== false ? targetFromText(raw, ctx.projectRoot, { decode }) : null;
}

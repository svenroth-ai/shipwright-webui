/*
 * taskDeepLink — the ONE place that builds/reads the "open this task's
 * embedded terminal" deep link (A19, FR-01.63).
 *
 * The Inbox's honest terminal fallback (DECIDED BY SVEN, 2026-07-14) navigates
 * the operator to `/tasks/<id>` with the Files & Terminal pane + Terminal
 * segment selected and the terminal focused, where THEY type the reply. The
 * link carries that intent as query params so it survives a reload and is a real
 * deep link — and so no component has to hand-write the `?pane=terminal` literal
 * (deliverable #2: do not scatter query-string literals through components).
 *
 * This module navigates only. There is deliberately NO write-path here.
 */

export const TASK_PANE_PARAM = "pane";
export const TASK_FOCUS_PARAM = "focus";
export const TASK_TERMINAL_VALUE = "terminal";

/**
 * Build the deep link that opens a task's terminal, focused and ready:
 *   `/tasks/<encoded-id>?pane=terminal&focus=terminal`
 */
export function buildTaskTerminalDeepLink(taskId: string): string {
  const params = new URLSearchParams();
  params.set(TASK_PANE_PARAM, TASK_TERMINAL_VALUE);
  params.set(TASK_FOCUS_PARAM, TASK_TERMINAL_VALUE);
  return `/tasks/${encodeURIComponent(taskId)}?${params.toString()}`;
}

/**
 * True when a location's search string carries the "focus the terminal" intent
 * (either `pane=terminal` or `focus=terminal`). TaskDetail reads this to select
 * the Files & Terminal pane + Terminal segment and mark a pending focus, then
 * strips the query so a reload does not re-snap focus.
 */
export function parseTerminalFocusIntent(search: string): boolean {
  if (!search) return false;
  const normalized = search.startsWith("?") ? search : `?${search}`;
  const params = new URLSearchParams(normalized);
  return (
    params.get(TASK_PANE_PARAM) === TASK_TERMINAL_VALUE ||
    params.get(TASK_FOCUS_PARAM) === TASK_TERMINAL_VALUE
  );
}

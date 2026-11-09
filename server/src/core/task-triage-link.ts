/*
 * task-triage-link.ts — iterate-2026-11-09-triage-fixnow-task.
 *
 * The triage item a Fix-now task was started from (`trg-<8hex>`). User-
 * creatable via POST /api/external/tasks (unlike the daemon-owned
 * promotedFromTriageId). Triage ids are only unique per project, so readers
 * pair it with the task's `projectId`. Lives in its own module so the
 * grandfathered sdk-sessions-store stays within its bloat ceiling.
 */

/** `trg-` + 8 hex — the triage item id shape (matches the promote route). */
export const TRIAGE_ID_RE = /^trg-[0-9a-f]{8}$/;

export interface TaskTriageLink {
  fixNowForTriageId?: string;
}

/** Read the link from a create body or a persisted record; malformed → absent. */
export function readFixNowTriageId(src: Record<string, unknown>): TaskTriageLink {
  const v = src.fixNowForTriageId;
  return typeof v === "string" && TRIAGE_ID_RE.test(v) ? { fixNowForTriageId: v } : {};
}

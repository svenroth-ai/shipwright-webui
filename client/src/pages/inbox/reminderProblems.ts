/*
 * reminderProblems — what is WRONG with the reminder answer, as data
 * (mockup page 06). The rule: when something is wrong, never show "nothing
 * due". A project whose answer could not be read is `unavailable`; a failed
 * triage read (`triageError`) and damaged store lines (`reminderCorruptLines`)
 * are surfaced next to the data that was read. A project that only SHARES
 * another registration's store is not counted twice for damaged lines.
 */
import { hasData, type ReminderProjectDue } from "../../lib/remindersApi";

export interface ReminderProblems {
  /** Projects whose reminders could not be read at all (tool missing, unknown version, ...). */
  unavailable: { projectId: string; state: string; reason: string | null }[];
  /** Projects whose parked triage items were not checked. */
  triageErrors: { projectId: string; detail: string }[];
  /** Damaged lines across distinct reminder stores. */
  corruptLines: number;
  /** The whole request failed (the server did not answer): the same "unavailable". */
  requestFailed: boolean;
  any: boolean;
  /**
   * Part of the answer is missing (a project unreadable, the request failed, or parked triage not checked), so the
   * count is only what WAS read: the sidebar badge shows a "!" for it. Damaged lines alone do not (the rest was read).
   */
  cannotRead: boolean;
}

export function reminderProblems(
  projects: readonly ReminderProjectDue[] | undefined,
  requestFailed: boolean,
): ReminderProblems {
  const unavailable: ReminderProblems["unavailable"] = [];
  const triageErrors: ReminderProblems["triageErrors"] = [];
  let corruptLines = 0;
  for (const p of projects ?? []) {
    if (!hasData(p)) {
      unavailable.push({ projectId: p.projectId, state: p.state, reason: typeof p.reason === "string" ? p.reason : null });
      continue;
    }
    if (typeof p.triageError === "string") triageErrors.push({ projectId: p.projectId, detail: p.triageError });
    if (!p.remindersSharedWithProjectId) corruptLines += p.reminderCorruptLines ?? 0;
  }
  return {
    unavailable,
    triageErrors,
    corruptLines,
    requestFailed,
    any: requestFailed || unavailable.length > 0 || triageErrors.length > 0 || corruptLines > 0,
    cannotRead: requestFailed || unavailable.length > 0 || triageErrors.length > 0,
  };
}

/*
 * decisionMessages — the operator-facing wording of the proposal decisions (split out of
 * useDecisionActions.ts to stay under the 300-line convention). No quote text ever appears here.
 */
import type { RejectResult } from "../../lib/orgRejectApi";
import type { EntryStatus } from "./DecisionEntryRow";

export const LINE_PROBLEMS: Record<string, string> = {
  line_empty: "The line is empty. Write the line you want in the log.",
  line_too_long: "The line is too long. Shorten it (2000 characters at most).",
  line_contains_quote: "Your line repeats a quote from the lead. Quotes never go into the log - rewrite it in your own words.",
  edit_not_supported: "This entry has no editable line.",
  line_invalid: "The line must be plain text.",
  note_too_long: "The note is too long. Shorten it (600 characters at most).",
  note_contains_quote: "Your note repeats a quote from the lead. Quotes never go into the log - write it in your own words.",
  note_invalid: "The note must be plain text.",
};

/** Why a reject reason was refused (nothing was changed). */
export const REASON_PROBLEMS: Record<string, string> = {
  reason_too_long: "The reason is too long. Shorten it (600 characters at most). Nothing was rejected.",
  reason_contains_quote: "Your reason repeats a quote from the lead. Leads read the reason, so write it in your own words. Nothing was rejected.",
  reason_invalid: "The reason must be plain text. Nothing was rejected.",
};

export const CHANGED = "This proposal changed since you opened it — reload. The list was refreshed; read the new version before deciding.";
export const UNWRITABLE = (message: string) => `Nothing was changed. ${message}`;
const adrLabel = (n: number) => `ADR-${String(n).padStart(4, "0")}`;

/** The row status of a reject that did not succeed. */
export function rejectFailureStatus(result: Exclude<RejectResult, { ok: true }>): EntryStatus {
  switch (result.reason) {
    case "duplicate": return { kind: "duplicate", count: result.count };
    case "already-countersigned": return { kind: "done", alreadyCountersigned: true, adr: adrLabel(result.adr) };
    case "audit-pending":
      return { kind: "blocked", message: `Logged as ${adrLabel(result.adr)}, but its audit record is missing - fix the lead's audit file, then use Countersign to finish. Nothing was rejected.` };
    case "lead-unknown": return { kind: "blocked", message: "Can't reject: this lead has no folder." };
    case "entry-changed": return { kind: "blocked", message: CHANGED };
    case "reason-rejected": return { kind: "blocked", message: REASON_PROBLEMS[result.code] ?? "The reason was not accepted. Nothing was rejected." };
    case "audit-unwritable":
      return { kind: "blocked", message: result.auditWritten ? `Half done: the audit record is written, the proposal is still listed. ${result.message}` : UNWRITABLE(result.message) };
    default: return { kind: "resolved-elsewhere" };
  }
}

/** The one-line notice after a reject that went through; claims only what the server says it did. */
export function rejectNotice(result: Extract<RejectResult, { ok: true }>, who: string): string {
  if (result.existingReason !== undefined) {
    const was = result.existingReason === null ? "without a reason" : `with the reason "${result.existingReason}"`;
    return `Rejected: ${who}. Its audit record already exists in the lead's audit file (${was}); the audit record keeps that reason. The rejected-decisions file the leads read records the reason sent when its block was written.`;
  }
  if (result.recorded) return `Rejected: ${who}. Recorded in the audit log.`;
  if (result.alreadyRejected) return `Already rejected earlier: ${who}. Nothing new was written.`;
  return `Rejected: ${who}. The audit record was already in the log; nothing new was written.`;
}

/** Wording of a duplicate-identity row: with a logged earlier version, Reject is the way out. */
export function duplicateMessage(count: number, loggedAdr?: string): string {
  return loggedAdr !== undefined
    ? `An earlier version of this proposal is already logged as ${loggedAdr}; this is a different version under the same identity. Use Reject to remove it from the list.`
    : `Two proposals share this identity (${count}) — resolve by hand.`;
}

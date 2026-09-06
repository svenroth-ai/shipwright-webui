/*
 * auditKindLabels.ts — plain-language labels for leadwright's audit event
 * vocabulary (iterate-2026-09-06-org-audit-timeline).
 *
 * Verbatim, dated mirror of the `AuditKind` union in leadwright's
 * `lib/audit-append.ts` (read 2026-09-06) — same cross-repo mirror
 * discipline `server/src/types/org.ts` already uses for the org-chart
 * shape (CLAUDE.md rule 7: shared shapes are verbatim mirrors, never a
 * cross-package import). This is the ENTIRE real vocabulary as of that
 * read — nothing here is invented. A `kind` not in this map (a future
 * addition to that union, or any other string) falls back to itself via
 * `auditKindLabel()` — rendered raw, never hidden or guessed at.
 */

export const AUDIT_KIND_LABELS: Record<string, string> = {
  beat_started: "Started a beat",
  beat_completed: "Completed a beat",
  beat_escalated: "Escalated a beat",
  beat_failed: "Beat failed",
  beat_timeout: "Beat timed out",
  beat_recovered: "Recovered a stuck beat",
  config_edit: "Edited configuration",
  learning_extracted: "Extracted a learning",
  learning_added_manual: "Learning added manually",
  tool_call_summary: "Tool call summary",
  kill_switch_refusal: "Refused by kill switch",
  beat_no_band_justification: "Beat had no band justification",
  po_feedback_decode_error: "Couldn't decode PO feedback",
  bundle_dismissed: "Dismissed a bundle",
  bundle_dismiss_partial: "Partially dismissed a bundle",
  claim_released: "Released a claim",
  claim_attempt_lost: "Lost a claim attempt",
  executor_liveness_undeterminable: "Executor liveness undeterminable",
  executor_not_tracked: "Executor not tracked",
};

/** An unseen `kind` renders as itself — never hidden, never guessed at. */
export function auditKindLabel(kind: string): string {
  return AUDIT_KIND_LABELS[kind] ?? kind;
}

import { describe, it, expect } from "vitest";
import { AUDIT_KIND_LABELS, auditKindLabel } from "./auditKindLabels";

describe("auditKindLabels", () => {
  it("has all 19 known AuditKind values mapped to a non-empty label", () => {
    const expected = [
      "beat_started",
      "beat_completed",
      "beat_escalated",
      "beat_failed",
      "beat_timeout",
      "beat_recovered",
      "config_edit",
      "learning_extracted",
      "learning_added_manual",
      "tool_call_summary",
      "kill_switch_refusal",
      "beat_no_band_justification",
      "po_feedback_decode_error",
      "bundle_dismissed",
      "bundle_dismiss_partial",
      "claim_released",
      "claim_attempt_lost",
      "executor_liveness_undeterminable",
      "executor_not_tracked",
    ];
    expect(Object.keys(AUDIT_KIND_LABELS).sort()).toEqual(expected.sort());
    for (const kind of expected) {
      expect(AUDIT_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it("renders a known kind's plain-language label", () => {
    expect(auditKindLabel("beat_completed")).toBe("Completed a beat");
  });

  it("renders an unseen kind by its own raw string, never hidden or guessed", () => {
    expect(auditKindLabel("some_future_kind_v2")).toBe("some_future_kind_v2");
  });
});

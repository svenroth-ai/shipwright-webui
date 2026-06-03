/*
 * triage.ts — TS shapes verbatim from `shared/scripts/triage.py` wire format.
 *
 * Canonical origin: `shared/scripts/triage.py` STATUSES / SEVERITIES /
 * KINDS enums + the resolved-view `read_all_items()` return shape.
 *
 * Drift protection: `core/triage-store.test.ts` parity test reads the
 * Python-generated fixture (`server/src/test/fixtures/triage-resolved.json`)
 * and asserts `readAllItems()` produces deep-equal output. When triage.py
 * adds/removes a field, regenerate via
 * `uv run server/scripts/regen-triage-fixtures.py` and update the types
 * here in lockstep.
 */

export type TriageStatus = "triage" | "promoted" | "dismissed" | "snoozed";
export type TriageSeverity = "critical" | "high" | "medium" | "low" | "info";
export type TriageKind =
  | "bug"
  | "feature"
  | "improvement"
  | "compliance"
  | "maintenance";
export type TriagePriority = "P0" | "P1" | "P2" | "P3";

/** Resolved item shape (one entry per triage id, last-status-wins by file order). */
export interface TriageItem {
  id: string;
  ts: string;
  originalTs: string;
  source: string;
  severity: TriageSeverity;
  kind: TriageKind;
  title: string;
  detail: string;
  evidencePath: string | null;
  runId: string | null;
  commit: string | null;
  dedupKey: string | null;
  /**
   * Producer-generated ready-to-paste block (slash command + context +
   * URL) introduced by shipwright iterate-2026-05-20-triage-launch-surface
   * (PR #41). Frozen at first append by the producer. Legacy producers
   * may omit the field entirely; iterate-2026-05-20-triage-launch-surface-webui
   * surfaces it in the Triage Detail modal as a copy-into-Claude block.
   * Optional in the type so legacy on-disk events still load.
   */
  launchPayload?: string | null;
  status: TriageStatus;
  suggestedPriority: TriagePriority;
  suggestedDomain: string;
  // Status-event overlay fields (null when no status event has fired)
  statusBy: string | null;
  statusReason: string | null;
  promotedTaskId: string | null;
  /**
   * FR-01.33 server-side enrichment (NOT a triage.py wire field): when a
   * campaign in this project has `expandsTriage == this item's id`, the GET
   * /api/triage route annotates the item with that campaign's slug + lifecycle
   * status. Drives the Triage "Start Campaign" action. Optional — null/absent
   * for non-campaign items. Derived per request; never persisted to
   * triage.jsonl, so `readAllItems()` (the parity-tested resolver) never sets it.
   */
  campaignSlug?: string | null;
  campaignStatus?: "draft" | "active" | "complete" | null;
}

/** On-disk status event line shape. */
export interface TriageStatusEvent {
  event: "status";
  id: string;
  ts: string;
  newStatus: TriageStatus;
  by: string;
  reason: string | null;
  promotedTaskId: string | null;
}

/** Wire shape for promote/dismiss/snooze response bodies. */
export interface TriageActionResponse {
  triageId: string;
  newStatus: TriageStatus;
}

export interface TriagePromoteResponse extends TriageActionResponse {
  task: { taskId: string; promotedFromTriageId?: string };
  newStatus: "promoted";
  /** True when the route reused an existing back-ref task (idempotent retry). */
  recovered: boolean;
}

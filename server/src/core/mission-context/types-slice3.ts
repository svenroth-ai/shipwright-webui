/*
 * core/mission-context/types-slice3.ts — the NATIVE pipeline + campaign
 * artifacts (CONTRACT §10 Slice 3; campaign 2026-07-18-mission-artifacts, S3).
 *
 * S1 deliberately left scenarios 3 and 5 on "today's behavior" so it could be
 * additive. This module ends that fallback: a pipeline phase task and a campaign
 * each get descriptors resolved from their OWN source of record rather than
 * borrowing the iterate rail.
 *
 * Two shapes are load-bearing here:
 *
 *   - `phase` is resolved by an EXACT `phaseTaskId` match against run-config v2
 *     `phase_tasks[]`. Never by `phase` name, never by session: a run has many
 *     tasks for the same phase once splits exist, so matching on anything but
 *     the id would CONFLATE them and attribute one split's work to another.
 *
 *   - campaign artifacts are split into CAMPAIGN-LEVEL (`spec` = the brief,
 *     `campaign_runbook`, `campaign_progress`) and SUB-ITERATE-LEVEL
 *     (`sub_iterate`). Keeping them apart is a CONTRACT requirement, not a
 *     presentation choice — a reader must never mistake one sub-iterate's
 *     result for the campaign's.
 */

import type { ArtifactBase } from "./types.js";

/** A phase task's own facts. Display data only — never a launch input (DO-NOT #13). */
export interface PhaseDetail {
  type: "phase";
  /** The PIPELINE run id (`run-xxxxxxxx`) — never an iterate run_id. */
  runId: string;
  phase: string;
  splitId: string | null;
  status: string;
  slashCommand: string | null;
  title: string | null;
  description: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** How many times this phase task was executed; null when not recorded. */
  executionCount: number | null;
  errors: string[];
  /** Paths the phase RECORDED producing (`result.artifacts`). Strings, not links. */
  outputs: string[];
}

export interface PhaseArtifact extends ArtifactBase {
  kind: "phase";
  detail: PhaseDetail | null;
}

/** A Markdown document artifact that is NOT the `spec` slot (the campaign RUNBOOK). */
export interface CampaignRunbookArtifact extends ArtifactBase {
  kind: "campaign_runbook";
  detail: { type: "document"; documentId: string; title: string } | null;
}

export interface CampaignSubIterateRow {
  id: string;
  title: string;
  status: string;
  /** True for the ONE row the selection rule picked as active. */
  active: boolean;
}

export interface CampaignProgressDetail {
  type: "campaign_progress";
  slug: string;
  /** Producer-owned lifecycle (`draft`/`active`/`complete`); null when unwritten. */
  lifecycle: string | null;
  branchStrategy: string | null;
  done: number;
  total: number;
  rows: CampaignSubIterateRow[];
}

export interface CampaignProgressArtifact extends ArtifactBase {
  kind: "campaign_progress";
  detail: CampaignProgressDetail | null;
}

/**
 * How the active sub-iterate was chosen. Recorded on the wire so the answer is
 * INSPECTABLE — "which one is running" is a claim, and a claim with no stated
 * basis is the kind of thing that silently drifts.
 */
export type SubIterateSelection = "in_progress" | "first_incomplete" | "last_complete";

export interface SubIterateDetail {
  type: "sub_iterate";
  id: string;
  title: string;
  status: string;
  selectedBy: SubIterateSelection;
  /** Opaque id for this sub-iterate's OWN spec; null when it has no document. */
  documentId: string | null;
  documentTitle: string | null;
  commit: string | null;
  branch: string | null;
  /**
   * Recorded test counts. `null` means NOT RECORDED — never rendered as zero.
   * A campaign's `status.json` leaves these null for a sub-iterate that has not
   * reported yet, and "0 of 0 passed" would be a fabricated pass.
   */
  testsPassed: number | null;
  testsTotal: number | null;
}

export interface SubIterateArtifact extends ArtifactBase {
  kind: "sub_iterate";
  detail: SubIterateDetail | null;
}

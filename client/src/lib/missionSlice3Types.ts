/*
 * missionSlice3Types.ts — wire types for the native pipeline + campaign
 * artifacts (campaign 2026-07-18-mission-artifacts, S3).
 *
 * SoT: `server/src/core/mission-context/types-slice3.ts`. VERBATIM MIRROR per
 * ADR-080 / DO-NOT #7 — the two workspaces never import each other. Keep this
 * file and the server type module in sync by hand.
 *
 * Its own file rather than more lines in `missionContextApi.ts`, which is the
 * same reason that module exists at all: `externalApi.ts` sits at the bloat
 * ceiling, and the server mirrors this exact split (`types-slice2.ts`,
 * `types-slice3.ts`).
 */

/** Shared base — mirrors the server `ArtifactBase`. */
interface Slice3ArtifactBase {
  label: string;
  state: "available" | "not_applicable" | "not_yet_created" | "unavailable" | "error";
  summary: string | null;
  receipt: string | null;
  note?: string;
}

// ---------------------------------------------------------------------------
// Pipeline (scenario 3)
// ---------------------------------------------------------------------------

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
  executionCount: number | null;
  errors: string[];
  /** Recorded output paths. TEXT only — deliberately never rendered as links. */
  outputs: string[];
}

export interface PhaseArtifact extends Slice3ArtifactBase {
  kind: "phase";
  detail: PhaseDetail | null;
}

// ---------------------------------------------------------------------------
// Campaign (scenario 5)
// ---------------------------------------------------------------------------

export interface CampaignRunbookArtifact extends Slice3ArtifactBase {
  kind: "campaign_runbook";
  detail: { type: "document"; documentId: string; title: string } | null;
}

export interface CampaignSubIterateRow {
  id: string;
  title: string;
  status: string;
  active: boolean;
}

export interface CampaignProgressDetail {
  type: "campaign_progress";
  slug: string;
  lifecycle: string | null;
  branchStrategy: string | null;
  done: number;
  total: number;
  rows: CampaignSubIterateRow[];
}

export interface CampaignProgressArtifact extends Slice3ArtifactBase {
  kind: "campaign_progress";
  detail: CampaignProgressDetail | null;
}

/** How the active unit was chosen — shown so the claim has a visible basis. */
export type SubIterateSelection = "in_progress" | "first_incomplete" | "last_complete";

export interface SubIterateDetail {
  type: "sub_iterate";
  id: string;
  title: string;
  status: string;
  selectedBy: SubIterateSelection;
  documentId: string | null;
  documentTitle: string | null;
  commit: string | null;
  branch: string | null;
  /** null means NOT RECORDED. It must never render as 0 (see the S2 review). */
  testsPassed: number | null;
  testsTotal: number | null;
}

export interface SubIterateArtifact extends Slice3ArtifactBase {
  kind: "sub_iterate";
  detail: SubIterateDetail | null;
}

/*
 * missionContextApi.ts — wire types + fetch wrappers for the Mission-context
 * resolver (campaign 2026-07-18-mission-artifacts, Slice 1):
 *   GET /api/external/tasks/:taskId/mission-context
 *   GET /api/external/tasks/:taskId/mission-context/documents/:documentId
 *
 * Its OWN lib file — `externalApi.ts` is at the bloat ceiling, so no new
 * wrappers go there — but it reuses that module's `httpJson` + `EXTERNAL_API`
 * so endpoint strings live in one place.
 *
 * SoT for the wire shape: `server/src/core/mission-context/types.ts`. VERBATIM
 * MIRROR per ADR-080 / DO-NOT #7 — the two workspaces never import each other.
 * Keep this file and the server type module in sync by hand.
 *
 * The document id is OPAQUE and server-minted: the client MUST NOT construct a
 * `/file?path=` for a Mission artifact (CONTRACT §5.2). Passing the id back is
 * the only supported way to fetch a body.
 */

import { EXTERNAL_API, httpJson } from "./externalApi";
import type {
  CampaignProgressArtifact,
  CampaignRunbookArtifact,
  PhaseArtifact,
  SubIterateArtifact,
} from "./missionSlice3Types";

export type * from "./missionSlice3Types";

export const MISSION_CONTEXT_SCHEMA_VERSION = 1;

export type MissionScenario =
  | "custom_actions"
  | "iterate"
  | "pipeline"
  | "campaign"
  | "plain";

export type ArtifactState =
  | "available"
  | "not_applicable"
  | "not_yet_created"
  | "unavailable"
  | "error";

export type ArtifactKind =
  | "spec"
  | "requirement"
  | "tests"
  | "review"
  | "decisions"
  | "commit"
  // S3 — pipeline (scenario 3). `spec` doubles as the campaign BRIEF.
  | "phase"
  // S3 — campaign (scenario 5).
  | "campaign_runbook"
  | "campaign_progress"
  | "sub_iterate";

export type RequirementConfidence = "planned" | "finalized" | "unresolved";
export type MergeState = "merged" | "pending" | "unknown";

export interface FrRow {
  originalFrId: string;
  displayFrId: string;
  name: string | null;
  area: string | null;
  /** Set only when the Fold-Map actually moved the id — renders "mapped from …". */
  mappedFrom: string | null;
}

interface ArtifactBase {
  kind: ArtifactKind;
  label: string;
  state: ArtifactState;
  summary: string | null;
  receipt: string | null;
  note?: string;
}

export interface SpecArtifact extends ArtifactBase {
  kind: "spec";
  detail: { type: "document"; documentId: string; title: string } | null;
}

export interface RequirementArtifact extends ArtifactBase {
  kind: "requirement";
  detail: {
    type: "requirements";
    confidence: RequirementConfidence;
    rows: FrRow[];
    specImpact: string | null;
  } | null;
}

export interface CommitArtifact extends ArtifactBase {
  kind: "commit";
  detail: {
    type: "commit";
    commit: string | null;
    message: string | null;
    prNumber: number | null;
    prUrl: string | null;
    merge: MergeState;
  } | null;
}

// ---------------------------------------------------------------------------
// Slice 2 — Tests · Review · Decisions (SoT: `types-slice2.ts`)
// ---------------------------------------------------------------------------

export type TestChangeKind = "added" | "modified" | "removed";

/** `mappedFrom` set only when a fold moved the id — renders "mapped from …". */
export interface TestFrRef {
  frId: string;
  mappedFrom: string | null;
}

export interface TestRow {
  path: string;
  kind: TestChangeKind;
  layer: string | null;
  frs: TestFrRef[];
  caseCount: number | null;
}

export interface TestsArtifact extends ArtifactBase {
  kind: "tests";
  detail: {
    type: "tests";
    rows: TestRow[];
    counts: { added: number; modified: number; removed: number };
    byLayer: { layer: string; count: number }[];
    truncated: boolean;
    /** `unavailable` → the FR links are MISSING, not empty. */
    manifestStatus: "ok" | "unavailable";
  } | null;
}

export type ReviewType = "self" | "plan" | "code" | "doubt" | "external_code";

/**
 * `not_run`        — a record says the pass did not run.
 * `not_applicable` — it did not APPLY at this size or change shape.
 * `unavailable`    — no readable record either way. NOT the same as "clean".
 */
export type ReviewStatus = "completed" | "not_run" | "not_applicable" | "unavailable";

/**
 * `unstructured` means the review RAN and its prose could not be itemized, so
 * the count is 0 for a review that may have found plenty — never render that
 * as a clean pass.
 */
export type ReviewParseStatus = "structured" | "partial" | "unstructured";

/** Where a row came from — the honesty copy differs per source. */
export type ReviewSource = "record" | "marker";

export interface ReviewFinding {
  severity: string | null;
  title: string;
  /** `path/to/file.ts:42`, pre-joined by the server; null when not located. */
  location: string | null;
  suggestion: string | null;
}

export interface ReviewRow {
  reviewType: ReviewType;
  status: ReviewStatus;
  findingsCount: number | null;
  /** Populated from the per-run record; ALWAYS empty on the `marker` path. */
  findings: ReviewFinding[];
  provider: string | null;
  completedAt: string | null;
  disposition: string | null;
  note: string | null;
  parseStatus: ReviewParseStatus | null;
  source: ReviewSource;
  /** The finding list was capped — never imply completeness. */
  truncated: boolean;
}

export interface ReviewArtifact extends ArtifactBase {
  kind: "review";
  detail: { type: "reviews"; rows: ReviewRow[] } | null;
}

/**
 * `decision_log` — aggregated at release time, so it HAS an ADR number.
 * `drop`         — recorded at the iterate's F3 and not yet published in a
 *                  release, so it has no number. Real, just not numbered.
 */
export type DecisionSource = "decision_log" | "drop";

export interface DecisionEntryView {
  /** null while the decision lives only as a drop. Never fabricated. */
  adrId: string | null;
  title: string;
  /** The ADR block's own Markdown — the SECTION, never the whole log. */
  markdown: string;
  source: DecisionSource;
}

export interface DecisionsArtifact extends ArtifactBase {
  kind: "decisions";
  detail: {
    type: "decisions";
    entries: DecisionEntryView[];
    truncated: boolean;
    /** Drop files that matched this run but could not be read. */
    malformedCount: number;
  } | null;
}

export type ArtifactDescriptor =
  | SpecArtifact
  | RequirementArtifact
  | TestsArtifact
  | ReviewArtifact
  | DecisionsArtifact
  | CommitArtifact
  | PhaseArtifact
  | CampaignRunbookArtifact
  | CampaignProgressArtifact
  | SubIterateArtifact;

export interface MissionTests {
  passed: number | null;
  total: number | null;
}

export interface MissionContext {
  schemaVersion: number;
  scenario: MissionScenario;
  missionTabVisible: boolean;
  runId: string | null;
  /**
   * Is this run IN FLIGHT right now? Server-side: a validated pointer whose
   * worktree git still registers AND no `work_completed` recorded for the run —
   * a completion record is terminal, so it ends live-ness even while the
   * worktree survives. It decides ONE thing here: whether an artifact that has
   * not been written yet is hidden ("this run has no such artifact") or shown as
   * pending ("not written yet"). An `unavailable` artifact NEVER becomes
   * pending. See `missionArtifacts.ts`.
   */
  runLive: boolean;
  artifacts: ArtifactDescriptor[];
  tests: MissionTests | null;
  servesFrId: string | null;
  sourceRev: string;
}

export interface MissionContextResponse {
  status: "ok";
  context: MissionContext;
}

/** A document that changed or vanished since the context response (§5.2). */
export type ArtifactDocumentResponse =
  | { status: "ok"; document: { title: string; body: string } }
  | { status: "stale" | "unavailable"; reason?: string };

export async function fetchMissionContext(taskId: string): Promise<MissionContext> {
  const r = await httpJson<MissionContextResponse>(
    `${EXTERNAL_API}/tasks/${encodeURIComponent(taskId)}/mission-context`,
  );
  return r.context;
}

export async function fetchArtifactDocument(
  taskId: string,
  documentId: string,
): Promise<ArtifactDocumentResponse> {
  return httpJson<ArtifactDocumentResponse>(
    `${EXTERNAL_API}/tasks/${encodeURIComponent(taskId)}/mission-context/documents/${encodeURIComponent(documentId)}`,
  );
}

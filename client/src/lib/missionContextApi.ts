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

export type ArtifactKind = "spec" | "requirement" | "commit";

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

export type ArtifactDescriptor = SpecArtifact | RequirementArtifact | CommitArtifact;

export interface MissionTests {
  passed: number | null;
  total: number | null;
}

export interface MissionContext {
  schemaVersion: number;
  scenario: MissionScenario;
  missionTabVisible: boolean;
  runId: string | null;
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

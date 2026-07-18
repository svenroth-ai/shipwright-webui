/*
 * core/mission-context/types.ts — the versioned MissionContext contract
 * (campaign 2026-07-18-mission-artifacts, Slice 1; CONTRACT §5 / §6).
 *
 * The response is VERSIONED (`schemaVersion`) so a client built against an
 * older shape can refuse rather than misread (external-review GPT #15).
 *
 * Two shapes are load-bearing and deliberately NOT collapsed:
 *   - `ArtifactState` is FIVE states, not a boolean. "hide-empty" hides only
 *     `not_applicable` + `not_yet_created`; an expected-but-unresolvable
 *     artifact renders a compact "currently unavailable" so a data-integrity
 *     problem never masquerades as "nothing exists" (CONTRACT §6).
 *   - `ArtifactDescriptor` is a DISCRIMINATED union on `kind`. Not everything
 *     is a Markdown file — the right panel renders a document, a requirement
 *     table or commit metadata from the type, never from a guess (§7).
 */

/** Bump when a field is removed or re-typed; additive fields do not bump. */
export const MISSION_CONTEXT_SCHEMA_VERSION = 1 as const;

/**
 * The §4 ordered scenario table, first-match-wins. `custom_actions` is the
 * only scenario that HIDES the Mission tab; `plain` covers scenarios 1 + 4
 * (plain / pure) and carries live narration but no artifact rail.
 */
export type MissionScenario =
  | "custom_actions"
  | "iterate"
  | "pipeline"
  | "campaign"
  | "plain";

/** CONTRACT §6 artifact state model. Hide-empty hides ONLY the two "absent" states. */
export type ArtifactState =
  | "available"
  | "not_applicable"
  | "not_yet_created"
  | "unavailable"
  | "error";

/** Slice 1 ships three of the six artifacts; Tests/Review/Decisions land in Slice 2. */
export type ArtifactKind = "spec" | "requirement" | "commit";

interface ArtifactBase {
  kind: ArtifactKind;
  /** Rail label — plain language, never a filename. */
  label: string;
  state: ArtifactState;
  /** The non-expert business summary (TOP region of the right panel). */
  summary: string | null;
  /** Short rail receipt; null renders NO receipt line (honest empty). */
  receipt: string | null;
  /**
   * Why the state is not `available`. Display-safe prose — NEVER a raw
   * filesystem path (that would leak the read-root layout to the client).
   */
  note?: string;
}

/** A Markdown document rendered by the client's SmartViewer `DocumentMarkdown`. */
export interface SpecArtifact extends ArtifactBase {
  kind: "spec";
  detail: {
    type: "document";
    /**
     * OPAQUE id for the artifact-detail endpoint. The client NEVER builds a
     * `/file?path=` itself — that would duplicate the path rules and let the
     * descriptor and the file read drift (CONTRACT §5.2, Review-2 GPT #9).
     */
    documentId: string;
    /** Display title (basename), safe to show — not a path. */
    title: string;
  } | null;
}

/**
 * One requirement row. BOTH ids are kept: `originalFrId` is what the run
 * actually recorded (finer provenance, deliberately preserved), `displayFrId`
 * is its surviving parent after Fold-Map resolution (CONTRACT §3.1 / §6).
 */
export interface FrRow {
  originalFrId: string;
  displayFrId: string;
  /** Capability name from the spec table; null when the id resolves to neither. */
  name: string | null;
  /** Area code (TSK, TRM, …); null when unknown. */
  area: string | null;
  /** `mapped from FR-01.44` — set ONLY when the fold actually moved the id. */
  mappedFrom: string | null;
}

/**
 * `planned` — mid-run, derived from the spec's intent. NEVER labelled
 * new/changed/technical before Finalize (CONTRACT §6 mid-run column).
 * `finalized` — post-Finalize, from the run record.
 * `unresolved` — a source existed but yielded no usable FR ids.
 */
export type RequirementConfidence = "planned" | "finalized" | "unresolved";

export interface RequirementArtifact extends ArtifactBase {
  kind: "requirement";
  detail: {
    type: "requirements";
    confidence: RequirementConfidence;
    rows: FrRow[];
    /** `none` / `modify` / `add` … as recorded; null when not yet known. */
    specImpact: string | null;
  } | null;
}

/**
 * Merge state. `merged` is a REAL observation (a squash commit carrying
 * `(#NNN)` on origin/main); `pending` means "not found yet" and re-checks on a
 * TTL; `unknown` means we could not check at all (no PR marker, no git).
 * A `pr-link` alone NEVER renders "merged" (CONTRACT §5.3).
 */
export type MergeState = "merged" | "pending" | "unknown";

export interface CommitArtifact extends ArtifactBase {
  kind: "commit";
  detail: {
    type: "commit";
    commit: string | null;
    /** The run's plain-language summary line. */
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

/**
 * The resolver response. `missionTabVisible: false` occurs ONLY for a validated
 * custom-actions project (§4 precedence 1) — a malformed or dual-mode actions
 * file falls back to VISIBLE, because hiding a useful tab on an ambiguous file
 * is the worse failure (Review-2 GPT #12).
 */
export interface MissionContext {
  schemaVersion: typeof MISSION_CONTEXT_SCHEMA_VERSION;
  scenario: MissionScenario;
  missionTabVisible: boolean;
  /** The ITERATE run id (`iterate-<date>-<slug>`) — never `task.runId`. */
  runId: string | null;
  artifacts: ArtifactDescriptor[];
  /** Feeds the top-right Tests chip. Null when truly absent — never fabricated. */
  tests: MissionTests | null;
  /** Feeds the Serves chip: the FIRST fold-resolved `displayFrId`, or null. */
  servesFrId: string | null;
  /**
   * Opaque revision fingerprint of the sources this response was built from.
   * The detail endpoint re-checks it so a document that changed since the
   * context response returns `stale` rather than an unrelated body (§5.2).
   */
  sourceRev: string;
}

/**
 * The typed durable association persisted onto the task (CONTRACT §5).
 *
 * REQUIRED, not optional: the pointer is pruned once the worktree is gone, so
 * a session observed only after pruning could never be resolved again. Written
 * ONCE, on the first valid LIVE resolve, as an idempotent compare-and-set under
 * `proper-lockfile` — never a per-GET side-effect and NOT a cache.
 *
 * Deliberately NOT `task.runId`: that field means a pipeline run (`run-xxxxxxxx`)
 * and overloading it would corrupt the pipeline join (external-review GPT #4).
 */
export interface MissionContextAssociation {
  kind: "iterate";
  runId: string;
  observedAt: string;
  source: "iterate_active_pointer";
}

/** Type-guard used by the store loader to soft-drop a malformed persisted value. */
export function isMissionContextAssociation(v: unknown): v is MissionContextAssociation {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    o.kind === "iterate" &&
    typeof o.runId === "string" &&
    o.runId.length > 0 &&
    typeof o.observedAt === "string" &&
    o.observedAt.length > 0 &&
    o.source === "iterate_active_pointer"
  );
}

/*
 * core/mission-context/artifacts.ts — build the Spec · Requirement · Commit
 * descriptors for a resolved iterate (CONTRACT §6, Slice-1 subset).
 *
 * Register: Mission is FOR NON-EXPERTS. Every `summary` here is written to be
 * read by someone who does not know the codebase — it says what the thing MEANS,
 * not which file it came from. The raw document is secondary (right panel,
 * below the summary).
 *
 * The 5-state model is applied per artifact, and the distinction that matters:
 *   - `not_yet_created` — expected later in the lifecycle (mid-run commit).
 *   - `unavailable`     — expected NOW but unresolvable (unreadable log, bad
 *                         pointer). Renders a compact "currently unavailable".
 * Collapsing those two would let a data-integrity fault read as "nothing
 * happened yet", which is the exact lie the state model exists to prevent.
 *
 * Mid-run the Requirement artifact is `planned` impact ONLY — never labelled
 * new/changed/technical before Finalize, because until then the run has not
 * decided (§6 mid-run column).
 */

import type {
  FrRow,
  RequirementArtifact,
  RequirementConfidence,
  SpecArtifact,
} from "./types.js";
import type { FoldMap } from "./fold-map.js";
import { resolveFrList } from "./fold-map.js";
import { declaredSpecImpact, plannedImpactFromSpec } from "./planned-impact.js";
import type { IterateDoc, EventLookup } from "./iterate-record.js";
import type { RunProjection } from "../event-log-reader.js";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

export interface SpecInput {
  /** Minted opaque id — null when the document did not resolve. */
  documentId: string | null;
  /** Basename for display (never a path). */
  title: string | null;
  /** True when the resolve was denied by a guard rather than simply missing. */
  denied: boolean;
  /** Mid-run reads come from the worktree; post-Finalize from the main root. */
  fromWorktree: boolean;
  /** The run's own one-line intent, when the event log recorded one. */
  intent: string | null;
}

export function buildSpecArtifact(input: SpecInput): SpecArtifact {
  if (input.documentId && input.title) {
    return {
      kind: "spec",
      label: "Spec",
      state: "available",
      summary:
        input.intent ??
        (input.fromWorktree
          ? "The plan this session is working to, as it stands right now."
          : "The plan this change was built to."),
      receipt: input.title,
      detail: { type: "document", documentId: input.documentId, title: input.title },
    };
  }

  // Denied ≠ missing. A guard rejection is an integrity signal and must show.
  if (input.denied) {
    return {
      kind: "spec",
      label: "Spec",
      state: "unavailable",
      summary: null,
      receipt: null,
      note: "The plan document could not be read safely.",
      detail: null,
    };
  }

  return {
    kind: "spec",
    label: "Spec",
    state: "not_yet_created",
    summary: null,
    receipt: null,
    detail: null,
  };
}

// ---------------------------------------------------------------------------
// Requirement
// ---------------------------------------------------------------------------

function requirementSummary(rows: FrRow[], confidence: RequirementConfidence): string | null {
  if (rows.length === 0) return null;
  const names = rows.map((r) => r.name ?? r.displayFrId);
  const lead = names.length <= 2 ? names.join(" and ") : `${names[0]} and ${names.length - 1} more`;
  return confidence === "planned"
    ? `Expected to affect ${lead}.`
    : `Changed ${lead} (${plural(rows.length, "requirement", "requirements")}).`;
}

export interface RequirementInput {
  foldMap: FoldMap;
  /** Post-Finalize record, when present. */
  doc: IterateDoc | null;
  /** The `work_completed` lookup — its status drives available vs unavailable. */
  events: EventLookup;
  /** Spec body, used ONLY for mid-run planned impact (AC1). */
  specText?: string | null;
  /** True only while the resolver still observes this iterate as live. */
  runLive?: boolean;
  sourceDocument?: { documentId: string; title: string } | null;
}

export function buildRequirementArtifact(input: RequirementInput): RequirementArtifact {
  const { foldMap, events } = input;
  // Direct builder consumers predate this signal; preserve their historical
  // live-spec semantics while resolver callers always provide the fact.
  const runLive = input.runLive ?? true;

  // Prefer the per-run agent-doc when it actually carries FRs (rare but
  // cleaner); otherwise fall back to work_completed (the common real path).
  const eventRun: RunProjection | null = events.status === "found" ? events.run : null;
  // `work_completed` is the only terminal source. The retained per-run summary
  // is a bounded cache, so it may enrich old rows but must never make a live
  // plan look recorded or override a completed event.
  const rawAffected = eventRun?.affectedFrs ?? [];
  const rawNew = eventRun?.newFrs ?? [];
  const eventImpact = eventRun?.specImpact?.trim().toLowerCase() ?? null;
  const plannedImpact = declaredSpecImpact(input.specText);
  const specImpact = eventRun ? eventImpact : plannedImpact;

  // A read failure is neither a live plan nor a completed record. Do this
  // before consulting the iterate spec so a historical Mission cannot be
  // described as merely planned when its terminal evidence is unreadable.
  if (events.status === "unavailable") {
    return {
      kind: "requirement",
      label: "Requirement",
      state: "unavailable",
      summary: null,
      receipt: null,
      note: "The run record could not be read.",
      detail: null,
    };
  }

  // Finalized the moment a durable record exists for this run; otherwise the
  // run is still deciding, so anything we show is PLANNED.
  const finalized = Boolean(eventRun);

  // Mid-run there is no record — fall back to what the spec PLANS to touch, so
  // a live iterate still shows a real Requirement (AC1) instead of a blank.
  // The scan is SCOPED to the spec's affected-boundaries section; a
  // document-wide scrape reported References and citations as impact.
  const recorded = [...rawAffected, ...rawNew];
  const usingPlanned = !finalized && runLive && recorded.length === 0 && specImpact !== "none";
  const planned = usingPlanned
    ? plannedImpactFromSpec(input.specText)
    : { frIds: [], prose: null };
  const rows = resolveFrList(foldMap, usingPlanned ? planned.frIds : recorded);

  const confidence: RequirementConfidence =
    rows.length === 0 ? "unresolved" : usingPlanned ? "planned" : "finalized";
  const lifecycle = finalized ? (specImpact === "none" ? "none" : "recorded") : !runLive ? "discovering" :
    specImpact === "none" ? "none" : usingPlanned && (rows.length > 0 || planned.prose) ? "planned" : "discovering";

  // Without a live worktree or terminal record, Mission knows the identity but
  // cannot claim a plan or completion. Preserve that ambiguity explicitly.
  if (!finalized && !runLive) {
    return {
      kind: "requirement",
      label: "Requirement",
      state: "available",
      summary: "Discovering affected requirements.",
      receipt: "discovering",
      detail: { type: "requirements", confidence: "unresolved", lifecycle: "discovering", rows: [], specImpact: null, sourceDocument: input.sourceDocument ?? null },
    };
  }

  // Explicit NONE is authoritative. Stale ids in a producer payload must not
  // turn a declared no-requirement change into a contradictory requirement row.
  if (specImpact === "none") {
    return {
      kind: "requirement",
      label: "Requirement",
      state: "available",
      summary: "No requirement changed.",
      receipt: "no requirement change",
      detail: { type: "requirements", confidence: finalized ? "finalized" : "unresolved", lifecycle: "none", rows: [], specImpact, sourceDocument: input.sourceDocument ?? null },
    };
  }

  if (rows.length > 0) {
    return {
      kind: "requirement",
      label: "Requirement",
      state: "available",
      summary: requirementSummary(rows, confidence),
      receipt: rows.map((r) => r.displayFrId).join(", "),
      detail: { type: "requirements", confidence, lifecycle, rows, specImpact, sourceDocument: input.sourceDocument ?? null },
    };
  }

  // Mid-run with no resolvable FR id: carry the spec's own PLANNED-IMPACT prose
  // rather than falling into a hidden state. AC1 requires a live iterate to
  // show a non-empty Requirement, and an id-only model failed it SILENTLY for
  // every spec that describes its impact in words (internal review, MEDIUM).
  if (usingPlanned && planned.prose) {
    return {
      kind: "requirement",
      label: "Requirement",
      state: "available",
      summary: `Planned impact — ${planned.prose}`,
      receipt: "planned impact",
      detail: { type: "requirements", confidence: "planned", lifecycle: "planned", rows: [], specImpact, sourceDocument: input.sourceDocument ?? null },
    };
  }

  if (!finalized) {
    return {
      kind: "requirement",
      label: "Requirement",
      state: "available",
      summary: "Discovering affected requirements.",
      receipt: "discovering",
      detail: { type: "requirements", confidence: "unresolved", lifecycle: "discovering", rows: [], specImpact: null, sourceDocument: input.sourceDocument ?? null },
    };
  }

  return {
    kind: "requirement",
    label: "Requirement",
    state: "available",
    summary: "Recorded requirement impact, but individual requirements could not be identified.",
    receipt: "recorded impact",
    detail: { type: "requirements", confidence: "unresolved", lifecycle: "recorded", rows: [], specImpact, sourceDocument: input.sourceDocument ?? null },
  };
}

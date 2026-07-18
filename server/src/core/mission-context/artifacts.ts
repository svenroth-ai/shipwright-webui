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
import { plannedImpactFromSpec } from "./planned-impact.js";
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
}

export function buildRequirementArtifact(input: RequirementInput): RequirementArtifact {
  const { foldMap, doc, events } = input;

  // Prefer the per-run agent-doc when it actually carries FRs (rare but
  // cleaner); otherwise fall back to work_completed (the common real path).
  const eventRun: RunProjection | null = events.status === "found" ? events.run : null;
  const docHasFrs = (doc?.affectedFrs.length ?? 0) > 0 || (doc?.newFrs.length ?? 0) > 0;

  const rawAffected = docHasFrs ? (doc?.affectedFrs ?? []) : (eventRun?.affectedFrs ?? []);
  const rawNew = docHasFrs ? (doc?.newFrs ?? []) : (eventRun?.newFrs ?? []);
  const specImpact = doc?.specImpact ?? eventRun?.specImpact ?? null;

  // Finalized the moment a durable record exists for this run; otherwise the
  // run is still deciding, so anything we show is PLANNED.
  const finalized = Boolean(eventRun) || docHasFrs || doc != null;

  // Mid-run there is no record — fall back to what the spec PLANS to touch, so
  // a live iterate still shows a real Requirement (AC1) instead of a blank.
  // The scan is SCOPED to the spec's affected-boundaries section; a
  // document-wide scrape reported References and citations as impact.
  const recorded = [...rawAffected, ...rawNew];
  const usingPlanned = !finalized && recorded.length === 0;
  const planned = usingPlanned
    ? plannedImpactFromSpec(input.specText)
    : { frIds: [], prose: null };
  const rows = resolveFrList(foldMap, usingPlanned ? planned.frIds : recorded);

  const confidence: RequirementConfidence =
    rows.length === 0 ? "unresolved" : usingPlanned ? "planned" : "finalized";

  if (rows.length > 0) {
    return {
      kind: "requirement",
      label: "Requirement",
      state: "available",
      summary: requirementSummary(rows, confidence),
      receipt: rows.map((r) => r.displayFrId).join(", "),
      detail: { type: "requirements", confidence, rows, specImpact },
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
      detail: { type: "requirements", confidence: "planned", rows: [], specImpact },
    };
  }

  // No FR ids anywhere. If the log could not be read we do NOT know; say so.
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

  // A finalized run that genuinely touched no requirement (spec_impact:none)
  // is a real, honest answer — not an absence.
  if (finalized && specImpact) {
    return {
      kind: "requirement",
      label: "Requirement",
      state: "available",
      summary:
        specImpact === "none"
          ? "No requirement changed — this was a fix or an internal change."
          : `Requirement impact recorded as “${specImpact}”.`,
      receipt: specImpact === "none" ? "no requirement change" : specImpact,
      detail: { type: "requirements", confidence: "finalized", rows: [], specImpact },
    };
  }

  return {
    kind: "requirement",
    label: "Requirement",
    state: "not_yet_created",
    summary: null,
    receipt: null,
    detail: null,
  };
}

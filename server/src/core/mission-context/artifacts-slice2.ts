/*
 * core/mission-context/artifacts-slice2.ts — the Tests · Review · Decisions
 * descriptors (CONTRACT §6 rows 3–5, campaign 2026-07-18-mission-artifacts).
 *
 * Same register as artifacts.ts: Mission is FOR NON-EXPERTS, so every `summary`
 * says what the thing MEANS ("this change added three tests and removed one"),
 * never which file it came from.
 *
 * The state discipline is the load-bearing part, and it is the same distinction
 * S1 established — sharpened by its review:
 *
 *   not_applicable  the subject genuinely does not exist (the commit touched no
 *                   test file at all). Hidden, and that is honest.
 *   not_yet_created expected LATER (the run has not finished).  Hidden.
 *   unavailable     expected NOW and unresolvable (git could not answer, the
 *                   log could not be read, no commit was ever recorded).
 *                   SHOWN, compactly, as "currently unavailable".
 *
 * The failure mode this file exists to prevent is reporting "no tests changed"
 * when the truth is "we could not find out". Those two must never collapse.
 */

import type { EventLookup } from "./iterate-record.js";
import type { TestsDiff } from "./tests-diff.js";
import { inferLayer } from "./tests-diff.js";
import type { TraceabilityIndex } from "./traceability.js";
import type { ReviewLookup } from "./review-state.js";
import type { DecisionsLookup } from "./decisions.js";
import type {
  DecisionsArtifact,
  ReviewArtifact,
  ReviewRow,
  TestRow,
  TestsArtifact,
} from "./types-slice2.js";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Layer codes are jargon; the rail is not the place for it. */
function layerWord(layer: string): string {
  if (layer === "e2e") return "end-to-end";
  if (layer === "unit") return "unit";
  if (layer === "integration") return "integration";
  return layer;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export interface TestsInput {
  events: EventLookup;
  diff: TestsDiff;
  index: TraceabilityIndex;
}

function hiddenTests(state: "not_yet_created" | "not_applicable", note?: string): TestsArtifact {
  return { kind: "tests", label: "Tests", state, summary: null, receipt: null, ...(note ? { note } : {}), detail: null };
}

function unavailableTests(note: string): TestsArtifact {
  return { kind: "tests", label: "Tests", state: "unavailable", summary: null, receipt: null, note, detail: null };
}

export function buildTestsArtifact(input: TestsInput): TestsArtifact {
  const { events, diff, index } = input;

  // The event log itself is unreadable — we know nothing, and say so.
  if (events.status === "unavailable") {
    return unavailableTests("The run record could not be read.");
  }
  // The run has not finished: there is no commit to diff yet. Genuinely later.
  if (events.status !== "found") return hiddenTests("not_yet_created");

  if (diff.status === "unavailable") {
    return unavailableTests(
      diff.reason === "bad_commit"
        ? "This run did not record a commit, so the tests it changed could not be identified."
        : "This run's test changes could not be read from the repository.",
    );
  }

  if (diff.files.length === 0) {
    // A REAL answer, not a failure: git answered and no test file moved.
    return hiddenTests("not_applicable", "This change touched no test files.");
  }

  const byFile = index.status === "ok" ? index.byFile : null;
  const rows: TestRow[] = diff.files.map((f) => {
    const entry = byFile?.get(f.path);
    return {
      path: f.path,
      kind: f.kind,
      // A removed file is never in the manifest — that is what removal means —
      // so its layer always comes from the path. Inferring is honest here;
      // claiming the manifest knew it would not be.
      layer: entry?.layers[0] ?? inferLayer(f.path),
      frs: entry?.frs ?? [],
      caseCount: entry?.caseCount ?? null,
    };
  });

  const counts = { added: 0, modified: 0, removed: 0 };
  for (const r of rows) counts[r.kind]++;

  const layerCounts = new Map<string, number>();
  for (const r of rows) {
    if (!r.layer) continue;
    layerCounts.set(r.layer, (layerCounts.get(r.layer) ?? 0) + 1);
  }
  const byLayer = [...layerCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([layer, count]) => ({ layer, count }));

  const parts: string[] = [];
  if (counts.added) parts.push(`added ${plural(counts.added, "test file", "test files")}`);
  if (counts.modified) parts.push(`changed ${plural(counts.modified, "test file", "test files")}`);
  if (counts.removed) parts.push(`removed ${plural(counts.removed, "test file", "test files")}`);
  const layerPart = byLayer.length
    ? ` (${byLayer.map((l) => `${l.count} ${layerWord(l.layer)}`).join(", ")})`
    : "";

  return {
    kind: "tests",
    label: "Tests",
    state: "available",
    summary: `This change ${parts.join(", ")}${layerPart}.`,
    receipt: plural(rows.length, "test file", "test files"),
    detail: {
      type: "tests",
      rows,
      counts,
      byLayer,
      truncated: diff.truncated,
      // A PARTIAL index counts as unavailable links: a file whose manifest
      // entry fell past the cap would otherwise render "covers nothing" while
      // the UI claimed the manifest was fine (external code review, MEDIUM).
      manifestStatus: index.status === "ok" && !index.truncated ? "ok" : "unavailable",
    },
  };
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

const REVIEW_WORD: Record<ReviewRow["reviewType"], string> = {
  plan: "the plan review",
  code: "the code review",
  doubt: "the doubt review",
  external_code: "the external code review",
};

export function buildReviewArtifact(lookup: ReviewLookup): ReviewArtifact {
  // No record at all AND nothing that failed to read: this run simply has no
  // review history to show. Hidden — an absence, not a fault.
  if (!lookup.hasRecord && !lookup.sawUnreadable) {
    return {
      kind: "review",
      label: "Review",
      state: "not_yet_created",
      summary: null,
      receipt: null,
      detail: null,
    };
  }

  // Something existed and could not be read — an integrity signal, shown.
  if (!lookup.hasRecord) {
    return {
      kind: "review",
      label: "Review",
      state: "unavailable",
      summary: null,
      receipt: null,
      note: "This run's review records could not be read.",
      detail: null,
    };
  }

  const completed = lookup.rows.filter((r) => r.status === "completed");
  const findings = completed.reduce((n, r) => n + (r.findingsCount ?? 0), 0);
  const unknown = lookup.rows.filter((r) => r.status === "unavailable").length;

  // "0 reviews ran and raised no issues" would read as a clean sweep when in
  // fact NOTHING ran — the exact false assurance §9.1 forbids. A run with no
  // completed pass gets its own sentence.
  const lead = completed.length === 0
    ? "No review was recorded as having run."
    : findings
      ? `${plural(findings, "issue", "issues")} raised across ${plural(completed.length, "review", "reviews")}.`
      : `${plural(completed.length, "review", "reviews")} ran and raised no issues.`;
  // Never let the sentence stop at the good news while passes are unreadable.
  const tail = unknown
    ? ` ${plural(unknown, "further review is", "further reviews are")} not recorded, so ${unknown === 1 ? "its" : "their"} result is unknown.`
    : "";

  return {
    kind: "review",
    label: "Review",
    state: "available",
    summary: `${lead}${tail}`,
    receipt: findings ? plural(findings, "finding", "findings") : `${completed.length} reviewed`,
    detail: { type: "reviews", rows: lookup.rows },
  };
}

/** Plain-language name for a review type — used by the client too (mirrored). */
export function reviewWord(t: ReviewRow["reviewType"]): string {
  return REVIEW_WORD[t];
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export function buildDecisionsArtifact(
  lookup: DecisionsLookup,
  events: EventLookup,
): DecisionsArtifact {
  if (lookup.status === "unavailable") {
    return {
      kind: "decisions",
      label: "Decisions",
      state: "unavailable",
      summary: null,
      receipt: null,
      note: "The decision record could not be read.",
      detail: null,
    };
  }

  if (lookup.entries.length === 0) {
    // The log WAS read. Whether this is "not yet" or "never" depends only on
    // whether the run has finished — both hide, but the state stays truthful.
    return {
      kind: "decisions",
      label: "Decisions",
      state: events.status === "found" ? "not_applicable" : "not_yet_created",
      summary: null,
      receipt: null,
      detail: null,
    };
  }

  const titles = lookup.entries.map((e) => e.title || e.adrId);
  const lead =
    titles.length === 1
      ? titles[0]
      : `${titles[0]} and ${plural(titles.length - 1, "other decision", "other decisions")}`;

  return {
    kind: "decisions",
    label: "Decisions",
    state: "available",
    summary: `${lead}.`,
    receipt: lookup.entries.map((e) => e.adrId).join(", ").slice(0, 80),
    detail: { type: "decisions", entries: lookup.entries, truncated: lookup.truncated },
  };
}

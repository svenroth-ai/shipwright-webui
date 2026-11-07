/*
 * core/mission-context/artifacts-decisions.ts — the DECISIONS descriptor
 * (CONTRACT §6 row 5).
 *
 * Its own module rather than more lines in `artifacts-slice2.ts`: that file was
 * at 300 LOC and reading a SECOND source (decision-drops) grew this builder past
 * what it had room for. A cohesive file-level split, per the repo's bloat rule —
 * not a per-handler shred.
 *
 * The distinction this file exists to keep, and the reason it was worth
 * splitting rather than baselining a crossing:
 *
 *   available    at least one decision was read — from either source. A partial
 *                read still lands here and DISCLOSES what it lost.
 *   unavailable  nothing was read AND something failed. SHOWN.
 *   hidden       nothing was read and BOTH sources answered cleanly. A real
 *                absence, and the only case that may disappear.
 *
 * "We could not read the drops directory" and "this run decided nothing" are
 * different facts. Collapsing them is the defect family this whole iterate is
 * about.
 */

import type { DecisionRecord } from "./decisions.js";
import type { RunDocUpdates } from "./doc-updates.js";
import type { EventLookup } from "./iterate-record.js";
import type { DecisionsArtifact } from "./types-slice2.js";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * True when `malformedCount` already accounts for everything that was lost, so
 * the uncountable clause would be redundant rather than additive.
 */
function hasOnlyCountedLoss(record: DecisionRecord): boolean {
  return record.malformedCount > 0 && !record.logOrScanLoss;
}

const NO_DOC_UPDATES: RunDocUpdates = { entries: [], conflicts: 0, malformed: 0, sawUnreadable: false };

/**
 * `docs` (events-drop-files S5b) is the run's documentation updates, folded +
 * pending. It never adds an ADR entry; it is carried in the detail, and a run
 * with doc updates but no ADR is still `available` (the updates ARE its record).
 */
export function buildDecisionsArtifact(
  record: DecisionRecord,
  events: EventLookup,
  docs: RunDocUpdates = NO_DOC_UPDATES,
): DecisionsArtifact {
  if (record.entries.length === 0 && (docs.entries.length > 0 || docs.conflicts > 0)) return docUpdatesOnly(record, docs);
  if (record.entries.length === 0) {
    if (record.sawUnreadable || docUpdatesIncomplete(docs)) {
      // Something existed and could not be read. This must NEVER fall through
      // to the hidden branch below — a hidden artifact reads as "this run
      // decided nothing", which is precisely what we do not know.
      return {
        kind: "decisions",
        label: "Decisions",
        state: "unavailable",
        summary: null,
        receipt: null,
        note: record.sawUnreadable
          ? "This run's decision records could not be read."
          : "This run's documentation updates could not be read.",
        detail: null,
      };
    }
    // Both sources WERE read and neither holds anything for this run. Whether
    // that is "not yet" or "never" depends only on whether the run has
    // finished — both hide, but the state stays truthful.
    return {
      kind: "decisions",
      label: "Decisions",
      state: events.status === "found" ? "not_applicable" : "not_yet_created",
      summary: null,
      receipt: null,
      detail: null,
    };
  }

  const titles = record.entries.map((e) => e.title || e.adrId || "A decision");
  const lead =
    titles.length === 1
      ? titles[0]
      : `${titles[0]} and ${plural(titles.length - 1, "other decision", "other decisions")}`;

  // A decision that exists only as a drop is REAL and RECORDED — it simply has
  // no ADR number until a release publishes it. Say that in words a non-expert
  // can act on, and never imply something went wrong.
  const unnumbered = record.entries.filter((e) => e.source === "drop").length;
  const pending =
    unnumbered === 0
      ? ""
      : unnumbered === record.entries.length
        ? " Not yet published in a release."
        : ` ${plural(unnumbered, "decision is", "decisions are")} not yet published in a release.`;
  // Two different losses, and neither may be swallowed just because something
  // else rendered. `malformedCount` is a countable one; `sawUnreadable` also
  // covers an unreadable decision LOG and a scan cut short by a cap, which have
  // no count — those used to disappear entirely once a drop rendered
  // successfully (external code review, gemini #1).
  // Two DIFFERENT losses, and they are additive rather than alternative. A
  // ternary made them exclusive, so one malformed drop plus an entirely
  // unreadable log rendered only "1 further record could not be read." — a
  // countable claim quietly absorbing an unread log and dropping the
  // "may be incomplete" clause that was the one still true (cascade, cheap).
  const counted = record.malformedCount
    ? ` ${plural(record.malformedCount, "further record", "further records")} could not be read.`
    : "";
  // `sawUnreadable` also covers losses with NO count: an unreadable log, a scan
  // cut short. Emit that clause whenever such a loss exists beyond the counted
  // ones — never let a number stand in for "and also, something uncountable".
  const uncounted =
    record.sawUnreadable && !hasOnlyCountedLoss(record)
      ? " Some of this run's decision records could not be read, so this list may be incomplete."
      : "";
  // A doc-update loss is disclosed here too: a run WITH an ADR must not let an
  // unreadable architecture.md / bullets folder read as "no documentation updates".
  const docsLost = docUpdatesIncomplete(docs) ? " Its documentation updates could not all be read." : "";
  const lost = `${counted}${uncounted}${docsLost}`;

  // The receipt is the ADR numbers when there are any, else a plain count —
  // never an invented identifier for an unnumbered decision.
  const numbered = record.entries.map((e) => e.adrId).filter((id): id is string => !!id);
  const receipt = numbered.length
    ? numbered.join(", ").slice(0, 80)
    : plural(record.entries.length, "decision", "decisions");

  return {
    kind: "decisions",
    label: "Decisions",
    state: "available",
    summary: `${lead}.${pending}${lost}`,
    receipt,
    detail: {
      type: "decisions",
      entries: record.entries,
      truncated: record.truncated,
      malformedCount: record.malformedCount,
      docUpdates: docs.entries,
      docUpdateConflicts: docs.conflicts,
    },
  };
}

function docUpdatesIncomplete(docs: RunDocUpdates): boolean {
  return docs.sawUnreadable || docs.malformed > 0;
}

/** A run whose only record is documentation updates (no ADR, folded or pending). */
function docUpdatesOnly(record: DecisionRecord, docs: RunDocUpdates): DecisionsArtifact {
  const pending = docs.entries.filter((e) => e.state === "pending").length;
  const lead =
    docs.entries.length > 0
      ? plural(docs.entries.length, "documentation update", "documentation updates")
      : `${plural(docs.conflicts, "documentation update", "documentation updates")} held back for a person to decide`;
  const notYet =
    pending === 0
      ? ""
      : pending === docs.entries.length
        ? " Not yet published in a release."
        : ` ${pending} not yet published in a release.`;
  const lost =
    record.sawUnreadable || docUpdatesIncomplete(docs)
      ? " Some of this run's records could not be read, so this list may be incomplete."
      : "";
  return {
    kind: "decisions",
    label: "Decisions",
    state: "available",
    summary: `${lead}.${notYet}${lost}`,
    receipt: lead,
    detail: {
      type: "decisions",
      entries: [],
      truncated: record.truncated,
      malformedCount: record.malformedCount, // broken bullet files are not decision records (summary says so)
      docUpdates: docs.entries,
      docUpdateConflicts: docs.conflicts,
    },
  };
}

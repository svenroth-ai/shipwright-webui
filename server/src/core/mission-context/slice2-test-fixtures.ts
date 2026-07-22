/*
 * slice2-test-fixtures.ts — shared fixtures for the Slice-2 artifact suites.
 *
 * Test-only helper (sibling of `external/mission-context/test-harness.ts`).
 * Extracted when the combined suite crossed the 300-LOC rule; the Tests suite
 * and the Review/Decisions suite both need the same `EventLookup` shapes and
 * duplicating a 20-line projection in two files invites them to drift apart.
 */

import type { EventLookup } from "./iterate-record.js";
import type { TraceabilityIndex } from "./traceability.js";
import type { ReviewRow, TestFrRef } from "./types-slice2.js";

/** A completed run that recorded a commit — the post-Finalize happy path. */
export const FOUND: EventLookup = {
  status: "found",
  mtimeMs: 1,
  run: {
    runId: "iterate-x",
    eventId: null,
    ts: null,
    source: "iterate",
    intent: null,
    changeType: null,
    description: null,
    summary: "Did the thing",
    commit: "66e275ae",
    specImpact: null,
    affectedFrs: [],
    newFrs: [],
    tests: null,
    phaseTimings: null,
    campaign: null,
    subIterateId: null,
  },
};

/** The log is fine; this run is simply not in it yet (the normal mid-run state). */
export const ABSENT: EventLookup = { status: "absent", mtimeMs: 0 };

/** The log itself could not be read — an integrity fault, not an absence. */
export const UNREADABLE: EventLookup = { status: "unavailable" };

export const NO_INDEX: TraceabilityIndex = { status: "unavailable", reason: "missing" };

export function indexWith(
  entries: Record<string, { layers: string[]; frs: TestFrRef[] }>,
): TraceabilityIndex {
  return {
    status: "ok",
    generatedAt: null,
    truncated: false,
    byFile: new Map(Object.entries(entries).map(([k, v]) => [k, { ...v, caseCount: 1 }])),
  };
}

/** A review row defaulting to `unavailable` — override only what a case pins. */
export function reviewRow(
  over: Partial<ReviewRow> & Pick<ReviewRow, "reviewType">,
): ReviewRow {
  return {
    status: "unavailable",
    findingsCount: null,
    findings: [],
    provider: null,
    completedAt: null,
    disposition: null,
    note: null,
    parseStatus: null,
    source: "marker",
    truncated: false,
    ...over,
  };
}

/*
 * core/mission-context/artifacts-tests.ts — the Tests descriptor
 * (CONTRACT §6 row 3, campaign 2026-07-18-mission-artifacts).
 *
 * Split from artifacts-slice2.ts (which keeps Review) when the Tests builder
 * grew the counts-led path and the combined file crossed the size rule.
 *
 * The Tests artifact LEADS with the pass/total the run RECORDED
 * (`work_completed.tests`) — the signal every finished run emits, present even
 * when the worktree flow shipped `commit:""` and no per-file diff could be
 * built (measured 2026-07-23: 182 of 374 real rows carry counts; only 155 a
 * diff). The per-file changed-test list is ENRICHMENT: shown when a real commit
 * resolved, never a precondition for the card.
 *
 * The state discipline is the load-bearing part (unchanged from S1/S2):
 *
 *   not_applicable  the run recorded no counts AND its commit touched no test
 *                   file. Hidden, and that is honest.
 *   not_yet_created the run has not finished. Hidden.
 *   unavailable     expected NOW and unresolvable — no counts recorded AND the
 *                   diff could not be read. SHOWN, compactly.
 *
 * The failure mode this file exists to prevent is reporting "no tests" when the
 * truth is "we could not find out" — OR when the counts were sitting in the
 * event all along and only the file diff was missing.
 */

import type { RunTests } from "../event-log-reader.js";
import { deriveTestsGate } from "../tests-gate.js";
import type { EventLookup } from "./iterate-record.js";
import type { TestsDiff } from "./tests-diff.js";
import { inferLayer } from "./tests-diff.js";
import type { TraceabilityIndex } from "./traceability.js";
import type { TestEvidence } from "./test-evidence.js";
import type { MissionTests } from "./types.js";
import type { TestRow, TestsArtifact } from "./types-slice2.js";

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

export interface TestsInput {
  events: EventLookup;
  diff: TestsDiff;
  index: TraceabilityIndex;
  evidence?: TestEvidence;
}

function hiddenTests(state: "not_yet_created" | "not_applicable", note?: string): TestsArtifact {
  return { kind: "tests", label: "Tests", state, summary: null, receipt: null, ...(note ? { note } : {}), detail: null };
}

function unavailableTests(note: string): TestsArtifact {
  return { kind: "tests", label: "Tests", state: "unavailable", summary: null, receipt: null, note, detail: null };
}

/**
 * The pass/total the run RECORDED, or null when it recorded no meaningful
 * counts. `{passed:null,total:null}` AND `{passed:0,total:0}` are both treated
 * as absent: an empty tests object carries nothing citable, and a genuine
 * zero-of-zero must not render the success-sounding "All 0 tests passing" the
 * file header warns against (internal code review, LOW). `gate` is resolved
 * ONCE here via `tests-gate.ts` — callers must not re-derive pass/fail.
 *
 * The SOLE `RunTests` -> `MissionTests` constructor — `resolver.ts`'s own
 * `context.tests` also calls this (rather than rebuilding the shape inline)
 * so the two never diverge on the `{0,0}` edge case (code review, LOW-MEDIUM:
 * they previously did — the inline build in `resolver.ts` did not null it out).
 */
export function toMissionTests(t: RunTests | null | undefined, ts: string | null): MissionTests | null {
  if (!t) return null;
  if ((t.passed ?? 0) === 0 && (t.total ?? 0) === 0) return null;
  return { passed: t.passed, total: t.total, skipped: t.skipped, gate: deriveTestsGate(t, ts) };
}

/** Non-negative-integer guard, mirroring `tests-gate.ts`'s own `normalizedCount`
 *  — a MissionTests field is raw producer data, not yet validated, so an
 *  "all skipped" claim must re-check it rather than trust a truthy `skipped`
 *  (external code review, MEDIUM: `{passed:-1,total:5,skipped:1}` and
 *  `{passed:0,total:5,skipped:9}` both reach `gate:"unknown"` without every
 *  collected test having genuinely been skipped — the FIRST wording fix
 *  asserted "All 5 were skipped" for both, a claim the raw counts disprove). */
function isNonNegInt(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/** The producer gate remains authoritative, but malformed raw counts cannot look green. */
function hasValidCompleteCounts(r: MissionTests): boolean {
  if (!isNonNegInt(r.passed) || !isNonNegInt(r.total) || r.passed > r.total) return false;
  return r.skipped == null || (isNonNegInt(r.skipped) && r.skipped <= r.total);
}

/** True only when the raw counts PROVE every collected test was skipped —
 *  `passed` genuinely 0, `total` a positive integer, `skipped` exactly equal
 *  to it. Anything else reaching `gate:"unknown"` is a malformed/partial
 *  record, not a provable all-skipped run. */
function isGenuinelyAllSkipped(r: MissionTests): boolean {
  return (
    isNonNegInt(r.passed) && r.passed === 0 && isNonNegInt(r.total) && r.total > 0 &&
    isNonNegInt(r.skipped) && r.skipped === r.total
  );
}

/** A plain-language gate heading followed by the run's recorded counts. */
function resultsSentence(r: MissionTests): string {
  if (r.passed != null && r.total != null) {
    if (!hasValidCompleteCounts(r)) {
      return "No reliable result — the recorded test counts are incomplete or invalid.";
    }
    // `unknown` with BOTH fields present means nothing citable happened
    // despite having full data — never phrased as pass- or fail-shaped
    // "passing" text (doubt review, MEDIUM: an all-skipped post-reversal run
    // otherwise read as "0 of N passing" — indistinguishable from N real
    // failures — or, when `passed` happened to equal `total` too, as a full
    // green). A partial record (only ONE field present) is a DIFFERENT
    // "unknown" — handled by the total-only / passed-only fallbacks below,
    // unchanged.
    if (r.gate === "unknown") {
      return isGenuinelyAllSkipped(r)
        ? `Needs attention — all ${plural(r.total, "collected test", "collected tests")} were skipped, so none ran.`
        : "No reliable result — the recorded test counts are incomplete or invalid.";
    }
    // A skipped-carrying pass is disclosed, not rounded up to "All N passing"
    // — that overstates what ran (code review, MEDIUM).
    if (r.gate === "pass" && (r.skipped ?? 0) > 0) {
      return `Passed — ${r.passed} of ${plural(r.total, "test", "tests")} passing (${r.skipped} skipped).`;
    }
    return r.gate === "pass"
      ? `Passed — all ${plural(r.total, "test", "tests")} passing.`
      : `Failed — ${r.passed} of ${plural(r.total, "test", "tests")} passing.`;
  }
  return "No reliable result — the run recorded only part of its test counts.";
}

/** The compact rail receipt for a counts result. */
function resultsReceipt(r: MissionTests): string {
  if (!hasValidCompleteCounts(r)) return "no reliable result";
  if (r.gate === "unknown" && isGenuinelyAllSkipped(r)) {
    return `${r.skipped}/${r.total} skipped`;
  }
  if (r.passed != null && r.total != null) return `${r.passed}/${r.total} passing`;
  if (r.total != null) return `${plural(r.total, "test", "tests")}`;
  return `${r.passed} passing`;
}

interface FileSummary {
  rows: TestRow[];
  counts: { added: number; modified: number; removed: number };
  byLayer: { layer: string; count: number }[];
  /** "This change added 2 test files (2 unit)." — the enrichment clause, or null. */
  sentence: string | null;
}

/** Build the per-file rows + human clause from a resolved commit diff. */
function summarizeFiles(diff: Extract<TestsDiff, { status: "ok" }>, index: TraceabilityIndex): FileSummary {
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
    rows,
    counts,
    byLayer,
    sentence: parts.length ? `This change ${parts.join(", ")}${layerPart}.` : null,
  };
}

/**
 * The Tests artifact leads with recorded pass/total and enriches with the diff.
 * It hides only when BOTH are genuinely absent, and stays `unavailable` (not
 * hidden) when the counts are missing AND the diff could not be read.
 */
export function buildTestsArtifact(input: TestsInput): TestsArtifact {
  const { events, diff, index } = input;

  // The event log itself is unreadable — we know nothing, and say so.
  if (events.status === "unavailable") {
    return unavailableTests("The run record could not be read.");
  }
  // The run has not finished: nothing recorded yet. Genuinely later.
  if (events.status !== "found") return hiddenTests("not_yet_created");

  const results = toMissionTests(events.run.tests, events.run.ts);
  const files = diff.status === "ok" ? summarizeFiles(diff, index) : null;
  const hasFiles = files != null && files.rows.length > 0;

  // Nothing recorded AND no file diff — preserve the honest terminal states so a
  // read fault never masquerades as "no tests".
  if (!results && !hasFiles) {
    if (diff.status === "unavailable") {
      return unavailableTests(
        diff.reason === "bad_commit"
          ? "This run recorded no test counts and no commit, so its tests could not be identified."
          : "This run's test changes could not be read from the repository.",
      );
    }
    // git answered, no test file moved, and no counts were recorded.
    return hiddenTests("not_applicable", "This change touched no test files.");
  }

  const summary =
    [results ? resultsSentence(results) : null, files?.sentence ?? null]
      .filter((s): s is string => Boolean(s))
      .join(" ") || null;
  const receipt = results
    ? resultsReceipt(results)
    : plural(files!.rows.length, "test file", "test files");

  return {
    kind: "tests",
    label: "Tests",
    state: "available",
    summary,
    receipt,
    detail: {
      type: "tests",
      results,
      rows: files?.rows ?? [],
      counts: files?.counts ?? { added: 0, modified: 0, removed: 0 },
      byLayer: files?.byLayer ?? [],
      truncated: diff.status === "ok" ? diff.truncated : false,
      // A PARTIAL index counts as unavailable links: a file whose manifest entry
      // fell past the cap would otherwise render "covers nothing" while the UI
      // claimed the manifest was fine (external code review, MEDIUM). With no
      // rows there is nothing to link, so the manifest is not "at fault".
      manifestStatus: !hasFiles || (index.status === "ok" && !index.truncated) ? "ok" : "unavailable",
      evidence: input.evidence,
    },
  };
}

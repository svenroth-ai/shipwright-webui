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
import type { EventLookup } from "./iterate-record.js";
import type { TestsDiff } from "./tests-diff.js";
import { inferLayer } from "./tests-diff.js";
import type { TraceabilityIndex } from "./traceability.js";
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
 * file header warns against (internal code review, LOW).
 */
function normalizeResults(t: RunTests | null | undefined): MissionTests | null {
  if (!t) return null;
  if ((t.passed ?? 0) === 0 && (t.total ?? 0) === 0) return null;
  return { passed: t.passed, total: t.total };
}

/** "All 42 tests passing" / "40 of 42 tests passing" / "42 tests recorded". */
function resultsSentence(r: MissionTests): string {
  if (r.passed != null && r.total != null) {
    return r.passed === r.total
      ? `All ${plural(r.total, "test", "tests")} passing.`
      : `${r.passed} of ${plural(r.total, "test", "tests")} passing.`;
  }
  if (r.total != null) return `${plural(r.total, "test", "tests")} recorded.`;
  return `${plural(r.passed ?? 0, "test", "tests")} passing.`;
}

/** The compact rail receipt for a counts result. */
function resultsReceipt(r: MissionTests): string {
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

  const results = normalizeResults(events.run.tests);
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
    },
  };
}

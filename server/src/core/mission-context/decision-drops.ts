/*
 * core/mission-context/decision-drops.ts — the OTHER half of the DECISIONS
 * artifact source (CONTRACT §6 row 5).
 *
 * `decisions.ts` reads `decision_log.md`, which is the source ADR-134 named. The
 * measurement that module's own calibration probe made, and then deferred, is
 * the reason this file exists:
 *
 *   An iterate's F3 does NOT write `decision_log.md`. It writes a decision-DROP
 *   (`.shipwright/agent_docs/decision-drops/<run_id>_NNN.json`). The sequential
 *   `ADR-NNN` and the log entry are assigned LATER, at release time, by
 *   `/shipwright-changelog` → `aggregate_decisions.py` — which folds the drops
 *   in and then DELETES them.
 *
 * So between F3 and the next release, a run's decision exists only as a drop and
 * the log filter correctly-but-uselessly returns nothing. Measured on this repo
 * 2026-07-19: 18 drops on disk, 166 run_ids in the log, **0** in both — i.e. all
 * 18 runs' decisions were invisible.
 *
 * Two properties this module is built around:
 *
 *   1. A drop is STRUCTURED JSON carrying exactly the fields the panel renders,
 *      so nothing has to be scraped out of Markdown prose.
 *   2. The drops directory is written to the MAIN tree BY DESIGN (a worktree is
 *      removed before release aggregation, which would destroy them). It is
 *      gitignored. Neither is a bug and neither is ours to "fix" — we are a
 *      READER of this directory and nothing here ever writes to it.
 */

import { readdirSync } from "node:fs";
import path from "node:path";

import { readBoundedFile } from "./fs-read.js";
import { pathGuard, realPathGuard } from "../path-guard.js";
import { isSafeRunId } from "./pointer.js";

export const DECISION_DROPS_REL = ".shipwright/agent_docs/decision-drops";

/** A directory is unbounded in principle; the real one holds 18 files. */
const MAX_DROP_FILES = 200;

/** Real drops are 1.4–2.8 KB. 512 KB is four orders of headroom. */
const MAX_DROP_BYTES = 512 * 1024;

/** One iterate records a handful of ADRs — same ceiling as the log reader. */
export const MAX_DROP_ENTRIES = 20;

/** Per-field, per-entry AND total caps on the Markdown carried in the response. */
const MAX_FIELD_CHARS = 16 * 1024;
const MAX_ENTRY_CHARS = 64 * 1024;
/**
 * Without this, 20 entries x 64 KB could emit over 1 MB in one response. The
 * per-entry cap alone does not bound the whole (external code review, openai
 * #1) — and the log reader next door has always had a total cap, so the two
 * halves of the same artifact were bounded differently.
 */
const MAX_TOTAL_CHARS = 256 * 1024;

/** Absolute path to the drops DIRECTORY — used for `sourceRev` probing. */
export function decisionDropsDir(projectRoot: string): string {
  return path.join(projectRoot, ...DECISION_DROPS_REL.split("/"));
}

export interface DropEntry {
  /** The drop's own filename, e.g. `iterate-…_001.json`. Never shown raw. */
  fileName: string;
  title: string;
  markdown: string;
}

export type DropsLookup =
  | {
      status: "ok";
      entries: DropEntry[];
      /** Files that matched this run but could not be parsed or validated. */
      malformed: number;
      truncated: boolean;
    }
  | { status: "unavailable"; reason: "denied" | "unreadable" };

/**
 * Every drop file belonging to `runId`, absolute, sorted.
 *
 * Exported for `sourceRev`: registering only the DIRECTORY catches a drop being
 * created (which is the S1-class bug this must not repeat), but a directory's
 * mtime does not move when a file's CONTENT is rewritten. Both are needed.
 *
 * Returns [] for an unsafe runId or an unreadable directory — the caller still
 * registers the directory path itself, whose `absent` fingerprint is what makes
 * later creation visible.
 */
export function dropFilePaths(projectRoot: string, runId: string): string[] {
  if (!isSafeRunId(runId)) return [];
  const guard = pathGuard(projectRoot, DECISION_DROPS_REL);
  if (!guard.ok) return [];
  let names: string[];
  try {
    names = readdirSync(guard.absolute, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  } catch {
    return [];
  }
  return names
    .filter((n) => matchesRun(n, runId))
    .sort()
    .slice(0, MAX_DROP_FILES)
    .map((n) => path.join(guard.absolute, n));
}

/**
 * `<runId>_001.json`. The prefix must be followed by `_` — a bare `startsWith`
 * would let `iterate-x` match `iterate-x-followup_001.json`, the same
 * prefix-vs-exact confusion the log reader's EXACT `Run-ID` match avoids.
 */
function matchesRun(fileName: string, runId: string): boolean {
  return fileName.startsWith(`${runId}_`) && fileName.toLowerCase().endsWith(".json");
}

/**
 * Drop a leading UTF-8 BOM.
 *
 * Written as an explicit code-point check rather than a literal BOM in the
 * source, because a literal one is invisible in every editor and diff — the
 * next person to touch this line would not be able to see what it matches.
 */
function stripBom(text: string): string {
  // A LOOP, not a single slice: an editor round-trip can stack more than one
  // (each save prepending its own), and stripping exactly the first would leave
  // `JSON.parse` throwing on the second — the valid-record-reported-as-malformed
  // outcome the single-BOM fix already existed to prevent (cascade, cheap).
  let i = 0;
  while (i < text.length && text.charCodeAt(i) === 0xfeff) i++;
  return i === 0 ? text : text.slice(i);
}

function field(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t.length === 0) return null;
  return t.length > MAX_FIELD_CHARS ? `${t.slice(0, MAX_FIELD_CHARS)}\n\n…` : t;
}

const SECTIONS: { key: string; heading: string }[] = [
  { key: "context", heading: "Context" },
  { key: "decision", heading: "Decision" },
  { key: "rationale", heading: "Rationale" },
  { key: "consequences", heading: "Consequences" },
  { key: "rejected", heading: "Rejected alternatives" },
  { key: "architecture_impact", heading: "Architecture impact" },
];

/**
 * Render one drop as the Markdown the right panel shows.
 *
 * Deliberately NOT given an `ADR-NNN` heading: this decision has no number yet,
 * and inventing one — even a plausible next-in-sequence — would be a fabricated
 * identifier that a reader could cite. The caller carries `adrId: null` and the
 * UI says so in words instead.
 */
function renderDrop(o: Record<string, unknown>): { title: string; markdown: string } | null {
  const title = field(o.title);
  if (!title) return null;

  const lines: string[] = [`### ${title}`, ""];
  const runId = field(o.run_id);
  const date = field(o.date);
  const section = field(o.section);
  if (runId) lines.push(`- **Run-ID:** ${runId}`);
  if (date) lines.push(`- **Date:** ${date}`);
  if (section) lines.push(`- **Section:** ${section}`);
  if (lines.length > 2) lines.push("");

  for (const { key, heading } of SECTIONS) {
    const v = field(o[key]);
    if (!v) continue;
    lines.push(`**${heading}**`, "", v, "");
  }

  const commit = field(o.commit);
  const specRef = field(o.spec_ref);
  if (commit) lines.push(`- **Commit:** \`${commit}\``);
  if (specRef) lines.push(`- **Record:** ${specRef}`);

  const markdown = lines.join("\n").trimEnd();
  return {
    title,
    markdown:
      markdown.length > MAX_ENTRY_CHARS ? `${markdown.slice(0, MAX_ENTRY_CHARS)}\n\n…` : markdown,
  };
}

/**
 * The decision-drops this run recorded but which no release has numbered yet.
 *
 * `unavailable` means the DIRECTORY could not be read — we know nothing either
 * way. An `ok` with zero entries means the directory WAS read and holds nothing
 * for this run, which is a real answer. The caller renders those differently,
 * and keeping them apart is the entire point of this iterate.
 *
 * A single malformed drop is COUNTED, not fatal: one half-written file must
 * never take down the decisions of a run that also recorded good ones.
 */
export function readRunDrops(projectRoot: string, runId: string): DropsLookup {
  if (!isSafeRunId(runId)) return { status: "unavailable", reason: "denied" };

  const guard = pathGuard(projectRoot, DECISION_DROPS_REL);
  if (!guard.ok) return { status: "unavailable", reason: "denied" };

  let names: string[];
  try {
    names = readdirSync(guard.absolute, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  } catch (err) {
    // The directory not existing is NOT a fault: no iterate has run F3 here yet.
    // Anything else (permissions, an I/O error, a file where the dir should be)
    // is a fault and must stay visible.
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") return { status: "ok", entries: [], malformed: 0, truncated: false };
    return { status: "unavailable", reason: "unreadable" };
  }

  const matched = names.filter((n) => matchesRun(n, runId)).sort();
  const entries: DropEntry[] = [];
  let malformed = 0;
  let truncated = matched.length > MAX_DROP_FILES;
  let totalChars = 0;

  for (const fileName of matched.slice(0, MAX_DROP_FILES)) {
    if (entries.length >= MAX_DROP_ENTRIES) {
      truncated = true;
      break;
    }
    const absolute = path.join(guard.absolute, fileName);
    // The name came from readdir, but the entry can still be a symlink pointing
    // out of the root — realPathGuard is what closes that (DO-NOT #10).
    if (!realPathGuard(projectRoot, absolute).ok) {
      malformed++;
      continue;
    }
    const read = readBoundedFile(absolute, MAX_DROP_BYTES);
    if (!read) {
      malformed++;
      continue;
    }
    let parsed: unknown;
    try {
      // Strip a UTF-8 BOM first. `JSON.parse` throws on it at character ZERO,
      // so a BOM-prefixed drop would be reported as MALFORMED when it is a
      // perfectly good decision — a valid record rendered as a read failure,
      // which is this iterate's own defect family pointed at itself. Producers
      // here are Python on Windows, and any editor round-trip can add one.
      // (Found by a boundary probe, not by review.)
      parsed = JSON.parse(stripBom(read.text));
    } catch {
      malformed++;
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      malformed++;
      continue;
    }
    const o = parsed as Record<string, unknown>;
    // The FILENAME claims a run; the CONTENT is what we believe. A drop whose
    // `run_id` disagrees with its name is not this run's decision.
    //
    // NOT counted as malformed: this file read fine and parsed fine, so
    // "N further records could not be read" would be simply untrue of it. It is
    // in exactly the same category as a file whose NAME does not match, which we
    // also pass over in silence — it is another run's record, not a damaged one
    // (cascade, cheap). The content is still never surfaced.
    if (field(o.run_id) !== runId) {
      continue;
    }
    const rendered = renderDrop(o);
    if (!rendered) {
      malformed++;
      continue;
    }
    if (totalChars + rendered.markdown.length > MAX_TOTAL_CHARS) {
      // Stop rather than clip mid-entry, and SAY that entries were omitted.
      truncated = true;
      break;
    }
    totalChars += rendered.markdown.length;
    entries.push({ fileName, title: rendered.title, markdown: rendered.markdown });
  }

  return { status: "ok", entries, malformed, truncated };
}

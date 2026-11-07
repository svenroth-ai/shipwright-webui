/*
 * core/mission-context/iterate-record.ts — the resolve-BY-RUN_ID join.
 *
 * Two sources carry a finalized iterate's facts, and BOTH are needed:
 *
 *   1. `.shipwright/agent_docs/iterates/<run_id>.json` — keyed by run_id, the
 *      cleaner source. CONTRACT §5 calls it verified for
 *      `{affected_frs,new_frs,spec_impact}` and it is — but MEASURED ON THIS
 *      REPO 2026-07-18, only 1 of 59 such files actually carries those keys.
 *   2. `work_completed` in `shipwright_events.jsonl` (`adr_id == run_id`) —
 *      130 of 210 iterate-keyed rows carry `affected_frs`, 128 carry `tests`.
 *
 * So (2) is the PRIMARY path in practice and (1) is the preferred-when-present
 * override, not the other way round. Getting this backwards would have shipped
 * an empty Requirement artifact for ~98% of real runs.
 *
 * The field coverage above is the WEAKER of the two reasons, and it is the one
 * that can improve — so do not let it talk you into flipping the order. The
 * STRUCTURAL reason cannot: source (1) is a bounded 50-entry recency window
 * (`append_iterate_entry` retention) that EVICTS, while (2) is append-only and
 * never evicted. Upstream states this as a contract — shipwright
 * `plugins/shipwright-iterate/skills/iterate/references/F5c.md`, "Consumer
 * rule": anything that must show the FULL iterate history reads
 * `shipwright_events.jsonl`, NOT this directory, which is a 50-run recency
 * cache and not the historical record. Measured here 2026-07-21: 214 runs in
 * the event log, 54 surviving agent-docs — 75% already evicted. Hence every
 * read below is BY RUN_ID; nothing in webui may enumerate this directory.
 *
 * Absence vs unavailability is tracked deliberately: an events log that cannot
 * be READ is `unavailable`, not "no run exists". A capped or failed scan that
 * silently reports emptiness would fake absence (§5.2, Review-2 GPT #7).
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { readBoundedFile } from "./fs-read.js";

import { absenceBlockers, type EventFileStatus } from "../event-log-assemble.js";
import { eventLogFingerprint, readAssembledEventLog } from "../event-log-files.js";
import { projectEventLog, type RunProjection } from "../event-log-reader.js";
import { pathGuard } from "../path-guard.js";
import { isSafeRunId } from "./pointer.js";

export const EVENTS_FILE = "shipwright_events.jsonl";

/** Caps that bound a corrupt/huge source (CONTRACT §11 "bounded, not OOM"). */
const MAX_RECORD_BYTES = 1024 * 1024;

/** Facts from `iterates/<run_id>.json`. Every field is optional in the wild. */
export interface IterateDoc {
  specImpact: string | null;
  affectedFrs: string[];
  newFrs: string[];
  /** The recorded spec path — used only as a HINT, never as a read path. */
  specHint: string | null;
  complexity: string | null;
  changeType: string | null;
  testsPassed: boolean | null;
  mtimeMs: number;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Read the per-run agent-doc. The run_id is grammar-validated before it becomes
 * a filename, and the read is pathGuard'ed against the project root.
 */
export function readIterateDoc(projectRoot: string, runId: string): IterateDoc | null {
  if (!isSafeRunId(runId)) return null;
  const rel = [".shipwright", "agent_docs", "iterates", `${runId}.json`].join("/");
  const guard = pathGuard(projectRoot, rel);
  if (!guard.ok || !existsSync(guard.absolute)) return null;

  // ONE atomic read — the mtime describes exactly the bytes parsed below
  // (CodeQL js/file-system-race).
  const read = readBoundedFile(guard.absolute, MAX_RECORD_BYTES);
  if (!read) return null;
  const mtimeMs = read.mtimeMs;

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;

  return {
    specImpact: typeof o.spec_impact === "string" ? o.spec_impact : null,
    affectedFrs: asStringArray(o.affected_frs),
    newFrs: asStringArray(o.new_frs),
    specHint: typeof o.spec === "string" ? o.spec : null,
    complexity: typeof o.complexity === "string" ? o.complexity : null,
    changeType: typeof o.type === "string" ? o.type : null,
    testsPassed: typeof o.tests_passed === "boolean" ? o.tests_passed : null,
    mtimeMs,
  };
}

export type EventLookup =
  | { status: "found"; run: RunProjection; mtimeMs: number }
  | { status: "absent"; mtimeMs: number }
  | { status: "unavailable" };

interface EventIndexEntry {
  /** `eventLogFingerprint`: every event file's (path, mtime, size). */
  fingerprint: string;
  /** Newest mtime among the files (the `mtimeMs` the lookup reports). */
  mtimeMs: number;
  /** run_id → its winning `work_completed` projection. Built once per change. */
  index: Map<string, RunProjection>;
  files: EventFileStatus[];
}

/** Per-log run_id index, keyed by the log's absolute path. */
const eventIndexCache = new Map<string, EventIndexEntry>();
const EVENT_INDEX_CAP = 32;

/**
 * Find the `work_completed` row for `runId`.
 *
 * `unavailable` is returned when the log itself cannot be read — distinct from
 * `absent` ("the log is fine, this run simply is not in it yet", the normal
 * mid-run state). The UI renders those two very differently and conflating them
 * would turn an I/O fault into a confident "nothing exists".
 *
 * INDEXED (CONTRACT §5.2). The Mission tab polls once a second, so the full
 * run_id → projection index is cached and rebuilt ONLY when the event files'
 * fingerprint moves — every listed file's (path, mtime, size), because a drop
 * folder's own mtime does not move on an APPEND (events-drop-files, issue 978).
 * The log read is the ASSEMBLED one (legacy + archive + drops, drop-layout
 * amendments applied). A damaged drop file that may hold this run's events
 * turns `absent` into `unavailable` (kill criterion 8): a broken file must not
 * read as "this run has no record".
 */
export function findWorkCompleted(projectRoot: string, runId: string): EventLookup {
  if (!pathGuard(projectRoot, EVENTS_FILE).ok) return { status: "unavailable" };
  const fingerprint = eventLogFingerprint(projectRoot);
  if (fingerprint === "") return { status: "absent", mtimeMs: 0 };

  const cacheKey = path.resolve(projectRoot);
  let entry = eventIndexCache.get(cacheKey) ?? null;
  if (!entry || entry.fingerprint !== fingerprint) {
    const log = readAssembledEventLog(projectRoot);
    if (!log) return { status: "unavailable" };
    // ONE scan builds the FULL run_id index; `projectEventLog` already keeps
    // only the winning `work_completed` per adr_id.
    const index = new Map<string, RunProjection>();
    for (const r of projectEventLog(log.effectiveLines).runs) index.set(r.runId, r);
    // Only drop/archive rows can block absence; the legacy row (which may hold the
    // whole legacy text lazily) is never cached.
    entry = { fingerprint, mtimeMs: newestMtime(fingerprint), index, files: log.files.filter((f) => f.kind !== "legacy") };
    if (eventIndexCache.size >= EVENT_INDEX_CAP) eventIndexCache.clear();
    eventIndexCache.set(cacheKey, entry);
  }

  const run = entry.index.get(runId) ?? null;
  if (run) return { status: "found", run, mtimeMs: entry.mtimeMs };
  if (absenceBlockers(entry.files, runId).length > 0) return { status: "unavailable" };
  return { status: "absent", mtimeMs: entry.mtimeMs };
}

/** The newest mtime in an `eventLogFingerprint` string (`path:mtime:size|…`). */
function newestMtime(fingerprint: string): number {
  let newest = 0;
  for (const part of fingerprint.split("|")) {
    const fields = part.split(":");
    const mtime = Number(fields[fields.length - 2]);
    if (Number.isFinite(mtime) && mtime > newest) newest = mtime;
  }
  return newest;
}

/** Test-only: drop the module-level event-log index cache between cases. */
export function _clearEventIndexCache(): void {
  eventIndexCache.clear();
}

/** Absolute path to the tracked event log (for sourceRev probing). */
export function eventsPath(projectRoot: string): string {
  return path.join(projectRoot, EVENTS_FILE);
}

/** Absolute path to the per-run agent-doc (for sourceRev probing). */
export function iterateDocPath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, ".shipwright", "agent_docs", "iterates", `${runId}.json`);
}

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
 * Absence vs unavailability is tracked deliberately: an events log that cannot
 * be READ is `unavailable`, not "no run exists". A capped or failed scan that
 * silently reports emptiness would fake absence (§5.2, Review-2 GPT #7).
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { readBoundedFile, readBoundedFileIfChanged } from "./fs-read.js";

import { projectEventLog, type RunProjection } from "../event-log-reader.js";
import { pathGuard } from "../path-guard.js";
import { isSafeRunId } from "./pointer.js";

export const EVENTS_FILE = "shipwright_events.jsonl";

/** Caps that bound a corrupt/huge source (CONTRACT §11 "bounded, not OOM"). */
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_EVENT_LOG_BYTES = 64 * 1024 * 1024;

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
  mtimeMs: number;
  sizeBytes: number;
  /** run_id → its winning `work_completed` projection. Built once per change. */
  index: Map<string, RunProjection>;
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
 * INDEXED (CONTRACT §5.2). The Mission tab polls once a second, and the log went
 * quiescent the moment the run finalized — so re-reading and re-projecting all
 * of `shipwright_events.jsonl` every poll was pure waste. Instead the full
 * run_id → projection index is cached and rebuilt ONLY when the log's
 * `(mtime, size)` fingerprint moves; an unchanged log costs one fstat and an
 * O(1) `Map` lookup.
 */
export function findWorkCompleted(projectRoot: string, runId: string): EventLookup {
  const guard = pathGuard(projectRoot, EVENTS_FILE);
  if (!guard.ok) return { status: "unavailable" };
  if (!existsSync(guard.absolute)) return { status: "absent", mtimeMs: 0 };

  // Read the bytes ONLY when the fingerprint changed. Still one atomic
  // descriptor (open→fstat→maybe-read), so the mtime that keys the index
  // describes exactly the bytes it was built from (CodeQL js/file-system-race).
  const cached = eventIndexCache.get(guard.absolute) ?? null;
  const read = readBoundedFileIfChanged(
    guard.absolute,
    MAX_EVENT_LOG_BYTES,
    cached ? { mtimeMs: cached.mtimeMs, sizeBytes: cached.sizeBytes } : null,
  );
  if (!read) return { status: "unavailable" };

  let entry: EventIndexEntry;
  if (read.changed) {
    // (Re)build the FULL run_id index in ONE scan. `projectEventLog` already
    // keeps only the winning `work_completed` per adr_id, so indexing its `runs`
    // yields exactly what the old per-call `{ runId }` filter returned — for
    // every run at once, so any later poll for the same log is a map lookup.
    const index = new Map<string, RunProjection>();
    for (const r of projectEventLog(read.text.split(/\r?\n/)).runs) {
      index.set(r.runId, r);
    }
    entry = { mtimeMs: read.mtimeMs, sizeBytes: read.sizeBytes, index };
    if (eventIndexCache.size >= EVENT_INDEX_CAP) eventIndexCache.clear();
    eventIndexCache.set(guard.absolute, entry);
  } else if (cached) {
    entry = cached; // fingerprint unchanged — serve the cached index verbatim
  } else {
    // Unreachable: `changed: false` is only returned when a prior fingerprint
    // was supplied, which happens only when `cached` exists. Kept total and
    // fail-safe rather than assert.
    return { status: "unavailable" };
  }

  const run = entry.index.get(runId) ?? null;
  return run
    ? { status: "found", run, mtimeMs: entry.mtimeMs }
    : { status: "absent", mtimeMs: entry.mtimeMs };
}

/** Test-only: drop the module-level event-log index cache between cases. */
export function _clearEventIndexCache(): void {
  eventIndexCache.clear();
}

/**
 * Candidate SPEC document locations, in preference order, built from the KNOWN
 * LAYOUT only — never from a pointer- or record-supplied sub-path (§5.1c).
 *
 * Both real layouts are covered: the per-run directory
 * (`…/iterate/<run_id>/mini-plan.md`) and the flat file
 * (`…/iterate/<date-slug>.md`, i.e. the run_id minus its `iterate-` prefix,
 * which is the shape the `spec` field records).
 */
export function specCandidates(runId: string, slug: string | null): string[][] {
  const base = [".shipwright", "planning", "iterate"];
  const dateSlug = runId.startsWith("iterate-") ? runId.slice("iterate-".length) : runId;
  const candidates: string[][] = [
    [...base, runId, "mini-plan.md"],
    [...base, runId, "adr.md"],
    [...base, `${runId}.md`],
    [...base, `${dateSlug}.md`],
  ];
  if (slug && slug !== dateSlug) candidates.push([...base, `${slug}.md`]);
  return candidates;
}

/**
 * The `spec` path RECORDED BY THE FRAMEWORK in `iterates/<run_id>.json`,
 * validated into known-layout segments — or null.
 *
 * Why this exists (PROBE, 2026-07-18): measuring the 206 real iterate runs in
 * this repo, the known-layout candidates resolve 82; 105 have genuinely no
 * document left on disk; and **19 have a real spec the candidates MISS** —
 * campaign SUB-ITERATE specs, which live at
 * `.shipwright/planning/iterate/campaigns/<campaign>/sub-iterates/<ID>-<slug>.md`.
 * That is this very campaign's own layout, so without this a campaign
 * sub-iterate would show no Spec artifact at all.
 *
 * This is NOT a relaxation of §5.1. That rule forbids trusting a sub-path from
 * the POINTER — untrusted, out-of-process input. This value comes from the
 * framework's own agent-doc, and it is still fully constrained here:
 *   - it must live under `.shipwright/planning/iterate/` (so a recorded
 *     `01-adopted/spec.md#FR-01.25` — the whole project spec, which would be
 *     misleading as "the plan for this run" — is rejected along with anything
 *     outside the iterate tree);
 *   - any `#fragment` is dropped;
 *   - every segment must pass the strict id grammar (kills `..`, separators,
 *     encoded separators and unusual Unicode);
 *   - it must end in `.md`;
 * and the caller still runs pathGuard + realPathGuard against the chosen root,
 * which remains the actual security boundary.
 */
export function specHintCandidate(hint: string | null | undefined): string[] | null {
  if (typeof hint !== "string" || hint.length === 0 || hint.length > 512) return null;
  const withoutFragment = hint.split("#")[0].trim();
  if (!withoutFragment.toLowerCase().endsWith(".md")) return null;

  const parts = withoutFragment.replace(/\\/g, "/").split("/").filter((p) => p.length > 0);
  const prefix = [".shipwright", "planning", "iterate"];
  if (parts.length <= prefix.length) return null;
  for (let i = 0; i < prefix.length; i++) {
    if (parts[i] !== prefix[i]) return null;
  }
  // Every remaining segment must be a safe id (the `.md` leaf included).
  for (const seg of parts.slice(prefix.length)) {
    if (!isSafeRunId(seg)) return null;
  }
  return parts;
}

/** Absolute path to the tracked event log (for sourceRev probing). */
export function eventsPath(projectRoot: string): string {
  return path.join(projectRoot, EVENTS_FILE);
}

/** Absolute path to the per-run agent-doc (for sourceRev probing). */
export function iterateDocPath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, ".shipwright", "agent_docs", "iterates", `${runId}.json`);
}

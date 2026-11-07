/*
 * core/mission-context/merged-events.ts — read a finished run's work_completed
 * from the DEFAULT REMOTE REF when it is not in the working tree yet.
 *
 * WHY (2026-07-23, Sven — sessions 3cfa001d / 2ed3c046). An iterate records its
 * `work_completed` into `shipwright_events.jsonl` INSIDE its PR. After a squash
 * merge the row is on `origin/main` — but the user's main working tree is not
 * pulled (the iterate merges via `gh`; the main tree stays at its old HEAD), so
 * `findWorkCompleted` (working-tree only) reports `absent` and every artifact
 * that hangs off the run vanishes, leaving ONLY Decisions (which are written to
 * the main tree directly at F3). MEASURED: `origin/main`'s events.jsonl DOES
 * carry the merged row locally (origin is fetched at finalization), so this is
 * a read-path gap, not missing data.
 *
 * Since events-drop-files (issue 978) the ref read is the ASSEMBLED log —
 * legacy file + archive + drop files via `ls-tree` + one `cat-file --batch`
 * (`ref-event-log.ts`), no longer a single `git show <ref>:<file>`.
 *
 * Same read-only, ARG-ARRAY, `shell:false` git discipline as merge-check.ts.
 * The ref and the filename are both CONSTANTS — nothing here is attacker-
 * influenced and no path is built from user input. The result is a normal
 * `EventLookup`, so the resolver substitutes it for the working-tree lookup
 * with no downstream change.
 *
 * Consulted ONLY when the run's own worktree is gone (finished) AND the working
 * tree lacks the row — never for a live run, whose row is not on the ref yet.
 * `unavailable` (ref unreadable / never fetched) is kept distinct from `absent`
 * (ref read fine, run genuinely not on it): the resolver declines to cache the
 * former so a later fetch is picked up.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { findWorkCompleted, type EventLookup } from "./iterate-record.js";
import { readAssembledEventLogAtRef, type BlobReader } from "./ref-event-log.js";
import { absenceBlockers, type EventFileStatus } from "../event-log-assemble.js";
import { projectEventLog, type RunProjection } from "../event-log-reader.js";
import type { GitRunner } from "./worktree-roots.js";

const execFileP = promisify(execFile);

/** The default line webui merges to (matches merge-check.ts's `origin/main`). */
const DEFAULT_REF = "origin/main";
const TTL_MS = 60_000;
const CACHE_CAP = 64;
/**
 * The ref-blob read must budget the SAME ceiling as the working-tree reader it
 * substitutes for — `iterate-record.ts`'s `MAX_EVENT_LOG_BYTES` (64 MB) — NOT
 * worktree-roots' 4 MB `defaultGit`. `shipwright_events.jsonl` is append-only and
 * never evicted; once it crosses 4 MB, a 4 MB `git show` would overflow
 * `maxBuffer`, throw, degrade to `unavailable`, and silently re-collapse the rail
 * to Decisions for exactly the projects this module exists to serve — and never
 * recover, since the file only grows (internal code review, MEDIUM).
 */
const MAX_REF_BLOB_BYTES = 64 * 1024 * 1024;

/** ARG-ARRAY, `shell:false`, big-buffer git for reading the (large) event blob. */
const defaultGit: GitRunner = async (args, cwd) => {
  const { stdout } = await execFileP("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 8000,
    windowsHide: true,
    maxBuffer: MAX_REF_BLOB_BYTES,
  });
  return stdout;
};

interface RefEntry {
  at: number;
  /** run_id → its winning `work_completed` projection; empty when unreadable. */
  runs: Map<string, RunProjection>;
  /** False when the ref blob could not be read at all (never fetched, no git). */
  ok: boolean;
  /** Per-file status of the ref's event files (a damaged own drop blocks "absent"). */
  files: EventFileStatus[];
}

/** Per-(projectRoot, ref) blob index, TTL'd so N tabs share ONE `git show`. */
const cache = new Map<string, RefEntry>();

export interface MergedEventsDeps {
  git?: GitRunner;
  /** Blob reader for `cat-file --batch`; tests inject a fake. */
  readBlobs?: BlobReader;
  /** Default ref to read; overridden in tests with a real fixture repo. */
  ref?: string;
  now?: () => number;
  ttlMs?: number;
}

async function loadRef(
  projectRoot: string,
  ref: string,
  git: GitRunner,
  now: () => number,
  readBlobs?: BlobReader,
): Promise<RefEntry> {
  // The ASSEMBLED log at the ref (legacy + archive + drops) via ONE `ls-tree` and
  // ONE `cat-file --batch` (`ref-event-log.ts`); null = ref absent (never
  // fetched), not a repo, git missing, or no event file at that ref — we cannot
  // read the merged copy. NOT "no such run".
  const log = await readAssembledEventLogAtRef(projectRoot, ref, git, readBlobs);
  if (!log) return { at: now(), runs: new Map(), ok: false, files: [] };
  const runs = new Map<string, RunProjection>();
  for (const r of projectEventLog(log.effectiveLines).runs) runs.set(r.runId, r);
  return { at: now(), runs, ok: true, files: log.files.filter((f) => f.kind !== "legacy") };
}

/**
 * The `work_completed` row for `runId` as it exists on the default remote ref.
 *
 * `unavailable` — the ref/blob could not be read at all.
 * `absent`      — the ref read fine and this run is not on it (not merged yet).
 * `found`       — the merged row, with `mtimeMs: 0` (a git blob has no mtime;
 *                 the field is unused downstream, which the resolver relies on).
 */
export async function findWorkCompletedFromMergedRef(
  projectRoot: string,
  runId: string,
  deps: MergedEventsDeps = {},
): Promise<EventLookup> {
  const git = deps.git ?? defaultGit;
  const ref = deps.ref ?? DEFAULT_REF;
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? TTL_MS;
  const key = `${projectRoot}::${ref}`;

  let entry = cache.get(key);
  if (!entry || now() - entry.at > ttl) {
    entry = await loadRef(projectRoot, ref, git, now, deps.readBlobs);
    if (cache.size >= CACHE_CAP) cache.clear();
    cache.set(key, entry);
  }

  if (!entry.ok) return { status: "unavailable" };
  const run = entry.runs.get(runId) ?? null;
  if (run) return { status: "found", run, mtimeMs: 0 };
  return absenceBlockers(entry.files, runId).length > 0
    ? { status: "unavailable" }
    : { status: "absent", mtimeMs: 0 };
}

export interface ResolvedEvents {
  events: EventLookup;
  /** True when the ref WAS consulted for a finished run and did not find it —
   *  the resolver declines to cache that, so a later fetch is picked up. */
  mergedRefMiss: boolean;
}

/**
 * The run's `work_completed` — WORKING TREE first, then the merged ref for a
 * FINISHED run (`!isWorktree`) whose row has not been pulled (see the module
 * header). A live run keeps a registered worktree and its row is not on the ref
 * yet, so it is never asked.
 */
export async function resolveWorkCompleted(
  projectRoot: string,
  runId: string,
  isWorktree: boolean,
  deps: MergedEventsDeps = {},
): Promise<ResolvedEvents> {
  const events = findWorkCompleted(projectRoot, runId);
  if (events.status !== "absent" || isWorktree) return { events, mergedRefMiss: false };
  const fromRef = await findWorkCompletedFromMergedRef(projectRoot, runId, deps);
  return fromRef.status === "found"
    ? { events: fromRef, mergedRefMiss: false }
    : { events, mergedRefMiss: true };
}

/** Test-only: drop the module-level ref cache between cases. */
export function _clearMergedEventsCache(): void {
  cache.clear();
}

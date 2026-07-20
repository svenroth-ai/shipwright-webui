/*
 * triage-write.ts — append-only write surface for `triage.jsonl`.
 *
 * Write target (campaign 2026-06-08-triage-outbox-delivery; mirrors
 * triage.py mark_status, updated 2026-06-12):
 *   1. Idle main (origin remote AND HEAD == default branch — the webui's
 *      normal runtime context) → the per-tree gitignored outbox
 *      (`triage.outbox.jsonl`), symmetric with background appends. A flip on a
 *      TRACKED-resident item would otherwise leave an undelivered status line
 *      on the tracked store: idle-main drift that blocks a hand `git pull` AND
 *      never reaches origin (the iterate sweep delivers only the outbox).
 *   2. Otherwise residence-derived (TRACKED-PREFERRED): the flip follows its
 *      item's `append` — outbox iff the append lives ONLY in the outbox; else
 *      tracked (so a no-origin / non-default-branch repo keeps it on tracked).
 *   The outbox is a headerless buffer: a flip written there never bootstraps a
 *   schema header.
 *
 * Cross-process lock note (Iterate 2026-05-14, ADR-101):
 *   Python producers use msvcrt/fcntl byte-locks via `_FileLock` (sidecar
 *   `<file>.lock`). Webui uses `proper-lockfile` (directory-based `.lock`).
 *   The two primitives DON'T compose. Mitigation: append-mode small writes
 *   are line-atomic at OS level (POSIX up to PIPE_BUF; Windows for sub-page
 *   buffered writes), and the only Python tool that writes status events
 *   for arbitrary ids is the manual `triage_promote.py` CLI. Last-status-
 *   wins resolution (file order) means the latest write reflects operator
 *   intent regardless of which path won the race. Both tracked + outbox
 *   writes happen under the SAME tracked-path lock the route already holds.
 *   A residence mis-derivation under the cross-primitive race (e.g. a Python
 *   producer writes a tracked append for this id between the two probes
 *   below and this write, so the flip lands in the outbox instead of tracked)
 *   is NON-LOSSY: the union reader resolves status by id across BOTH files,
 *   so the flip still applies — only its residence is momentarily "wrong",
 *   and the D2 GC drops the redundant outbox copy after the sweep.
 *
 * Lock-order convention (global):
 *   triage.jsonl FIRST, then sdk-sessions.json. Smaller blast radius if
 *   triage lock is slow. Documented in conventions.md.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { TriageStatus, TriageStatusEvent } from "../types/triage.js";
import { endsWithoutNewline } from "./jsonl-records.js";
import { appendIdsInFile, invalidateCacheForPath } from "./triage-store.js";
import { outboxPathFor } from "./triage-paths.js";

export type TriageWriteErrorCode =
  | "triage_file_disappeared"
  | "triage_write_failed";

export class TriageWriteError extends Error {
  constructor(
    readonly code: TriageWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TriageWriteError";
  }
}

export interface AppendStatusEventArgs {
  jsonlPath: string;
  triageId: string;
  newStatus: TriageStatus;
  by: string;
  reason: string | null;
  promotedTaskId: string | null;
  /** Caller's now provider — injectable so tests can pin the timestamp. */
  now?: () => string;
}

/**
 * Append a status event line to triage.jsonl. Caller is responsible for
 * holding the appropriate cross-process lock (proper-lockfile in production)
 * BEFORE calling this helper.
 *
 * Wire format mirrors `triage.py mark_status` exactly:
 *   {"event":"status","id":...,"ts":...,"newStatus":...,"by":...,"reason":...,"promotedTaskId":...}
 *
 * `args.jsonlPath` is the TRACKED `triage.jsonl` path; the write target is
 * DERIVED from where the item's `append` lives (residence-derived,
 * TRACKED-PREFERRED — see the module header). The caller holds the
 * tracked-path lock, which covers BOTH the tracked + outbox writes.
 *
 * Always uses JSON.stringify (never manual string interpolation) so
 * newlines / quotes / control chars in `reason` are properly escaped
 * (OpenAI external review #11 — JSONL-injection guard).
 *
 * Throws `TriageWriteError("triage_file_disappeared")` when ENOENT fires
 * during append (a Python producer or operator may have rotated the file).
 * Other errors throw `TriageWriteError("triage_write_failed")`.
 */
export function appendStatusEvent(args: AppendStatusEventArgs): void {
  const ts = args.now ? args.now() : nowIsoZ();
  const event: TriageStatusEvent = {
    event: "status",
    id: args.triageId,
    ts,
    newStatus: args.newStatus,
    by: args.by,
    reason: args.reason,
    promotedTaskId: args.promotedTaskId,
  };
  const line = JSON.stringify(event) + "\n";

  const trackedPath = args.jsonlPath;
  const outboxPath = outboxPathFor(trackedPath);

  const inOutbox = appendIdsInFile(outboxPath).has(args.triageId);
  const inTracked = appendIdsInFile(trackedPath).has(args.triageId);
  // Idle main (origin + HEAD==default) → outbox, symmetric with background
  // appends; else residence-derived (TRACKED-PREFERRED): outbox iff the append
  // lives ONLY in the outbox; tracked when it is in tracked (or both) or in
  // neither. Mirrors `triage.py mark_status` (2026-06-12) so a dismiss on idle
  // main never leaves an undelivered status line on the tracked log (drift that
  // blocks a hand pull and never reaches origin — the sweep delivers only the
  // outbox). The webui always runs on the target's main checkout, so this is
  // normally True; it fails safe to tracked for a no-origin / non-default repo.
  const projectRoot = path.dirname(path.dirname(trackedPath));
  const toOutbox = shouldRouteToOutbox(projectRoot) || (inOutbox && !inTracked);
  const targetPath = toOutbox ? outboxPath : trackedPath;

  // Ensure the parent directory exists (first-write case on an adopted
  // project that's never had a triage event before). Directory creation
  // is itself a write and is also caller-lock-protected.
  const parent = path.dirname(targetPath);
  try {
    // mkdir -p is idempotent (no EEXIST when the directory already exists), so
    // create unconditionally rather than existsSync-check-then-mkdir — the same
    // check-then-act TOCTOU shape (CodeQL js/file-system-race) the header write
    // below now avoids.
    mkdirSync(parent, { recursive: true });
    if (!toOutbox) {
      // Tracked store only — bootstrap the schema header so producers +
      // downstream readers see a complete file. The outbox is a headerless
      // transient buffer and is NEVER given a header.
      //
      // Exclusive-create ("wx") instead of an existsSync check-then-write
      // (CodeQL js/file-system-race #292): the former probe was a TOCTOU — a
      // Python producer (disjoint lock primitive, ADR-101 / ADR-106) that
      // created AND populated the tracked store in the window between the probe
      // and the write would be TRUNCATED by writeFileSync, and the read-side
      // `splitRecords` recovery cannot bring back deleted bytes. "wx" fails
      // closed with EEXIST when the file already exists, so a concurrent create
      // is a no-op here (the header is already present) rather than a clobber.
      const header = JSON.stringify({
        v: 1,
        schema: "triage",
        created: ts,
      });
      try {
        writeFileSync(targetPath, header + "\n", { flag: "wx" });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
    // Termination guard (iterate-2026-07-18-triage-jsonl-record-boundary,
    // mirroring `triage.py _append_line`): never assume the PREVIOUS writer
    // left a trailing newline, or two records land on one physical line and a
    // reader without record-boundary recovery discards BOTH.
    //
    // Probed immediately before the append to keep the TOCTOU window minimal.
    // This is deliberately BEST-EFFORT, not a guarantee: `proper-lockfile`
    // serialises only TS callers, while the Python producers use a disjoint
    // primitive (ADR-101 / ADR-106), so a foreign write can still land between
    // this probe and the append below. The guard repairs a PRE-EXISTING
    // unterminated tail; `jsonl-records.splitRecords` on the read side is what
    // actually guarantees no record is lost. Both halves are required.
    const separator = endsWithoutNewline(targetPath) ? "\n" : "";
    appendFileSync(targetPath, separator + line);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new TriageWriteError(
        "triage_file_disappeared",
        `triage store disappeared mid-write at ${targetPath}`,
      );
    }
    throw new TriageWriteError(
      "triage_write_failed",
      `triage store write failed: ${String(err).slice(0, 200)}`,
    );
  }

  // Drop the read cache (keyed by the tracked path) so the very next GET sees
  // the new event regardless of which file received it.
  invalidateCacheForPath(trackedPath);
}

function nowIsoZ(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Mirror of `shared/scripts/triage.py should_route_to_outbox`: a status flip
 * routes to the per-tree outbox when the target project has a real delivery
 * path (an `origin` remote) AND HEAD is on the default branch (idle main — the
 * webui never runs inside an iterate/* worktree). Any git failure (non-repo,
 * git missing, detached HEAD) fails SAFE to the tracked store. This keeps an
 * idle-main dismiss off the tracked log (no undelivered drift / `git pull`
 * block); the iterate sweep then delivers the outbox to origin.
 */
export function shouldRouteToOutbox(projectRoot: string): boolean {
  const git = (gitArgs: string[]): string | null => {
    try {
      const r = spawnSync("git", ["-C", projectRoot, ...gitArgs], {
        encoding: "utf-8",
        shell: false,
        timeout: 5000,
        windowsHide: true,
      });
      return r.status === 0 ? r.stdout.trim() : null;
    } catch {
      return null;
    }
  };
  if (git(["remote", "get-url", "origin"]) === null) return false; // no delivery path
  const current = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!current) return false;
  const head = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const defaultBranch = head ? head.replace(/^origin\//, "") : "main";
  return current === defaultBranch;
}

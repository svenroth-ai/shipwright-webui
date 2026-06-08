/*
 * triage-write.ts — append-only write surface for `triage.jsonl`.
 *
 * Residence-derived target (campaign 2026-06-08-triage-outbox-delivery / D1;
 * mirrors triage.py mark_status, TRACKED-PREFERRED):
 *   The status line follows its item's `append`. If the append lives ONLY in
 *   the per-tree gitignored outbox (`triage.outbox.jsonl`) the flip is written
 *   THERE; if it lives in the tracked store (or both) it goes to tracked. This
 *   stops a webui status flip on an idle-main background finding from landing
 *   an orphan line in the tracked store — the exact main-tree drift the outbox
 *   campaign eliminated. The outbox is a headerless buffer: a status flip
 *   written to it never bootstraps a schema header.
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

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { TriageStatus, TriageStatusEvent } from "../types/triage.js";
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

  // Residence-derived target (TRACKED-PREFERRED): outbox iff the append lives
  // ONLY in the outbox; tracked when it is in tracked (or both) or in neither.
  const inOutbox = appendIdsInFile(outboxPath).has(args.triageId);
  const inTracked = appendIdsInFile(trackedPath).has(args.triageId);
  const toOutbox = inOutbox && !inTracked;
  const targetPath = toOutbox ? outboxPath : trackedPath;

  // Ensure the parent directory exists (first-write case on an adopted
  // project that's never had a triage event before). Directory creation
  // is itself a write and is also caller-lock-protected.
  const parent = path.dirname(targetPath);
  try {
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
    if (!toOutbox && !existsSync(targetPath)) {
      // Tracked store only — bootstrap the schema header so producers +
      // downstream readers see a complete file. The outbox is a headerless
      // transient buffer and is NEVER given a header.
      const header = JSON.stringify({
        v: 1,
        schema: "triage",
        created: ts,
      });
      writeFileSync(targetPath, header + "\n");
    }
    appendFileSync(targetPath, line);
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

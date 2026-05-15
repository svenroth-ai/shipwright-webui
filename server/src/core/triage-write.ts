/*
 * triage-write.ts — append-only write surface for `triage.jsonl`.
 *
 * Cross-process lock note (Iterate 2026-05-14, ADR-101):
 *   Python producers use msvcrt/fcntl byte-locks via `_FileLock` (sidecar
 *   `<file>.lock`). Webui uses `proper-lockfile` (directory-based `.lock`).
 *   The two primitives DON'T compose. Mitigation: append-mode small writes
 *   are line-atomic at OS level (POSIX up to PIPE_BUF; Windows for sub-page
 *   buffered writes), and the only Python tool that writes status events
 *   for arbitrary ids is the manual `triage_promote.py` CLI. Last-status-
 *   wins resolution (file order) means the latest write reflects operator
 *   intent regardless of which path won the race.
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
import { invalidateCacheForPath } from "./triage-store.js";

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

  // Ensure the parent directory exists (first-write case on an adopted
  // project that's never had a triage event before). Directory creation
  // is itself a write and is also caller-lock-protected.
  const parent = path.dirname(args.jsonlPath);
  try {
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
    if (!existsSync(args.jsonlPath)) {
      // Bootstrap the schema header so producers + downstream readers
      // see a complete file.
      const header = JSON.stringify({
        v: 1,
        schema: "triage",
        created: ts,
      });
      writeFileSync(args.jsonlPath, header + "\n");
    }
    appendFileSync(args.jsonlPath, line);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new TriageWriteError(
        "triage_file_disappeared",
        `triage.jsonl disappeared mid-write at ${args.jsonlPath}`,
      );
    }
    throw new TriageWriteError(
      "triage_write_failed",
      `triage.jsonl write failed: ${String(err).slice(0, 200)}`,
    );
  }

  // Drop the read cache so the very next GET sees the new event.
  invalidateCacheForPath(args.jsonlPath);
}

function nowIsoZ(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/*
 * triage-raw.ts — raw JSONL line reading for the triage store. Split out of
 * triage-store.ts (iterate-2026-08-05-triage-deferred-envelope) purely to
 * keep that file under its bloat-baseline ceiling; no behavior changed by
 * the move.
 *
 * Tolerance contract (matches Python `_iter_raw_lines_at`):
 *   - RECOVERS concatenated records — a line holding several records (an
 *     unterminated predecessor) yields ALL of them, not none.
 *   - undecodable text goes to the optional `onCorrupt` side channel — never
 *     thrown, never logged here (reporting belongs at the command boundary)
 *   - skips non-object lines + lines without an "event" key (header)
 */

import { readFileSync } from "node:fs";

import { type CorruptFragment, parseJsonlRecords } from "./jsonl-records.js";
import { outboxPathFor } from "./triage-paths.js";

/**
 * Tolerant string→objects parser — splits a raw JSONL blob into plain objects,
 * RECOVERING concatenated records and skipping blank lines. Boundary rules
 * live in `jsonl-records.ts`.
 *
 * `onCorrupt` is the optional side channel for undecodable text. The array
 * return type is load-bearing: it flows through `readRawLines` to five call
 * sites, one (`appendIdsInFile`) on the WRITE hot path driving residence
 * routing — a shape change here would alter WRITES, not just reads.
 *
 * Exported so the delivered-origin composer (`triage-origin.ts`) can parse a
 * `git show origin/…:…` blob through the SAME contract as on-disk reads.
 */
export function parseRawLines(
  raw: string,
  onCorrupt?: (fragment: CorruptFragment) => void,
): Record<string, unknown>[] {
  const { records, corrupt } = parseJsonlRecords(raw);
  if (onCorrupt) for (const fragment of corrupt) onCorrupt(fragment);
  return records;
}

/**
 * Tolerant per-file reader — parses one JSONL file into plain objects.
 * Returns [] when the file is missing/unreadable.
 */
export function readRawLines(
  p: string,
  onCorrupt?: (fragment: CorruptFragment) => void,
): Record<string, unknown>[] {
  let raw: string;
  try {
    raw = readFileSync(p, "utf-8");
  } catch {
    return [];
  }
  return parseRawLines(raw, onCorrupt);
}

/**
 * Raw JSONL lines for the LOCAL union, kept SPLIT as `{ tracked, outbox }`
 * (each in file order). `readAllItems` resolves the concatenation
 * `[...tracked, ...outbox]`; the delivered-origin composer instead splices the
 * origin source between them (`[...tracked, ...origin, ...outbox]`) so the
 * outbox stays LAST — preserving the existing "freshest local intent wins an
 * equal-ts tie" file-order contract.
 */
export function readLocalRawLinesSplit(
  trackedPath: string,
  onCorrupt?: (fragment: CorruptFragment, source: "tracked" | "outbox") => void,
): {
  tracked: Record<string, unknown>[];
  outbox: Record<string, unknown>[];
} {
  const outboxPath = outboxPathFor(trackedPath);
  return {
    tracked: readRawLines(trackedPath, onCorrupt && ((f) => onCorrupt(f, "tracked"))),
    outbox: readRawLines(outboxPath, onCorrupt && ((f) => onCorrupt(f, "outbox"))),
  };
}

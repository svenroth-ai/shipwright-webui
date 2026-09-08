/*
 * event-test-counts-fixtures.ts — the effective-event-log reader shared by
 * `event-test-counts-executed.test.ts` (the D4 ratchet). Split out purely
 * to stay inside the 300-line source guideline — see that file's header for
 * the full D4 history and convention-epoch rationale; this module owns only
 * the I/O + amendment-overlay mechanics, no assertions.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseJsonlRecords } from "../core/jsonl-records.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../");
const eventsPath = path.join(repoRoot, "shipwright_events.jsonl");

/**
 * The convention starts with the run that introduced it. Events at or after
 * this instant must satisfy the invariant; earlier ones are out of scope (see
 * `event-test-counts-executed.test.ts`'s header). Anchored to the amendment
 * batch that corrected the seven.
 *
 * Compared as an INSTANT, not lexically: 70 records in this log carry `+02:00`
 * rather than `Z`, so string ordering and chronological ordering are not the
 * same relation. (No record currently sorts differently either way, but the
 * assumption has already been false once in this file's history.)
 */
export const CONVENTION_EPOCH_MS = Date.parse("2026-07-21T00:00:00Z");

export interface TestsBlock {
  passed?: unknown;
  total?: unknown;
  skipped?: unknown;
}

export interface EventRecord {
  id?: unknown;
  ts?: unknown;
  type?: unknown;
  adr_id?: unknown;
  amends?: unknown;
  fields?: Record<string, unknown>;
  tests?: unknown;
}

/**
 * Effective events: `event_amended` rows overlay their target, as every
 * compliance consumer sees them (shared `events_amend.apply_amendments`).
 *
 * LAST AMENDMENT WINS PER TARGET — deliberately, and it mirrors the shared
 * implementation exactly (`amendments[amends] = fields` replaces, it does not
 * deep-merge). DO NOT "fix" this into a cumulative merge: that would make this
 * guard read a different effective log than the audit does. The convention is
 * that a second amendment RESTATES everything it wants to keep — the
 * 2026-06-29 amendment of `evt-2646f4da` re-lists `FR-01.01` alongside the
 * `FR-01.42` it adds, precisely because the earlier overlay is discarded.
 */
export function effectiveEvents(): EventRecord[] {
  // Read the log the way the audit does — via the tolerant record reader, NOT a
  // per-line `JSON.parse`. `merge=union` on an append-only log can put two
  // records on one physical line (the whole reason `jsonl-records.ts` exists),
  // and a plain parse drops BOTH, which would make an offending record
  // invisible to this guard while the audit still judged it.
  const rows = parseJsonlRecords(fs.readFileSync(eventsPath, "utf-8"))
    .records as EventRecord[];
  const amendments = new Map<unknown, Record<string, unknown>>();
  for (const row of rows) {
    if (row.type === "event_amended") amendments.set(row.amends, row.fields ?? {});
  }
  return rows
    .filter((row) => row.type !== "event_amended")
    .map((row) => (amendments.has(row.id) ? { ...row, ...amendments.get(row.id) } : row));
}

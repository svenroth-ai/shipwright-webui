/*
 * event-log-assemble.ts — the ONE assembling event-log contract, pure (no I/O).
 *
 * TypeScript twin of the Shipwright reader `shared/scripts/lib/events_read.py`
 * (campaign `events-drop-files`, issue 978, units S1 + S5b). The plugin is moving
 * from one shared `shipwright_events.jsonl` to one file per run under
 * `shipwright_events.d/`, folded later into `shipwright_events.archive/`. Every
 * WebUI reader goes through this module so they cannot disagree:
 *
 *   1. the legacy file in FILE order (its raw lines, untouched), then
 *   2. archive + drop records merged and sorted by (parsed instant, id); ties keep
 *      the source order the caller passes (archive files, then drops, each by name).
 *
 * `lines` is that log as JSONL lines (parity with Python `event_lines_at`):
 * legacy lines verbatim, then each extra record re-serialized, then each corrupt
 * fragment of an extra file as its own raw line (so the existing line counters
 * still count it; it never decodes). `effectiveLines` additionally applies the
 * `event_amended` records that live in archive/drop files (the drops-layout form
 * of attach-commit) — legacy-file amendments are NOT overlaid, so a tree without
 * the folders reads exactly as before. `quarantine/` is never a source.
 *
 * Duplicate rule (extra files only, the legacy file is never deduplicated): same
 * id + same content (the stamped `run` field is not content) collapses; same id +
 * different content keeps both and lists the id in `duplicateIds`.
 */

import { splitRecords } from "./jsonl-records.js";

export const EVENT_FILE = "shipwright_events.jsonl";
export const DROPS_DIR = "shipwright_events.d";
export const ARCHIVE_DIR = "shipwright_events.archive";

export type EventFileKind = "legacy" | "archive" | "drop";
export type EventFileStatusCode = "ok" | "corrupt" | "empty" | "unreadable";

/** What reading ONE event file found (Python `FileStatus`). */
export interface EventFileStatus {
  /** Project-root-relative POSIX path — never an absolute path. */
  path: string;
  kind: EventFileKind;
  /** The run key of a drop (`<key>--<wt8>--<nonce8>.jsonl`); null otherwise. */
  key: string | null;
  status: EventFileStatusCode;
  records: number;
  fragments: number;
}

/** One file handed to the assembler; `text: null` = it could not be read. */
export interface EventSource {
  path: string;
  kind: EventFileKind;
  text: string | null;
}

export interface AssembledEventLog {
  lines: string[];
  effectiveLines: string[];
  files: EventFileStatus[];
  duplicateIds: string[];
  /** True when at least one archive or drop file was a source. */
  hasExtraFiles: boolean;
}

const DROP_NAME = /^(.+)--[0-9a-f]{8}--[0-9a-f]{8}\.jsonl$/;
const KEY_MAX = 80;

/** The run key a drop file name carries, or null when it is not the writer's shape. */
export function dropKey(fileName: string): string | null {
  const m = DROP_NAME.exec(fileName);
  return m ? m[1]! : null;
}

/** Python `sanitize_key`: `[A-Za-z0-9._-]`, leading dots stripped, 1..80, never empty. */
export function sanitizeKey(raw: string): string {
  const key = raw.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^\.+/, "") || "_run";
  return key.slice(0, KEY_MAX);
}

/** Non-ok files that may hold `runId`'s events (kill criterion 8: no absence verdict while one exists): a drop
 *  of its key or an odd name; ANY non-ok archive file (a folded run lives only there — fail-closed, Python: drops only). */
export function absenceBlockers(files: EventFileStatus[], runId: string): EventFileStatus[] {
  const key = sanitizeKey(runId);
  return files.filter((f) => f.status !== "ok" &&
    ((f.kind === "drop" && (f.key === null || f.key === key)) || f.kind === "archive"));
}

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * Parsed UTC instant as `[epochMs, subMillisecond]`; unparseable sorts first.
 *
 * Hand-parsed rather than `Date.parse`: a NAIVE ISO time is UTC in the event-log
 * convention (Python reads it so) but LOCAL time to `Date.parse`, and Python keeps
 * microseconds, which a millisecond epoch would collapse into false ties.
 */
export function instantKey(ts: unknown): [number, number] {
  if (typeof ts !== "string") return [-Infinity, 0];
  const m = ISO.exec(ts.trim());
  if (!m) return [-Infinity, 0];
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "", tz] = m;
  const [Y, M, D, H, MI, S] = [y, mo, d, h, mi, s].map(Number) as [number, number, number, number, number, number];
  // Python `fromisoformat` rejects an impossible date/time, so it must not sort as a real instant here.
  const dt = new Date(Date.UTC(2000, M - 1, D, H, MI, S));
  dt.setUTCFullYear(Y); // Date.UTC maps a year below 100 to 19xx
  if (Y < 1 || H > 23 || MI > 59 || S > 59 || dt.getUTCFullYear() !== Y || dt.getUTCMonth() !== M - 1 || dt.getUTCDate() !== D) {
    return [-Infinity, 0];
  }
  const base = dt.getTime();
  let offsetMs = 0;
  if (tz && tz.toUpperCase() !== "Z") {
    const sign = tz.startsWith("-") ? -1 : 1;
    const digits = tz.slice(1).replace(":", "");
    const [oh, om] = [Number(digits.slice(0, 2)), Number(digits.slice(2, 4) || "0")];
    if (oh > 23 || om > 59) return [-Infinity, 0];
    offsetMs = sign * (oh * 60 + om) * 60_000;
  }
  const fraction = `${frac}000000`.slice(0, 9);
  return [base - offsetMs + Number(fraction.slice(0, 3)), Number(fraction.slice(3))];
}

/** Python `str(e.get("id", ""))` for the sort tiebreak. */
function idString(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "None";
  return typeof v === "string" ? v : String(v);
}

/** Sorted-key JSON: the content identity of an event, without the `run` stamp. */
function canonical(event: Record<string, unknown>): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
    }
    return v;
  };
  const { run: _run, ...rest } = event;
  return JSON.stringify(sortKeys(rest));
}

interface ParsedFile {
  records: Record<string, unknown>[];
  fragments: string[];
}

function parseText(text: string): ParsedFile {
  const records: Record<string, unknown>[] = [];
  const fragments: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const split = splitRecords(line);
    records.push(...split.records);
    if (split.remainder) fragments.push(split.remainder);
  }
  return { records, fragments };
}

function statusOf(parsed: ParsedFile, kind: EventFileKind): EventFileStatusCode {
  if (parsed.fragments.length > 0) return "corrupt";
  // Zero records is legitimate for the legacy log (e.g. after a full fold), not for a drop.
  return parsed.records.length > 0 || kind === "legacy" ? "ok" : "empty";
}

function dedupExtra(extra: Record<string, unknown>[]): { kept: Record<string, unknown>[]; flagged: string[] } {
  const seen = new Map<string, Set<string>>();
  const kept: Record<string, unknown>[] = [];
  const flagged: string[] = [];
  for (const event of extra) {
    const id = event.id;
    if (typeof id !== "string" || !id) {
      kept.push(event);
      continue;
    }
    const body = canonical(event);
    const bodies = seen.get(id) ?? new Set<string>();
    seen.set(id, bodies);
    if (bodies.has(body)) continue; // same id, same content: the fold-race duplicate
    if (bodies.size > 0 && !flagged.includes(id)) flagged.push(id); // keep both, flag
    bodies.add(body);
    kept.push(event);
  }
  return { kept, flagged };
}

/** amends-id → overlay fields, from extra-file amendments only (last in order wins). */
function extraAmendments(extra: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const e of extra) {
    if (e.type !== "event_amended" || typeof e.amends !== "string") continue;
    const f = e.fields;
    out.set(e.amends, f && typeof f === "object" && !Array.isArray(f) ? (f as Record<string, unknown>) : {});
  }
  return out;
}

function overlaid(
  legacyLines: string[],
  extraRecords: Record<string, unknown>[],
  amendments: Map<string, Record<string, unknown>>,
): string[] {
  const apply = (r: Record<string, unknown>): Record<string, unknown> =>
    typeof r.id === "string" && amendments.has(r.id) ? { ...r, ...amendments.get(r.id) } : r;
  const targets = [...amendments.keys()];
  const out: string[] = [];
  for (const raw of legacyLines) {
    // Cheap prefilter: a line that does not even contain a target id stays as written, unparsed.
    if (!targets.some((id) => raw.includes(id))) {
      out.push(raw);
      continue;
    }
    const { records, remainder } = splitRecords(raw.trim());
    // Only a line holding a TARGET is re-serialized; every other byte stays as written.
    if (records.some((r) => typeof r.id === "string" && amendments.has(r.id))) {
      out.push(...records.map((r) => JSON.stringify(apply(r))));
      if (remainder) out.push(remainder);
    } else {
      out.push(raw);
    }
  }
  out.push(...extraRecords.map((r) => JSON.stringify(apply(r))));
  return out;
}

/** The legacy file's status row, parsed on first read of `status`/`records`/`fragments`. */
function lazyLegacyStatus(filePath: string, text: string): EventFileStatus {
  let parsed: ParsedFile | null = null;
  const get = (): ParsedFile => (parsed ??= parseText(text));
  const row = { path: filePath, kind: "legacy" as const, key: null } as EventFileStatus;
  Object.defineProperties(row, {
    status: { enumerable: true, get: () => statusOf(get(), "legacy") },
    records: { enumerable: true, get: () => get().records.length },
    fragments: { enumerable: true, get: () => get().fragments.length },
  });
  return row;
}

/**
 * Assemble `sources` (the legacy file first, then archive files, then drops, each
 * group sorted by name — the order `event-log-files.ts` lists them in).
 */
export function assembleEventLog(sources: EventSource[]): AssembledEventLog {
  const files: EventFileStatus[] = [];
  let legacyLines: string[] = [];
  const extra: { rec: Record<string, unknown>; key: [number, number, string]; pos: number }[] = [];
  const fragmentLines: string[] = [];
  let hasExtraFiles = false;

  for (const src of sources) {
    const key = src.kind === "drop" ? dropKey(src.path.split("/").pop() ?? "") : null;
    if (src.kind !== "legacy") hasExtraFiles = true;
    if (src.text === null) {
      files.push({ path: src.path, kind: src.kind, key, status: "unreadable", records: 0, fragments: 0 });
      continue;
    }
    if (src.kind === "legacy") {
      // The legacy log is never parsed here (its lines pass through raw); its status
      // row is computed only if someone reads it — every legacy-only poll skips the cost.
      files.push(lazyLegacyStatus(src.path, src.text));
      legacyLines = src.text.split("\n");
      continue;
    }
    const parsed = parseText(src.text);
    files.push({
      path: src.path,
      kind: src.kind,
      key,
      status: statusOf(parsed, src.kind),
      records: parsed.records.length,
      fragments: parsed.fragments.length,
    });
    for (const rec of parsed.records) {
      const [ms, sub] = instantKey(rec.ts);
      extra.push({ rec, key: [ms, sub, idString(rec.id)], pos: extra.length });
    }
    fragmentLines.push(...parsed.fragments);
  }

  extra.sort((a, b) => {
    for (let i = 0; i < 2; i++) {
      const x = a.key[i] as number;
      const y = b.key[i] as number;
      if (x !== y) return x < y ? -1 : 1;
    }
    if (a.key[2] !== b.key[2]) return a.key[2] < b.key[2] ? -1 : 1;
    return a.pos - b.pos;
  });
  // With extra files the per-file rows are exposed, so settle the legacy row now (one
  // parse) and drop its text; legacy-only, nobody reads it and it stays lazy.
  if (hasExtraFiles) files.forEach((f, i) => (files[i] = f.kind === "legacy" ? { ...f } : f));
  const { kept, flagged } = dedupExtra(extra.map((e) => e.rec));
  const lines = [...legacyLines, ...kept.map((r) => JSON.stringify(r)), ...fragmentLines];
  const amendments = extraAmendments(kept);
  const effectiveLines =
    amendments.size === 0 ? lines : [...overlaid(legacyLines, kept, amendments), ...fragmentLines];
  return { lines, effectiveLines, files, duplicateIds: flagged, hasExtraFiles };
}

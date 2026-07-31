/*
 * core/mission-context/review-record.ts — the per-run REVIEW RECORD reader.
 *
 * ── WHAT CHANGED ───────────────────────────────────────────────────────────
 * Slice 2 shipped Review from the two `external_*review_state.json` markers and
 * represented the internal self / code / doubt passes explicitly as unavailable,
 * because no clean source existed (see `review-state.ts` for that decision and
 * why guessing one would have been worse). The producer side has since closed
 * the gap: every iterate now writes
 *
 *     .shipwright/planning/iterate/<run_id>/reviews.json
 *
 * keyed by review type, carrying INDIVIDUAL FINDINGS, immutable once a pass has
 * answered. This module reads it. `review-state.ts` keeps the marker path
 * untouched as the fallback for the runs that predate the record.
 *
 * ── absent vs. invalid, and why it is a discriminated result ───────────────
 * Only a VERIFIED MISSING FILE may fall back to the markers. Bad JSON, a record
 * naming another run, an unknown schema version, a count that disagrees with its
 * own list — each is an integrity fault, and answering one by quietly reading
 * the weaker source would present a corrupt record as a review history. So the
 * reader returns `valid | absent | invalid` and never a bare null.
 *
 * ── validation mirrors the producer's own ──────────────────────────────────
 * The two repositories never import each other (DO-NOT #7), so this re-states
 * the producer's schema check rather than sharing it. That duplication is the
 * price of the boundary; the protection against drift is the fixture in
 * `test/fixtures/reviews-record-real.json`, copied verbatim from real producer
 * output rather than written here.
 *
 * ── forward tolerance, and exactly where it stops ──────────────────────────
 * (iterate-2026-07-31-review-record-tolerant-reader.) This reader used to pin
 * `schema_version` with `!==` and reject any `reviews` key outside its own five.
 * Because an invalid record does NOT degrade to the marker view — it renders
 * every row as a data-integrity fault — those two lines made the pinned five
 * unable to grow: a sixth pass would have reported every healthy record as
 * corrupt. So the producer parked its Stage-1 spec-compliance gate in a sibling
 * `gates` object nobody reads, and said so in its own source, naming the release
 * condition: "Promotion into REVIEW_TYPES — one line here, one there — becomes
 * safe as soon as the webui ships a reader that tolerates unknown review types."
 *
 * Both gates therefore move, and NOTHING else does:
 *   - the version is a FLOOR (`>=`), not a pin;
 *   - an unrecognised review key is mapped and rendered, not rejected.
 *
 * The version number is not what protects this reader and never was — every
 * entry, pinned or not, still goes through the same total `toRow`. A future
 * record that RESHAPED an entry is rejected on that entry's own fields no matter
 * what version it claims.
 *
 * ── where that argument STOPS (Stage-3 doubt, D1) ─────────────────────────
 * It covers reshapes and NOT additions — and additions are what the producer's
 * contract actually promises. `toRow` reads the fields it names and ignores
 * every other one, so an added field carrying the real answer (`verdict:
 * "blocked"` beside `status: "completed"`) would be dropped and the pass drawn
 * as a clean run. The `!==` pin caught that by refusing the record; nothing else
 * ever did. So forward-reading is DISCLOSED, not silent: a version past
 * `MAX_KNOWN_RECORD_SCHEMA_VERSION`, or passes recorded where this reader does
 * not look, each add a `caveat` that `buildReviewArtifact` appends to the
 * summary. That is the house rule of the whole feature (`truncated`,
 * `manifestStatus`, `parseStatus`): read what you can, say what you could not.
 *
 * ── the pinned five are FROZEN (Stage-3 doubt, D4) ────────────────────────
 * Tolerance is additive ONLY. `REVIEW_TYPES` may never shrink or be renamed —
 * the assembly below requires all five and calls the record unreadable if one is
 * absent, so renaming `external_code` blanks the whole card rather than adding a
 * row. A superseded pass keeps its key and closes with a disposition.
 */

import { statSync } from "node:fs";
import path from "node:path";

import { readBoundedFile } from "./fs-read.js";
import { toRow, unreadPassCount, unreadableStranger } from "./review-record-entry.js";
import { pathGuard, realPathGuard } from "../path-guard.js";
import { isSafeRunId } from "./pointer.js";
import type { ReviewRow } from "./types-slice2.js";

/**
 * Contract order — `self` first: it is the one review that always runs.
 *
 * `as const` rather than `ReviewType[]`: `ReviewType` now admits any string, so
 * the annotation that used to catch a typo here would no longer catch anything.
 *
 * EXPORTED because `review-state.ts` needs the same order for its marker
 * fallback. Two independently-written literals would now drift silently — with
 * the annotation gone, nothing would fail if the record path and the marker path
 * disagreed about which five passes exist.
 */
export const REVIEW_TYPES = ["self", "plan", "code", "doubt", "external_code"] as const;

/**
 * The OLDEST version this reader can read, not the only one. Anything newer is
 * additive by the producer's contract and is read; anything older never existed.
 */
const MIN_RECORD_SCHEMA_VERSION = 1;

/**
 * The newest version whose fields this reader actually KNOWS. Beyond it the
 * record is still read — that is the point — but the fact is disclosed, because
 * a field added past this line is one `toRow` drops on the floor.
 */
const MAX_KNOWN_RECORD_SCHEMA_VERSION = 1;

/** Record-level keys this reader understands; anything else may hold passes. */
const KNOWN_RECORD_KEYS = new Set(["schema_version", "run_id", "reviews"]);

/**
 * What an unrecognised review key may look like. Permissive on purpose — the
 * point of this whole change is that the producer may name a pass something this
 * reader has not heard of — but a key is still an IDENTIFIER, so `__proto__`,
 * an empty string, a path fragment and a paragraph of prose are corruption
 * rather than evolution, and are reported as such.
 */
const REVIEW_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * Aggregate bound on how many passes one record may carry (external plan review,
 * finding 3: unknown keys make a previously five-row structure unbounded). Going
 * over is an integrity fault and NOT a silent truncation: a review pass dropped
 * on the floor is precisely the invisible-review failure this artifact exists to
 * prevent, so the record says it cannot be trusted instead of quietly shrinking.
 */
const MAX_REVIEW_TYPES = 32;

/**
 * 2 MB. The marker bound (256 KB) was tuned for a few hundred bytes; a real
 * 46-finding record measures 46 KB, so that ceiling was one noisy run away from
 * turning a healthy record into a false integrity fault.
 */
const MAX_RECORD_BYTES = 2 * 1024 * 1024;

export type ReviewRecordResult =
  | { kind: "valid"; rows: ReviewRow[]; caveats: string[] }
  | { kind: "absent" }
  | { kind: "invalid"; reason: string };


/** Absolute path of the record — also probed for `sourceRev` so a late write refreshes. */
export function reviewRecordPath(projectRoot: string, runId: string): string | null {
  if (!isSafeRunId(runId)) return null;
  return path.join(projectRoot, ".shipwright", "planning", "iterate", runId, "reviews.json");
}

function invalid(reason: string): ReviewRecordResult {
  return { kind: "invalid", reason };
}

/**
 * Read + validate the run's review record.
 *
 * Validation is total on purpose: a record that passes here is one the UI may
 * render without re-checking, and `run_id` is verified against the REQUESTED run
 * because a stale or copied file sitting at a valid guarded path would otherwise
 * be presented as this run's review history.
 */
export function readReviewRecord(projectRoot: string, runId: string): ReviewRecordResult {
  if (!isSafeRunId(runId)) return invalid("run id is not safe to resolve");

  const rel = [".shipwright", "planning", "iterate", runId, "reviews.json"].join("/");
  const guard = pathGuard(projectRoot, rel);
  if (!guard.ok) return invalid("the record path could not be resolved safely");

  // ENOENT — and ONLY ENOENT — is an absence the markers may answer.
  //
  // `existsSync` cannot make that distinction: it swallows EVERY error and
  // returns false, so an unreadable record (EACCES, a broken symlink, a
  // directory where a file belongs) would report "absent" and silently hand the
  // question to the weaker source. That is the downgrade this whole reader
  // exists to prevent, so the errno is inspected instead.
  try {
    const stats = statSync(guard.absolute);
    if (!stats.isFile()) return invalid("the record path is not a file");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { kind: "absent" };
    return invalid(`the record could not be inspected (${code ?? "unknown error"})`);
  }

  // The documented pair: pathGuard is string-only, so realPathGuard is what
  // refuses a symlink pointing out of the project (DO-NOT #10).
  if (!realPathGuard(projectRoot, guard.absolute).ok) {
    return invalid("the record resolves outside the project");
  }

  const read = readBoundedFile(guard.absolute, MAX_RECORD_BYTES);
  if (!read) return invalid("the record could not be read within its size bound");

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    return invalid("the record is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalid("the record is not an object");
  }

  const record = parsed as Record<string, unknown>;
  const version = record.schema_version;
  // `>=`, not `===`. See the forward-tolerance note in the file header: an older
  // version never existed, a newer one is additive, and a reshaped entry is
  // caught by `toRow` rather than by this number.
  if (!Number.isInteger(version) || (version as number) < MIN_RECORD_SCHEMA_VERSION) {
    return invalid(
      `record schema_version ${String(version)} is not a version this reader can read`,
    );
  }
  if (record.run_id !== runId) {
    return invalid(`the record names run ${String(record.run_id)}, not ${runId}`);
  }

  const reviews = record.reviews;
  if (!reviews || typeof reviews !== "object" || Array.isArray(reviews)) {
    return invalid("the record has no reviews object");
  }
  const byType = reviews as Record<string, unknown>;

  // `Object.keys` is own-enumerable only, so nothing inherited can become a row.
  const keys = Object.keys(byType);
  if (keys.length > MAX_REVIEW_TYPES) {
    return invalid(`the record carries ${keys.length} review passes, more than any run has`);
  }
  const strangers = keys.filter((k) => !(REVIEW_TYPES as readonly string[]).includes(k));
  const malformed = strangers.filter((k) => !REVIEW_KEY.test(k));
  if (malformed.length > 0) {
    return invalid(`the record has a review key that is not an identifier: ${malformed.join(", ")}`);
  }

  // The pinned five FIRST, in contract order (AC4 of the Review artifact), then
  // the passes this reader has not heard of, in the record's own key order. A
  // stranger is appended rather than interleaved so the order the UI has always
  // rendered is exactly the order it still renders.
  //
  // The five come from REVIEW_TYPES and NOT from the record's own keys. That
  // looks like a stylistic choice and is not: iterating `keys` is shorter and
  // silently stops detecting a record MISSING a pinned pass — the check that
  // keeps a dropped or renamed pass loud instead of quietly rendering four rows
  // as if five had been considered.
  const rows: ReviewRow[] = [];
  for (const reviewType of REVIEW_TYPES) {
    // `hasOwnProperty` guards something the `Object.keys` filter above does not:
    // these lookups are by literal name, so a globally polluted
    // `Object.prototype` could otherwise hand back a shadowing value for a key
    // this record never carried.
    const entry = Object.prototype.hasOwnProperty.call(byType, reviewType)
      ? byType[reviewType]
      : undefined;
    if (entry === undefined || entry === null) {
      return invalid(`the record is missing the ${reviewType} review`);
    }
    if (typeof entry !== "object" || Array.isArray(entry)) {
      return invalid(`reviews.${reviewType} is not an object`);
    }
    const row = toRow(reviewType, entry as Record<string, unknown>);
    if (typeof row === "string") return invalid(row);
    rows.push(row);
  }

  // A stranger is own by construction (it came from `Object.keys`), so it is
  // never actually missing — and its entry failing is bounded to its own row.
  for (const reviewType of strangers) {
    const entry = byType[reviewType];
    const row = entry && typeof entry === "object" && !Array.isArray(entry)
      ? toRow(reviewType, entry as Record<string, unknown>)
      : `reviews.${reviewType} is not an object`;
    rows.push(typeof row === "string" ? unreadableStranger(reviewType) : row);
  }

  const caveats: string[] = [];
  if ((version as number) > MAX_KNOWN_RECORD_SCHEMA_VERSION) {
    caveats.push(
      "This run's review record was written by a newer Shipwright, so a pass may " +
        "carry detail this version does not know how to show.",
    );
  }
  const unread = unreadPassCount(record, KNOWN_RECORD_KEYS);
  if (unread > 0) {
    caveats.push(
      `This run also recorded ${unread} review ${unread === 1 ? "pass" : "passes"} ` +
        "somewhere this version does not read, so they are not counted above.",
    );
  }

  return { kind: "valid", rows, caveats };
}

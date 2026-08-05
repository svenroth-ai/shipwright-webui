/*
 * Forward tolerance: what this reader accepts that it does not understand
 * (iterate-2026-07-31-review-record-tolerant-reader).
 *
 * Split from `review-record.validation.test.ts` at the 300-line rule, along the
 * seam the change itself draws. That file pins where the reader is STRICT; this
 * one pins where it deliberately is not, and — more importantly — exactly how
 * far the tolerance goes before strictness resumes.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readReviewRecord } from "./review-record.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_FIXTURE = path.join(HERE, "..", "..", "test", "fixtures", "reviews-record-real.json");
const RUN_ID = "iterate-2026-07-21-review-record";

function project(record?: unknown, runId = RUN_ID): string {
  const root = mkdtempSync(path.join(tmpdir(), "review-record-t-"));
  const dir = path.join(root, ".shipwright", "planning", "iterate", runId);
  mkdirSync(dir, { recursive: true });
  if (record !== undefined) {
    writeFileSync(path.join(dir, "reviews.json"), JSON.stringify(record, null, 2), "utf8");
  }
  return root;
}

function realRecord(): Record<string, unknown> {
  return JSON.parse(readFileSync(REAL_FIXTURE, "utf8")) as Record<string, unknown>;
}

type Reviews = Record<string, Record<string, unknown>>;

/*
 * The version is a FLOOR, not a pin (iterate-2026-07-31-review-record-tolerant-reader).
 *
 * The producer froze `SCHEMA_VERSION` at 1 for one reason only: this reader
 * compared it with `!==`, so a bump would have made the only consumer stop
 * understanding a file it understands fine. Every field the producer has added
 * since is optional, and an entry that changed SHAPE is still rejected on its own
 * fields below — so the version number is not what protects us, and treating it as
 * a pin only froze the producer.
 */
describe("a newer schema version is read, not refused", () => {
  it("accepts a version NEWER than the one it was written against", () => {
    const record = realRecord();
    record.schema_version = 2;
    expect(readReviewRecord(project(record), RUN_ID).kind).toBe("valid");
  });

  it("still rejects a version OLDER than any that ever existed", () => {
    const record = realRecord();
    record.schema_version = 0;
    expect(readReviewRecord(project(record), RUN_ID).kind).toBe("invalid");
  });

  it.each([["1" as unknown], [true], [1.5], [null], [undefined]])(
    "still rejects a version that is not a whole number: %s",
    (version) => {
      const record = realRecord();
      record.schema_version = version;
      expect(readReviewRecord(project(record), RUN_ID).kind).toBe("invalid");
    },
  );
});

/*
 * An unrecognised pass is EVOLUTION; a malformed one is still corruption.
 *
 * The producer's Stage-1 spec-compliance gate had to be parked in a sibling
 * `gates` object this reader never inspects, because a sixth key here reported
 * every healthy record as corrupt — and an invalid record does not degrade to the
 * marker view, it renders every row as a data-integrity fault. So the tolerance is
 * at the KEY and nowhere else: the entry itself is validated exactly as strictly
 * as a pinned one.
 */
/**
 * `defineProperty`, not `reviews[type] = …`.
 *
 * Plain assignment to `__proto__` sets the PROTOTYPE instead of creating a key,
 * so that case wrote nothing at all and the record it produced was an ordinary
 * five-pass record — the test passed while testing nothing. `defineProperty`
 * makes an own enumerable property for every key including that one, which is
 * also exactly what `JSON.parse` does on the read side.
 */
function withUnknown(type: string, over: Record<string, unknown> = {}) {
  const record = realRecord();
  const reviews = record.reviews as Reviews;
  Object.defineProperty(reviews, type, {
    value: { ...reviews.doubt, review_type: type, ...over },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return record;
}

function rowsOf(record: unknown, runId = RUN_ID) {
  const result = readReviewRecord(project(record), runId);
  if (result.kind !== "valid") throw new Error(`expected a valid record, got ${result.kind}`);
  return result.rows;
}

describe("an unknown review type is rendered, not treated as corruption", () => {
  it("accepts the record and returns a row for the unknown pass", () => {
    const rows = rowsOf(withUnknown("spec"));
    const spec = rows.find((r) => r.reviewType === "spec");
    expect(spec, "the unknown pass must have a row of its own").toBeDefined();
    expect(spec!.status).toBe("completed");
    expect(spec!.findingsCount).toBe(7);
    expect(spec!.findings).toHaveLength(7);
  });

  it("keeps the pinned five FIRST, in contract order, and appends the strangers", () => {
    const record = withUnknown("spec");
    (record.reviews as Reviews).gut_feeling = {
      ...(record.reviews as Reviews).doubt,
      review_type: "gut_feeling",
    };
    expect(rowsOf(record).map((r) => r.reviewType)).toEqual([
      "self",
      "plan",
      "code",
      "doubt",
      "external_code",
      "spec",
      "gut_feeling",
    ]);
  });

  it("maps an unknown pass through the SAME entry rules — findings and all", () => {
    const rows = rowsOf(
      withUnknown("spec", {
        status: "completed",
        findings_count: 1,
        findings: [{ severity: "high", finding: "AC3 has no test", file: "a.ts", line: 7 }],
        disposition: null,
      }),
    );
    const spec = rows.find((r) => r.reviewType === "spec")!;
    expect(spec.findingsCount).toBe(1);
    expect(spec.findings[0]!.location).toBe("a.ts:7");
    expect(spec.source).toBe("record");
  });

  /*
   * Tolerance is per-KEY; failure used to be per-RECORD.
   *
   * One unknown word in one pass this build has never heard of replaced five
   * perfectly-parsed rows with "could not be read" (Stage-3 doubt, D5). The
   * priors differ by object: for a PINNED pass an unrecognised value really is
   * more likely corruption; for a pass we have by construction never heard of it
   * is more likely the same evolution the key tolerance exists for — and the
   * costs are asymmetric. So a stranger degrades to ITS OWN unreadable row and
   * the pinned five survive. Degraded, never dropped: the row is present and
   * says it cannot be read.
   */
  it.each([
    ["a count that disagrees with its list", { findings_count: 4 }],
    ["a status outside the vocabulary", { status: "vibes" }],
    ["a terminal status with no reason", { status: "not_run", disposition: "  " }],
    ["a parse_status outside the vocabulary", { parse_status: "skimmed" }],
    ["a key disagreeing with its own review_type", { review_type: "code" }],
    [
      "an unstructured parse that somehow itemized findings",
      { parse_status: "unstructured" },
    ],
  ])("degrades — never drops, never blanks the record — an unknown pass with %s", (_label, over) => {
    const rows = rowsOf(withUnknown("spec", over));
    expect(rows).toHaveLength(6);
    // The pinned five are untouched by a stranger's problem.
    expect(rows.slice(0, 5).map((r) => r.status)).toEqual(Array(5).fill("completed"));
    const spec = rows[5]!;
    expect(spec.reviewType).toBe("spec");
    expect(spec.status).toBe("unavailable");
    expect(spec.findingsCount).toBeNull();
    expect(spec.note).toMatch(/cannot read/i);
  });

  it("keeps a PINNED pass strict — its failure is still the whole record", () => {
    const record = withUnknown("spec");
    (record.reviews as Reviews).code.status = "vibes";
    expect(readReviewRecord(project(record), RUN_ID).kind).toBe("invalid");
  });

  it.each([[""], ["9lives"], ["has space"], ["a".repeat(65)], ["../escape"], ["__proto__"]])(
    "refuses a review key that is not a plain identifier: %s",
    (key) => {
      expect(readReviewRecord(project(withUnknown(key)), RUN_ID).kind).toBe("invalid");
    },
  );

  // The rejecting side alone would let the bound drift: `{0,63}` could become
  // `{0,62}` and every case above would still pass. `constructor` is here for a
  // different reason — it is a perfectly valid identifier that also names an
  // `Object.prototype` member, and it must yield one ordinary row rather than
  // anything reflective.
  it.each([["a"], ["a".repeat(64)], ["constructor"], ["v2-GATE_x"]])(
    "accepts a review key that IS a plain identifier: %s",
    (key) => {
      const rows = rowsOf(withUnknown(key));
      expect(rows).toHaveLength(6);
      expect(rows[5]!.reviewType).toBe(key);
    },
  );

  it("still refuses a record that is MISSING a pinned type — the five may not shrink", () => {
    const record = withUnknown("spec");
    delete (record.reviews as Reviews).doubt;
    expect(readReviewRecord(project(record), RUN_ID).kind).toBe("invalid");
  });

  it("is still bounded, and says so rather than dropping passes", () => {
    // Unknown keys turned a five-row structure into an open one. The bound is a
    // stated fault, NOT a silent truncation: a review pass quietly dropped is the
    // invisible-review failure the whole artifact exists to prevent.
    const fill = (n: number) => {
      const record = realRecord();
      const reviews = record.reviews as Reviews;
      for (let i = 0; i < n; i += 1) {
        reviews[`extra${i}`] = { ...reviews.doubt, review_type: `extra${i}` };
      }
      return record;
    };
    expect(rowsOf(fill(27))).toHaveLength(32);
    expect(readReviewRecord(project(fill(28)), RUN_ID).kind).toBe("invalid");
  });

  it("accepts a NEWER version only while its PINNED entries still hold up", () => {
    // The compatibility boundary, stated as a test: a version number buys a
    // record nothing. Asserted on a PINNED entry, because a stranger's failure
    // is deliberately bounded to its own row — so a stranger could not show
    // that a newer version fails to launder a malformed entry.
    const ok = withUnknown("spec");
    ok.schema_version = 2;
    expect(readReviewRecord(project(ok), RUN_ID).kind).toBe("valid");

    const reshaped = withUnknown("spec");
    reshaped.schema_version = 2;
    (reshaped.reviews as Reviews).code.status = "vibes";
    expect(readReviewRecord(project(reshaped), RUN_ID).kind).toBe("invalid");
  });

  it("says so when it has read PAST what it understands", () => {
    // Forward-reading is disclosed, not silent: `toRow` ignores fields it does
    // not name, so a v2 entry carrying the real answer in a new field would be
    // drawn as a clean run. The caveat is the only thing standing between that
    // and a false assurance (Stage-3 doubt, D1).
    const current = withUnknown("spec");
    const now = readReviewRecord(project(current), RUN_ID);
    expect(now.kind === "valid" && now.caveats).toEqual([]);

    const future = withUnknown("spec");
    future.schema_version = 2;
    const later = readReviewRecord(project(future), RUN_ID);
    expect(later.kind === "valid" && later.caveats.join(" ")).toMatch(/newer Shipwright/);
  });

  it("says so when passes are recorded somewhere it does not read", () => {
    // Not hypothetical — this is the producer's live `gates` sibling, which no
    // webui code has ever looked at (Stage-3 doubt, D2). Detected by SHAPE, so
    // the NEXT sibling is disclosed too.
    const record = realRecord();
    record.gates = {
      spec: { review_type: "spec", status: "completed", findings_count: 5, findings: [] },
    };
    const result = readReviewRecord(project(record), RUN_ID);
    expect(result.kind).toBe("valid");
    expect(result.kind === "valid" && result.caveats.join(" ")).toMatch(
      /also recorded 1 review pass somewhere this version does not read/,
    );
  });
});

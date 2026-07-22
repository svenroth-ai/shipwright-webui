/*
 * Strict validation for the per-run review record: absent vs. invalid.
 *
 * Split from `review-record.test.ts` (which covers mapping) to stay inside the
 * 300-line rule. The distinction under test is the load-bearing one: **only a
 * verified missing file may fall back to the legacy markers.** Every other
 * failure — bad JSON, wrong run, wrong schema, a count that disagrees with its
 * own list — is an integrity fault, because falling back would quietly answer a
 * corrupt record with the weaker source and call it a review history.
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
  const root = mkdtempSync(path.join(tmpdir(), "review-record-v-"));
  const dir = path.join(root, ".shipwright", "planning", "iterate", runId);
  mkdirSync(dir, { recursive: true });
  if (record !== undefined) {
    writeFileSync(
      path.join(dir, "reviews.json"),
      typeof record === "string" ? record : JSON.stringify(record, null, 2),
      "utf8",
    );
  }
  return root;
}

function realRecord(): Record<string, unknown> {
  return JSON.parse(readFileSync(REAL_FIXTURE, "utf8")) as Record<string, unknown>;
}

type Reviews = Record<string, Record<string, unknown>>;

describe("absent means ENOENT and nothing else", () => {
  it("reports absent when there is no record, so the markers can answer", () => {
    expect(readReviewRecord(project(), RUN_ID).kind).toBe("absent");
  });

  it("reports invalid — never absent — for unparseable JSON", () => {
    expect(readReviewRecord(project("{not json"), RUN_ID).kind).toBe("invalid");
  });

  it("reports invalid for a JSON document that is not an object", () => {
    expect(readReviewRecord(project("[1,2,3]"), RUN_ID).kind).toBe("invalid");
  });
});

describe("a record must vouch for THIS run", () => {
  it("rejects one whose run_id names a different run", () => {
    // Written under the requested run's own directory: a stale or copied file
    // at a valid, path-guarded location must not be read as this run's history.
    const record = realRecord();
    record.run_id = "iterate-2026-01-01-somewhere-else";
    expect(readReviewRecord(project(record), RUN_ID).kind).toBe("invalid");
  });

  it("rejects a schema version it does not understand", () => {
    const record = realRecord();
    record.schema_version = 2;
    expect(readReviewRecord(project(record), RUN_ID).kind).toBe("invalid");
  });

  it("refuses an unsafe run id rather than walking the path", () => {
    expect(readReviewRecord(project(), "../../escape").kind).toBe("invalid");
  });
});

describe("the shape must be complete and self-consistent", () => {
  it("rejects a record missing a review type", () => {
    const record = realRecord();
    delete (record.reviews as Reviews).doubt;
    expect(readReviewRecord(project(record), RUN_ID).kind).toBe("invalid");
  });

  it("rejects an unknown review type", () => {
    const record = realRecord();
    (record.reviews as Reviews).gut_feeling = { ...(record.reviews as Reviews).code };
    expect(readReviewRecord(project(record), RUN_ID).kind).toBe("invalid");
  });

  it("rejects a key that disagrees with its own review_type", () => {
    const record = realRecord();
    (record.reviews as Reviews).code.review_type = "doubt";
    expect(readReviewRecord(project(record), RUN_ID).kind).toBe("invalid");
  });

  it("rejects a count that disagrees with its own list", () => {
    const record = realRecord();
    (record.reviews as Reviews).code.findings_count = 99;
    expect(readReviewRecord(project(record), RUN_ID).kind).toBe("invalid");
  });

  it("rejects a status outside the closed vocabulary", () => {
    const record = realRecord();
    (record.reviews as Reviews).code.status = "probably_fine";
    expect(readReviewRecord(project(record), RUN_ID).kind).toBe("invalid");
  });

  it("rejects findings that are not a list", () => {
    const record = realRecord();
    (record.reviews as Reviews).code.findings = "eleven";
    expect(readReviewRecord(project(record), RUN_ID).kind).toBe("invalid");
  });

  it("rejects a finding with no text — there is nothing to show", () => {
    const record = realRecord();
    (record.reviews as Reviews).self.findings = [{ severity: "high", finding: "  " }];
    (record.reviews as Reviews).self.findings_count = 1;
    expect(readReviewRecord(project(record), RUN_ID).kind).toBe("invalid");
  });
});

/*
 * Source precedence: the per-run record wins, the markers are the fallback.
 *
 * The three cases that matter, and why each is a separate fact:
 *
 *   record valid    → use it, and IGNORE the markers even when both exist.
 *   record absent   → today's marker behaviour, byte-for-byte. 64 existing runs
 *                     in this repo predate the record and must not regress.
 *   record invalid  → an integrity fault. It must NOT fall back: answering a
 *                     corrupt record with the weaker source would present a data
 *                     problem as a review history, which is the one thing this
 *                     artifact must never do.
 *
 * @covers FR-01.66
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readReviewState } from "./review-state.js";
import { buildReviewArtifact } from "./artifacts-slice2.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_FIXTURE = path.join(HERE, "..", "..", "test", "fixtures", "reviews-record-real.json");
const RUN_ID = "iterate-2026-07-21-review-record";

/** The real marker shape, as measured on this repo before the record existed. */
const MARKER = JSON.stringify({
  status: "completed",
  timestamp: "2026-07-19T10:00:00+00:00",
  provider: "openrouter",
  findings_count: 8,
  self_review_fallback_ran: false,
  reason: null,
  review_mode: "iterate",
});

function project(opts: { record?: string; markers?: boolean }): string {
  const root = mkdtempSync(path.join(tmpdir(), "mc-precedence-"));
  const dir = path.join(root, ".shipwright", "planning", "iterate", RUN_ID);
  mkdirSync(dir, { recursive: true });
  if (opts.record !== undefined) writeFileSync(path.join(dir, "reviews.json"), opts.record, "utf8");
  if (opts.markers) {
    writeFileSync(path.join(dir, "external_review_state.json"), MARKER, "utf8");
    writeFileSync(path.join(dir, "external_code_review_state.json"), MARKER, "utf8");
  }
  return root;
}

const realRecord = () => readFileSync(REAL_FIXTURE, "utf8");

function withProject(opts: { record?: string; markers?: boolean }, fn: (root: string) => void) {
  const root = project(opts);
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("the record wins when it is valid", () => {
  it("uses the record even when both markers are also present", () => {
    withProject({ record: realRecord(), markers: true }, (root) => {
      const { rows, hasRecord, sawUnreadable } = readReviewState(root, RUN_ID);

      expect(hasRecord).toBe(true);
      expect(sawUnreadable).toBe(false);
      expect(rows.every((r) => r.source === "record")).toBe(true);
      // The marker says 8; the record says 17. The record is authoritative.
      expect(rows.find((r) => r.reviewType === "plan")!.findingsCount).toBe(17);
    });
  });

  it("gives the internal passes real results instead of the known-gap note", () => {
    withProject({ record: realRecord() }, (root) => {
      const { rows } = readReviewState(root, RUN_ID);
      for (const type of ["self", "code", "doubt"] as const) {
        const row = rows.find((r) => r.reviewType === type)!;
        expect(row.status).toBe("completed");
        expect(row.findings.length).toBeGreaterThan(0);
        expect(row.note).toBeNull();
      }
    });
  });
});

describe("no record — the pre-record behaviour, unchanged", () => {
  it("falls back to the markers and keeps the internal passes unavailable", () => {
    withProject({ markers: true }, (root) => {
      const { rows, hasRecord } = readReviewState(root, RUN_ID);

      expect(hasRecord).toBe(true);
      expect(rows.every((r) => r.source === "marker")).toBe(true);
      expect(rows.find((r) => r.reviewType === "plan")!.findingsCount).toBe(8);
      for (const type of ["self", "code", "doubt"] as const) {
        const row = rows.find((r) => r.reviewType === type)!;
        expect(row.status).toBe("unavailable");
        expect(row.note).toContain("known gap");
      }
    });
  });

  it("still reports an empty run as nothing-to-show, not as a fault", () => {
    withProject({}, (root) => {
      const lookup = readReviewState(root, RUN_ID);
      expect(lookup.hasRecord).toBe(false);
      expect(lookup.sawUnreadable).toBe(false);
      expect(buildReviewArtifact(lookup).state).toBe("not_yet_created");
    });
  });
});

describe("a corrupt record is a fault, never a quiet downgrade", () => {
  it("does NOT fall back to the markers when the record is unreadable", () => {
    withProject({ record: "{not json", markers: true }, (root) => {
      const { rows, hasRecord, sawUnreadable } = readReviewState(root, RUN_ID);

      expect(sawUnreadable).toBe(true);
      expect(hasRecord).toBe(false);
      // The markers would have said "8 findings, completed". They must not be
      // used to paper over a corrupt record.
      expect(rows.every((r) => r.status === "unavailable")).toBe(true);
      expect(rows.every((r) => r.findingsCount === null)).toBe(true);
    });
  });

  it("shows the artifact rather than hiding it, so the fault is visible", () => {
    withProject({ record: "{not json" }, (root) => {
      const artifact = buildReviewArtifact(readReviewState(root, RUN_ID));
      // `not_yet_created` would HIDE it under hide-empty — the fault would vanish.
      expect(artifact.state).toBe("unavailable");
    });
  });

  it("treats a record naming a different run as a fault, not as this run's history", () => {
    const foreign = JSON.parse(realRecord()) as Record<string, unknown>;
    foreign.run_id = "iterate-2026-01-01-somewhere-else";
    withProject({ record: JSON.stringify(foreign), markers: true }, (root) => {
      const { sawUnreadable, rows } = readReviewState(root, RUN_ID);
      expect(sawUnreadable).toBe(true);
      expect(rows.every((r) => r.findingsCount === null)).toBe(true);
    });
  });
});

// --- regressions from the code-review round --------------------------------

describe("a freshly materialized record is not a review history", () => {
  it("keeps the artifact 'not yet created' when every type is still pending", () => {
    // The producer materializes all five as `pending` at the start of a run.
    // Reporting that as a record made the panel say "No review was recorded as
    // having run" mid-run — worse than the honest "not written yet".
    const record = JSON.parse(realRecord()) as Record<string, unknown>;
    const reviews = record.reviews as Record<string, Record<string, unknown>>;
    for (const key of Object.keys(reviews)) {
      reviews[key] = {
        ...reviews[key],
        status: "pending",
        findings: [],
        findings_count: 0,
        parse_status: null,
      };
    }
    withProject({ record: JSON.stringify(record) }, (root) => {
      const lookup = readReviewState(root, RUN_ID);
      expect(lookup.hasRecord).toBe(false);
      expect(buildReviewArtifact(lookup).state).toBe("not_yet_created");
    });
  });
});

describe("the artifact summary is held to the same honesty as the rows", () => {
  it("never says 'raised no issues' for a review that could not be itemized", () => {
    const record = JSON.parse(realRecord()) as Record<string, unknown>;
    const reviews = record.reviews as Record<string, Record<string, unknown>>;
    for (const key of Object.keys(reviews)) {
      reviews[key] =
        key === "plan"
          ? {
              ...reviews[key],
              status: "completed",
              findings: [],
              findings_count: 0,
              parse_status: "unstructured",
            }
          : {
              ...reviews[key],
              status: "not_run",
              findings: [],
              findings_count: 0,
              parse_status: null,
              disposition: "did not apply at this complexity per the phase matrix",
            };
    }
    withProject({ record: JSON.stringify(record) }, (root) => {
      const summary = buildReviewArtifact(readReviewState(root, RUN_ID)).summary ?? "";
      // The summary is the FIRST line a reader sees, above the row-level caveat.
      expect(summary).not.toMatch(/no issues/i);
      expect(summary).not.toMatch(/\b0 issues\b/i);
    });
  });
});

describe("an unsafe run id is identified as such, not as a corrupt record", () => {
  it("does not claim a record exists for a run it never probed", () => {
    withProject({}, (root) => {
      const { rows, sawUnreadable } = readReviewState(root, "../../escape");
      expect(sawUnreadable).toBe(true);
      expect(rows).toHaveLength(5);
      expect(rows[0].note).toContain("could not be identified");
      for (const row of rows) expect(row.note).not.toMatch(/exists but could not be read/);
    });
  });
});

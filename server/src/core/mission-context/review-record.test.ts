/*
 * Tests for the per-run review-record reader.
 *
 * The producer lives in ANOTHER repository (shipwright monorepo
 * `shared/scripts/lib/review_record*.py`), and the two never import each other
 * (DO-NOT #7). So the load-bearing test here is the one driven by
 * `fixtures/reviews-record-real.json` — a record the producer tool ACTUALLY
 * wrote, copied verbatim. A hand-written fixture would only prove this reader
 * agrees with my belief about the producer.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readReviewRecord } from "./review-record.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Copied byte-for-byte from the record the monorepo tool produced for its own
 * run, at producer commit 84a246cb0b46a0ac20e8bb3beae3ca4ed3105f94
 * (`iterate-2026-07-21-review-record`, monorepo PR #428). If the producer's
 * shape moves, RE-COPY this file — do not hand-edit it.
 */
const REAL_FIXTURE = path.join(HERE, "..", "..", "test", "fixtures", "reviews-record-real.json");

const RUN_ID = "iterate-2026-07-21-review-record";

function project(record?: unknown, runId = RUN_ID): string {
  const root = mkdtempSync(path.join(tmpdir(), "review-record-"));
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

// --- the real producer output (AC1, AC2) -----------------------------------

describe("a record the producer actually wrote", () => {
  it("maps all five types in contract order, self first", () => {
    const result = readReviewRecord(project(realRecord()), RUN_ID);

    expect(result.kind).toBe("valid");
    if (result.kind !== "valid") return;
    expect(result.rows.map((r) => r.reviewType)).toEqual([
      "self",
      "plan",
      "code",
      "doubt",
      "external_code",
    ]);
  });

  it("carries the real finding counts, not a placeholder", () => {
    const result = readReviewRecord(project(realRecord()), RUN_ID);
    if (result.kind !== "valid") throw new Error("expected valid");

    const byType = Object.fromEntries(result.rows.map((r) => [r.reviewType, r]));
    expect(byType.self.findingsCount).toBe(1);
    expect(byType.plan.findingsCount).toBe(17);
    expect(byType.code.findingsCount).toBe(11);
    expect(byType.doubt.findingsCount).toBe(7);
    expect(byType.external_code.findingsCount).toBe(10);
  });

  it("materializes per-finding detail, which the marker never had", () => {
    const result = readReviewRecord(project(realRecord()), RUN_ID);
    if (result.kind !== "valid") throw new Error("expected valid");

    const code = result.rows.find((r) => r.reviewType === "code")!;
    expect(code.findings).toHaveLength(11);
    expect(code.findings.every((f) => f.title.trim().length > 0)).toBe(true);
    // A finding with file+line becomes a single pre-joined location, so the
    // client does no formatting.
    expect(code.findings.some((f) => f.location?.includes(":"))).toBe(true);
    expect(code.findings.some((f) => f.severity === "medium")).toBe(true);
  });

  it("reports every row as record-sourced", () => {
    const result = readReviewRecord(project(realRecord()), RUN_ID);
    if (result.kind !== "valid") throw new Error("expected valid");
    expect(result.rows.every((r) => r.source === "record")).toBe(true);
  });

  it("is comfortably inside the bounded read", () => {
    // 46 KB measured. The marker bound (256 KB) was tuned for a few hundred
    // bytes and is one noisy run from a false integrity fault.
    expect(readFileSync(REAL_FIXTURE).byteLength).toBeLessThan(2 * 1024 * 1024);
  });
});

// --- statuses and dispositions (AC3, AC4, AC8) -----------------------------

function withReview(overrides: Record<string, unknown>): Record<string, unknown> {
  const base = (type: string) => ({
    review_type: type,
    status: "completed",
    findings_count: 0,
    findings: [],
    provider: null,
    completed_at: null,
    disposition: null,
    recorded_by: null,
    parse_status: null,
    raw_excerpt: null,
  });
  return {
    schema_version: 1,
    run_id: RUN_ID,
    reviews: {
      self: base("self"),
      plan: base("plan"),
      code: base("code"),
      doubt: base("doubt"),
      external_code: base("external_code"),
      ...overrides,
    },
  };
}

describe("statuses", () => {
  it("keeps not_run and surfaces the reason the pass did not run", () => {
    const record = withReview({
      doubt: {
        review_type: "doubt",
        status: "not_run",
        findings_count: 0,
        findings: [],
        provider: null,
        completed_at: null,
        disposition: "docs-only diff; the doubt pass is conditional per iteration-reviews.md",
        recorded_by: null,
        parse_status: null,
        raw_excerpt: null,
      },
    });

    const result = readReviewRecord(project(record), RUN_ID);
    if (result.kind !== "valid") throw new Error("expected valid");

    const doubt = result.rows.find((r) => r.reviewType === "doubt")!;
    expect(doubt.status).toBe("not_run");
    expect(doubt.disposition).toContain("conditional per iteration-reviews.md");
  });

  it("keeps not_applicable distinct from not_run", () => {
    const record = withReview({
      external_code: {
        review_type: "external_code",
        status: "not_applicable",
        findings_count: 0,
        findings: [],
        provider: null,
        completed_at: null,
        disposition: "trivial complexity; the cascade does not apply below medium",
        recorded_by: null,
        parse_status: null,
        raw_excerpt: null,
      },
    });

    const result = readReviewRecord(project(record), RUN_ID);
    if (result.kind !== "valid") throw new Error("expected valid");
    expect(result.rows.find((r) => r.reviewType === "external_code")!.status).toBe(
      "not_applicable",
    );
  });

  it("renders a still-pending type as unavailable, never as clean", () => {
    const record = withReview({
      code: {
        review_type: "code",
        status: "pending",
        findings_count: 0,
        findings: [],
        provider: null,
        completed_at: null,
        disposition: null,
        recorded_by: null,
        parse_status: null,
        raw_excerpt: null,
      },
    });

    const result = readReviewRecord(project(record), RUN_ID);
    if (result.kind !== "valid") throw new Error("expected valid");

    const code = result.rows.find((r) => r.reviewType === "code")!;
    expect(code.status).toBe("unavailable");
    expect(code.findingsCount).toBeNull();
    expect(code.note).toBeTruthy();
  });

  it("does not invent a severity the reviewer never gave", () => {
    const record = withReview({
      self: {
        review_type: "self",
        status: "completed",
        findings_count: 1,
        findings: [
          {
            severity: null,
            category: "Test Quality",
            file: null,
            line: null,
            finding: "no error-path test on the CLI",
            suggestion: null,
            source: "self-review",
          },
        ],
        provider: null,
        completed_at: null,
        disposition: null,
        recorded_by: null,
        parse_status: null,
        raw_excerpt: null,
      },
    });

    const result = readReviewRecord(project(record), RUN_ID);
    if (result.kind !== "valid") throw new Error("expected valid");

    const finding = result.rows.find((r) => r.reviewType === "self")!.findings[0];
    expect(finding.severity).toBeNull();
    expect(finding.title).toBe("no error-path test on the CLI");
    expect(finding.location).toBeNull();
  });
});

// --- the unitemizable case (AC7) -------------------------------------------

describe("a review that ran but could not be itemized", () => {
  it("carries parse_status through so the UI never shows a bare zero", () => {
    const record = withReview({
      plan: {
        review_type: "plan",
        status: "completed",
        findings_count: 0,
        findings: [],
        provider: "openrouter",
        completed_at: null,
        disposition: null,
        recorded_by: null,
        parse_status: "unstructured",
        raw_excerpt: "the reviewer replied in prose we could not itemize",
      },
    });

    const result = readReviewRecord(project(record), RUN_ID);
    if (result.kind !== "valid") throw new Error("expected valid");

    const plan = result.rows.find((r) => r.reviewType === "plan")!;
    expect(plan.status).toBe("completed");
    expect(plan.parseStatus).toBe("unstructured");
  });

  it("passes partial through as its own state", () => {
    const record = withReview({
      plan: {
        review_type: "plan",
        status: "completed",
        findings_count: 1,
        findings: [
          {
            severity: "high",
            category: "bug",
            file: null,
            line: null,
            finding: "a real defect",
            suggestion: null,
            source: "external-review",
          },
        ],
        provider: "openrouter",
        completed_at: null,
        disposition: null,
        recorded_by: null,
        parse_status: "partial",
        raw_excerpt: null,
      },
    });

    const result = readReviewRecord(project(record), RUN_ID);
    if (result.kind !== "valid") throw new Error("expected valid");
    expect(result.rows.find((r) => r.reviewType === "plan")!.parseStatus).toBe("partial");
  });
});

// Absent-vs-invalid and strict schema rejection live in
// `review-record.validation.test.ts` (300-line rule).

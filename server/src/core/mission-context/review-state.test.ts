/*
 * review-state.test.ts — the Review source decided in CONTRACT §9.1 (AC4).
 *
 * The invariant these cases exist to protect: a review whose result we CANNOT
 * READ must never render as a review that PASSED. `completed`, `not_run` and
 * `unavailable` are three different facts and collapsing any two of them turns
 * a data-integrity gap into a false assurance.
 *
 * The internal `code` / `doubt` passes have no machine-readable record today
 * (follow-up `trg-74ec44b8`), so they are permanently `unavailable` — pinned
 * here so a future change that starts reporting them "clean" fails loudly.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readReviewState, reviewStatePaths } from "./review-state.js";
import { buildReviewArtifact } from "./artifacts-slice2.js";
import type { ReviewRow, ReviewType } from "./types-slice2.js";

const RUN_ID = "iterate-2026-07-19-demo";

function projectWithMarkers(markers: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mc-review-"));
  const dir = join(root, ".shipwright", "planning", "iterate", RUN_ID);
  mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(markers)) writeFileSync(join(dir, file), body, "utf-8");
  return root;
}

/** The real marker shape, measured on this repo 2026-07-18. */
function marker(status: string, findings: number | null, reason: string | null = null): string {
  return JSON.stringify({
    status,
    timestamp: "2026-07-19T10:00:00+00:00",
    provider: "openrouter",
    findings_count: findings,
    self_review_fallback_ran: false,
    reason,
    review_mode: "iterate",
  });
}

function row(rows: ReviewRow[], t: ReviewType): ReviewRow {
  return rows.find((r) => r.reviewType === t)!;
}

describe("readReviewState", () => {
  it("ALWAYS returns the five contract types, in order (AC4)", () => {
    const root = projectWithMarkers({});
    try {
      const { rows } = readReviewState(root, RUN_ID);
      expect(rows.map((r) => r.reviewType)).toEqual([
        "self",
        "plan",
        "code",
        "doubt",
        "external_code",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads a completed external review, keeping its REAL findings count", () => {
    const root = projectWithMarkers({
      "external_review_state.json": marker("completed", 8, "two accepted, six rejected"),
      "external_code_review_state.json": marker("completed", 3),
    });
    try {
      const { rows, hasRecord } = readReviewState(root, RUN_ID);
      expect(hasRecord).toBe(true);
      expect(row(rows, "plan")).toMatchObject({
        status: "completed",
        findingsCount: 8,
        provider: "openrouter",
        disposition: "two accepted, six rejected",
      });
      expect(row(rows, "external_code")).toMatchObject({ status: "completed", findingsCount: 3 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("NEVER fabricates per-finding detail — the source records only a count", () => {
    const root = projectWithMarkers({ "external_review_state.json": marker("completed", 8) });
    try {
      const { rows } = readReviewState(root, RUN_ID);
      const plan = row(rows, "plan");
      expect(plan.findingsCount).toBe(8);
      expect(plan.findings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("maps every skipped_* / missing_keys status to `not_run` with a readable reason", () => {
    for (const [status, expected] of [
      ["skipped_user_opt_out", "user opt out"],
      ["skipped_config_disabled", "config disabled"],
      ["skipped_complexity_below_threshold", "complexity below threshold"],
      ["missing_keys", "not configured"],
    ] as const) {
      const root = projectWithMarkers({ "external_review_state.json": marker(status, null) });
      try {
        const plan = row(readReviewState(root, RUN_ID).rows, "plan");
        expect(plan.status, status).toBe("not_run");
        expect(plan.note?.toLowerCase(), status).toContain(expected);
        // A count is meaningless for a review that did not run.
        expect(plan.findingsCount, status).toBeNull();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("distinguishes an ABSENT marker from an UNREADABLE one", () => {
    const absent = projectWithMarkers({});
    const corrupt = projectWithMarkers({ "external_review_state.json": "{ not json" });
    try {
      const a = readReviewState(absent, RUN_ID);
      expect(a.hasRecord).toBe(false);
      expect(a.sawUnreadable).toBe(false);
      expect(row(a.rows, "plan").note).toMatch(/No record/i);

      const c = readReviewState(corrupt, RUN_ID);
      expect(c.hasRecord).toBe(false);
      // The file EXISTS and could not be parsed — an integrity signal, and the
      // caller renders it differently from a plain absence.
      expect(c.sawUnreadable).toBe(true);
      expect(row(c.rows, "plan").status).toBe("unavailable");
    } finally {
      rmSync(absent, { recursive: true, force: true });
      rmSync(corrupt, { recursive: true, force: true });
    }
  });

  it("holds the INTERNAL code + doubt passes at `unavailable`, never 'clean'", () => {
    const root = projectWithMarkers({
      "external_review_state.json": marker("completed", 0),
      "external_code_review_state.json": marker("completed", 0),
    });
    try {
      const { rows } = readReviewState(root, RUN_ID);
      for (const t of ["code", "doubt"] as const) {
        const r = row(rows, t);
        expect(r.status, t).toBe("unavailable");
        expect(r.findingsCount, t).toBeNull();
        // The note must say it is a GAP, not a result.
        expect(r.note, t).toMatch(/not a clean result/i);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an unsafe run id without touching the filesystem", () => {
    const { rows, hasRecord } = readReviewState("/root", "../../etc");
    expect(hasRecord).toBe(false);
    expect(rows.every((r) => r.status === "unavailable")).toBe(true);
  });

  it("REPORTS an unidentifiable run as an integrity fault, so it cannot hide", () => {
    // The bug this pins: the branch built four "could not be identified" rows
    // and then returned `sawUnreadable: false`, erasing the fault it had just
    // detected. `buildReviewArtifact` matches `!hasRecord && !sawUnreadable` and
    // HID the artifact — so Spec/Requirement/Commit rendered while Review
    // silently vanished, and the rows above were thrown away.
    //
    // Asserting the rows alone (as the case above does) cannot catch that: the
    // rows were always correct. The ARTIFACT is what regressed, so that is what
    // this asserts (internal code review, MEDIUM).
    const lookup = readReviewState("/root", "../../etc");
    expect(lookup.sawUnreadable).toBe(true);
    expect(buildReviewArtifact(lookup).state).toBe("unavailable");
  });

  it("notes a completed review whose findings count could not be read", () => {
    const root = projectWithMarkers({
      "external_review_state.json": JSON.stringify({ status: "completed" }),
    });
    try {
      const plan = row(readReviewState(root, RUN_ID).rows, "plan");
      expect(plan.status).toBe("completed");
      expect(plan.findingsCount).toBeNull();
      // Without this note the row renders a bare "ran", which a reader
      // completes as "…and found nothing".
      expect(plan.note).toMatch(/findings count was not recorded/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores a non-numeric findings_count instead of trusting it", () => {
    const root = projectWithMarkers({
      "external_review_state.json": JSON.stringify({ status: "completed", findings_count: "eight" }),
    });
    try {
      expect(row(readReviewState(root, RUN_ID).rows, "plan").findingsCount).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("reviewStatePaths", () => {
  it("lists the record AND both markers so a later write invalidates the cache", () => {
    const paths = reviewStatePaths("/root", RUN_ID);
    // Three since the per-run record joined the marker pair as the primary
    // source (iterate-2026-07-22-mission-review-record).
    expect(paths).toHaveLength(3);
    expect(paths.some((p) => p.endsWith("reviews.json"))).toBe(true);
    expect(paths.some((p) => p.endsWith("external_review_state.json"))).toBe(true);
    expect(paths.some((p) => p.endsWith("external_code_review_state.json"))).toBe(true);
    expect(paths.every((p) => p.includes(RUN_ID))).toBe(true);
  });

  it("lists nothing for an unsafe run id", () => {
    expect(reviewStatePaths("/root", "../evil")).toEqual([]);
  });
});

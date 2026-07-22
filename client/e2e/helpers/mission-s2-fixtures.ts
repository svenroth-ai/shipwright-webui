/*
 * mission-s2-fixtures.ts — the REAL sources the S2 Mission artifacts read
 * (campaign 2026-07-18-mission-artifacts, Slice 2).
 *
 * Split out of `flows/mission-artifacts-s2.spec.ts` to keep that file within the
 * 300-LOC rule; the spec keeps the flows, this keeps the fixture construction.
 *
 * The git repository is the load-bearing piece. A REMOVED test cannot be found
 * by inspecting the current traceability manifest — its entry is gone, which is
 * exactly what removal means — so only a genuine commit diff can classify it
 * (AC2). CONTRACT §11 requires a real minimal git repo here rather than a
 * mocked `git log`, for the same reason S1 used one for the squash-merge case:
 * a mocked git only ever proves the mock agrees with itself.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const RUN_ID = "iterate-2026-07-19-mission-s2-e2e";
/** A DIFFERENT run whose ADR sits in the same log — the AC3 isolation probe. */
export const OTHER_RUN_ID = "iterate-2026-07-19-mission-s2-e2e-concurrent";

export const KEPT = "client/src/lib/kept.test.ts";
export const ADDED = "client/src/lib/added.test.ts";
export const REMOVED = "client/e2e/flows/retired.spec.ts";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeAt(root: string, rel: string, body: string): void {
  const abs = join(root, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf-8");
}

/**
 * Build a two-commit repo and return the sha of the SECOND, which is the commit
 * the run "delivered": it ADDS one test, MODIFIES another and REMOVES a third.
 */
export function seedRepoWithTestChanges(root: string): string {
  git(["init", "-q", "-b", "main"], root);
  git(["config", "user.email", "e2e@example.invalid"], root);
  git(["config", "user.name", "E2E Fixture"], root);
  git(["config", "commit.gpgsign", "false"], root);

  // Commit 1 — the baseline the diff is taken against.
  writeAt(root, KEPT, "// baseline\n");
  writeAt(root, REMOVED, "// retired later\n");
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", "baseline"], root);

  // Commit 2 — the run's own change.
  writeAt(root, KEPT, "// baseline\n// modified by the run\n");
  writeAt(root, ADDED, "// brand new\n");
  git(["rm", "-q", REMOVED], root);
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", "the run's change"], root);

  return git(["rev-parse", "HEAD"], root).trim();
}

export function pointer(sessionUuid: string, mainRoot: string): string {
  return JSON.stringify({
    run_id: RUN_ID,
    slug: "mission-s2-e2e",
    main_root: mainRoot,
    session_id: sessionUuid,
    created_at: "2026-07-19T10:00:00Z",
  });
}

export function eventsJsonl(commit: string): string {
  return (
    JSON.stringify({
      id: "evt-s2-0001",
      type: "work_completed",
      ts: "2026-07-19T12:00:00Z",
      adr_id: RUN_ID,
      commit,
      summary: "Ship the Tests, Review and Decisions artifacts.",
      spec_impact: "modify",
      affected_frs: ["FR-01.66"],
      tests: { passed: 20, total: 20 },
    }) + "\n"
  );
}

/**
 * A manifest filing the MODIFIED test under a surviving parent while recording
 * the FOLDED id its source tag actually named — the "mapped from" case (AC2).
 */
export function traceability(): string {
  return JSON.stringify({
    schema_version: 2,
    generated_at: "2026-07-19T09:00:00Z",
    requirements: {
      "01-adopted::FR-01.28": {
        id: "FR-01.28",
        tests: {
          unit: [
            { id: `${KEPT}::keeps working`, layer: "unit", resolved_from: "FR-01.44" },
            { id: `${ADDED}::is new`, layer: "unit" },
          ],
        },
      },
    },
  });
}

/** The real marker shape written by `mark-review-state.py`. */
export function reviewMarker(mode: string, findings: number, reason: string | null): string {
  return JSON.stringify({
    status: "completed",
    timestamp: "2026-07-19T11:00:00+00:00",
    provider: "openrouter",
    findings_count: findings,
    self_review_fallback_ran: false,
    reason,
    review_mode: mode,
  });
}

/** Two ADRs: this run's, and a CONCURRENT run's that must never leak in (AC3). */
export function decisionLog(): string {
  return [
    "# Decision Log",
    "",
    "### ADR-900: Read the review state from the external markers",
    "- **Date:** 2026-07-19",
    `- **Run-ID:** ${RUN_ID}`,
    "- **Decision:** Ship Review from the external marker files.",
    "",
    "---",
    "",
    "### ADR-901: A concurrent iterate's unrelated decision",
    "- **Date:** 2026-07-19",
    `- **Run-ID:** ${OTHER_RUN_ID}`,
    "- **Decision:** Something entirely unrelated to this run.",
    "",
    "---",
    "",
  ].join("\n");
}

/**
 * A per-run review record, in the shape the shipwright monorepo producer writes
 * (`shared/scripts/lib/review_record*.py`, PR #428). Kept minimal but SHAPE-EXACT;
 * the byte-verbatim copy of real producer output lives in the server unit tests
 * (`server/src/test/fixtures/reviews-record-real.json`).
 */
export function reviewRecord(
  over: Partial<Record<string, Record<string, unknown>>> = {},
): string {
  const base = (reviewType: string, extra: Record<string, unknown> = {}) => ({
    review_type: reviewType,
    status: "completed",
    findings_count: 0,
    findings: [],
    provider: null,
    completed_at: "2026-07-22T09:00:00+00:00",
    disposition: null,
    recorded_by: null,
    parse_status: null,
    raw_excerpt: null,
    ...extra,
  });
  return JSON.stringify(
    {
      schema_version: 1,
      run_id: RUN_ID,
      reviews: {
        self: base("self", {
          findings_count: 1,
          findings: [
            {
              severity: null,
              category: "Test Quality",
              file: null,
              line: null,
              finding: "no error-path test on the reader",
              suggestion: null,
              source: "self-review",
            },
          ],
        }),
        plan: base("plan", { provider: "openrouter", parse_status: "structured" }),
        code: base("code", {
          findings_count: 1,
          findings: [
            {
              severity: "medium",
              category: "correctness",
              file: "server/src/core/x.ts",
              line: 42,
              finding: "the lock is released before the write",
              suggestion: "widen the lock",
              source: "code-reviewer",
            },
          ],
        }),
        doubt: base("doubt", {
          status: "not_applicable",
          disposition: "docs-only diff; the doubt pass is conditional per iteration-reviews.md",
        }),
        external_code: base("external_code", {
          provider: "openrouter",
          parse_status: "unstructured",
        }),
        ...over,
      },
    },
    null,
    2,
  );
}

/*
 * S2 — Mission artifacts: Tests · Review · Decisions
 * (campaign 2026-07-18-mission-artifacts; FR-01.66).
 *
 * These flows drive the real resolver end-to-end over REAL sources: a real git
 * repository whose second commit adds, modifies and DELETES test files; a real
 * `test-traceability.json` carrying a `resolved_from` fold; real
 * `external_*review_state.json` markers; and a real `decision_log.md` holding
 * both this run's ADR and a CONCURRENT iterate's.
 *
 * Fixture construction lives in `../helpers/mission-s2-fixtures`.
 *
 * @covers FR-01.66
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { writeFiles } from "../helpers/temp-dir";
import {
  RUN_ID,
  decisionLog,
  eventsJsonl,
  pointer,
  reviewMarker,
  reviewRecord,
  seedRepoWithTestChanges,
  traceability,
} from "../helpers/mission-s2-fixtures";

const MINI_PLAN = `.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`;
const PLAN_REVIEW = `.shipwright/planning/iterate/${RUN_ID}/external_review_state.json`;
const CODE_REVIEW = `.shipwright/planning/iterate/${RUN_ID}/external_code_review_state.json`;
const REVIEW_RECORD = `.shipwright/planning/iterate/${RUN_ID}/reviews.json`;

test.describe("S2 — Tests · Review · Decisions artifacts", () => {
  let project: SeededProject;
  let taskId: string;

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
  });

  /** Seed a project + task + a real repo, and return the task's sessionUuid. */
  async function seed(
    request: Parameters<typeof seedProject>[0],
    name: string,
    dirName: string,
  ): Promise<{ sessionUuid: string; commit: string }> {
    project = await seedProject(request, { name, dirName, adopted: true });
    const commit = seedRepoWithTestChanges(project.path);
    const task = await seedTask(request, { title: name, projectId: project.projectId });
    taskId = task.taskId;
    return { sessionUuid: task.sessionUuid, commit };
  }

  test("a finalized iterate shows Tests · Review · Decisions with real content (AC1)", async ({
    page,
    request,
  }) => {
    const { sessionUuid, commit } = await seed(request, "MissionS2Full", "sw-s2-full");

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${sessionUuid}.json`]: pointer(sessionUuid, project.path),
      [MINI_PLAN]: "# S2 fixture\n\nThe plan.\n",
      [PLAN_REVIEW]: reviewMarker("iterate", 5, "Three accepted and fixed, two rejected."),
      [CODE_REVIEW]: reviewMarker("code", 0, null),
      ".shipwright/compliance/test-traceability.json": traceability(),
      ".shipwright/agent_docs/decision_log.md": decisionLog(),
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    // All three new artifacts render — each has content, so none is hidden.
    await expect(page.getByTestId("artifact-link-tests")).toBeVisible();
    await expect(page.getByTestId("artifact-link-review")).toBeVisible();
    await expect(page.getByTestId("artifact-link-decisions")).toBeVisible();
  });

  test("Tests classifies a REMOVED test and shows 'mapped from' (AC2)", async ({
    page,
    request,
  }) => {
    const { sessionUuid, commit } = await seed(request, "MissionS2Tests", "sw-s2-tests");

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${sessionUuid}.json`]: pointer(sessionUuid, project.path),
      [MINI_PLAN]: "# S2\n",
      ".shipwright/compliance/test-traceability.json": traceability(),
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await page.getByTestId("artifact-link-tests").click();

    const table = page.getByTestId("artifact-tests-table");
    await expect(table).toBeVisible();

    // The REMOVED test is present and labelled — the case only a real diff can
    // answer, because its manifest entry no longer exists.
    const removed = page.getByTestId("artifact-tests-row").filter({ hasText: "retired.spec.ts" });
    await expect(removed).toHaveAttribute("data-kind", "removed");
    await expect(removed).toContainText("end-to-end");

    // …and the added + modified rows carry their own classifications.
    await expect(
      page.getByTestId("artifact-tests-row").filter({ hasText: "added.test.ts" }),
    ).toHaveAttribute("data-kind", "added");
    await expect(
      page.getByTestId("artifact-tests-row").filter({ hasText: "kept.test.ts" }),
    ).toHaveAttribute("data-kind", "modified");

    // The fold provenance on the per-FR test link (AC2).
    await expect(table).toContainText("FR-01.28 (mapped from FR-01.44)");
  });

  test("Review reads the per-run record: real findings, and no fake zero (AC1/AC7)", async ({
    page,
    request,
  }) => {
    const { sessionUuid, commit } = await seed(request, "MissionS2Record", "sw-s2-record");

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${sessionUuid}.json`]: pointer(sessionUuid, project.path),
      [MINI_PLAN]: "# S2",
      // BOTH sources present: the record must win.
      [PLAN_REVIEW]: reviewMarker("iterate", 5, "marker says five"),
      [REVIEW_RECORD]: reviewRecord(),
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await page.getByTestId("artifact-link-review").click();

    // The self-review is present and labelled — the pass that always runs, and
    // the one the marker path could never show.
    const self = page.locator('[data-review-type="self"]');
    await expect(self).toContainText("Self-review");
    await expect(self).toContainText("no error-path test on the reader");

    // Per-finding detail with its location — the record's whole point.
    const code = page.locator('[data-review-type="code"]');
    await expect(code).toContainText("the lock is released before the write");
    await expect(code.getByTestId("artifact-review-location")).toContainText(
      "server/src/core/x.ts:42",
    );
    // The severity/text/location/suggestion spans are adjacent with NO separator
    // text, so their separation is entirely CSS. jsdom normalizes whitespace and
    // cannot see this — without the rule they render as one run-on string.
    const findingBox = code.getByTestId("artifact-review-finding").first();
    await expect(findingBox).toHaveCSS("display", "flex");
    await expect(findingBox).toHaveCSS("flex-direction", "column");

    // A pass that did not APPLY says so, with its reason.
    const doubt = page.locator('[data-review-type="doubt"]');
    await expect(doubt).toContainText("did not apply");
    await expect(doubt).toContainText("docs-only diff");

    // The unitemizable pass shows NO count — "0 issues" would read as clean.
    const ext = page.locator('[data-review-type="external_code"]');
    await expect(ext.getByTestId("artifact-review-unitemized")).toBeVisible();
    await expect(ext.getByTestId("artifact-review-count")).toHaveCount(0);
  });

  test("Review shows the five passes, with unrecorded ones explicit (AC4)", async ({
    page,
    request,
  }) => {
    const { sessionUuid, commit } = await seed(request, "MissionS2Review", "sw-s2-review");

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${sessionUuid}.json`]: pointer(sessionUuid, project.path),
      [MINI_PLAN]: "# S2\n",
      [PLAN_REVIEW]: reviewMarker("iterate", 5, "Three accepted and fixed, two rejected."),
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await page.getByTestId("artifact-link-review").click();

    // All five passes are always represented (AC4). `self` joined the four in
    // iterate-2026-07-22-mission-review-record; on this MARKER-fallback path it
    // has no source, so it renders as "no record" like the other internal passes.
    await expect(page.getByTestId("artifact-review-row")).toHaveCount(5);

    // The external plan review ran and its REAL count shows.
    await expect(page.locator('[data-review-type="plan"]')).toContainText("5 issues");

    // The internal passes have no machine-readable record — shown as such, and
    // NEVER as a pass. This is the §9.1 honesty rule.
    //
    // Asserted on the STATUS element, not on the row text: the row's note
    // legitimately contains the word "clean" (it reads "a known gap, not a
    // clean result"), so a blanket substring check would fail on correct copy
    // while still passing if the STATUS itself regressed to "ran".
    const code = page.locator('[data-review-type="code"]');
    const status = code.getByTestId("artifact-review-status");
    await expect(status).toHaveText("no record");
    // …and no findings count is invented for a pass we cannot read.
    await expect(code.getByTestId("artifact-review-count")).toHaveCount(0);
  });

  test("Decisions shows ONLY this run's ADR — a concurrent iterate's is absent (AC3)", async ({
    page,
    request,
  }) => {
    const { sessionUuid, commit } = await seed(request, "MissionS2Decisions", "sw-s2-decisions");

    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${sessionUuid}.json`]: pointer(sessionUuid, project.path),
      [MINI_PLAN]: "# S2\n",
      ".shipwright/agent_docs/decision_log.md": decisionLog(),
      "shipwright_events.jsonl": eventsJsonl(commit),
    });

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await page.getByTestId("artifact-link-decisions").click();

    const entries = page.getByTestId("artifact-decision-entry");
    await expect(entries).toHaveCount(1);
    await expect(entries).toHaveAttribute("data-adr", "ADR-900");

    const panel = page.getByTestId("mission-artifact-panel");
    await expect(panel).toContainText("Read the review state from the external markers");
    // The concurrent iterate's decision must not have leaked in.
    await expect(panel).not.toContainText("ADR-901");
    await expect(panel).not.toContainText("entirely unrelated");
  });
});

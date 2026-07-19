/*
 * S3 — the Mission tab-hide (scenario 6)
 * (campaign 2026-07-18-mission-artifacts; FR-01.66, AC2).
 *
 * Its own spec file because it is its own decision: hiding the Mission tab is
 * the only thing in this campaign that removes a whole surface, and the two
 * failure directions are NOT symmetric.
 *
 *   too permissive → an empty Mission tab. Obvious, and the user can move on.
 *   too aggressive → a working feature VANISHES, with no error and no cause.
 *
 * So the file is deliberately lopsided: ONE flow covers the hide, and six cover
 * the ambiguous inputs that must all fall back to SHOWING. Each writes a REAL
 * `.shipwright-webui/actions.json` and drives the real loader — the regression
 * that prompted this work (valid JSON, wrong shape) is invisible to any test
 * that stubs the catalog, because the file parses perfectly.
 *
 * @covers FR-01.66
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedLocalStorage,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { writeFiles } from "../helpers/temp-dir";
import { actionsJson, runConfig } from "../helpers/mission-s3-fixtures";

const MISSION_TAB_KEY = "webui:task-detail-mission-tab";

test.describe("S3 — scenario 6: the Mission tab-hide", () => {
  let project: SeededProject;
  let taskId: string;

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
  });

  // -------------------------------------------------------------------------
  // AC2 — the tab-hide, and every ambiguous fallback
  // -------------------------------------------------------------------------

  test("a VALIDATED custom-actions project has no Mission tab (AC2)", async ({ page, request }) => {
    // No run-config → not an SDLC project; a clean, purely-custom catalog.
    project = await seedProject(request, { name: "MissionS3Custom", dirName: "sw-s3-custom" });
    await writeFiles(project.path, {
      ".shipwright-webui/actions.json": actionsJson("valid_custom"),
    });

    const task = await seedTask(request, { title: "Publish a post", projectId: project.projectId });
    taskId = task.taskId;

    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);

    await expect(page.getByTestId("mission-tab-files")).toBeVisible();
    await expect(page.getByTestId("mission-tab-mission")).toHaveCount(0);
  });

  test("landing with Mission as the SAVED view falls back to Files, not a blank pane (AC2)", async ({
    page,
    request,
  }) => {
    // External plan review (gemini medium / openai high): hiding a tab that is
    // already the active view must not leave an empty panel or a dead route.
    // The tab preference is persisted, so a user who last used Mission lands
    // straight on it — for a custom-actions project it must resolve to Files.
    project = await seedProject(request, { name: "MissionS3Land", dirName: "sw-s3-land" });
    await writeFiles(project.path, {
      ".shipwright-webui/actions.json": actionsJson("valid_custom"),
    });

    const task = await seedTask(request, { title: "Publish a post", projectId: project.projectId });
    taskId = task.taskId;

    await seedLocalStorage(page, { [MISSION_TAB_KEY]: JSON.stringify("mission") });
    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${taskId}`);

    await expect(page.getByTestId("mission-tab-mission")).toHaveCount(0);
    await expect(page.getByTestId("mission-tab-files")).toHaveAttribute("aria-checked", "true");
    // The Mission body must not be mounted at all.
    await expect(page.getByTestId("task-detail-mission")).toHaveCount(0);
  });

  /**
   * The asymmetry, four ways. Each of these files is ambiguous in a different
   * way, and every one of them must leave the tab in place.
   */
  const fallbacks = [
    { name: "valid JSON of the WRONG SHAPE", shape: "wrong_shape" as const, runConfig: false },
    { name: "a MALFORMED actions file", shape: "malformed" as const, runConfig: false },
    { name: "DUAL mode — a builtin action alongside the customs", shape: "dual" as const, runConfig: false },
    // `seedProject({adopted:true})` writes only the MARKER file that makes
    // `isAdopted` true — it is not a parseable v2 config, so a project seeded
    // that way is genuinely NOT dual-mode. This case writes a real one.
    { name: "DUAL mode — custom actions AND a valid run-config", shape: "valid_custom" as const, runConfig: true },
  ];

  for (const [i, fb] of fallbacks.entries()) {
    test(`${fb.name} keeps the Mission tab (AC2)`, async ({ page, request }) => {
      project = await seedProject(request, {
        name: `MissionS3Fb${i}`,
        dirName: `sw-s3-fb${i}`,
      });
      await writeFiles(project.path, {
        ".shipwright-webui/actions.json": actionsJson(fb.shape),
        ...(fb.runConfig ? { "shipwright_run_config.json": runConfig() } : {}),
      });

      const task = await seedTask(request, { title: "A task", projectId: project.projectId });
      taskId = task.taskId;

      await setActiveProject(page, project.projectId);
      await page.goto(`/tasks/${taskId}`);

      // The tab is present AND usable — not merely rendered.
      await expect(page.getByTestId("mission-tab-mission")).toBeVisible();
      await page.getByTestId("mission-tab-mission").click();
      await expect(page.getByTestId("task-detail-mission")).toBeVisible();
    });
  }
});

/*
 * Spec 46 — Rename while polling delivers events.
 *
 * The transcript polling hook continues to fetch JSONL deltas every ~1 s.
 * Renaming the task while polling is in flight must NOT cause stale-cache
 * resurrection of the old title or a polling error.
 */

import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { cleanupTaskCwd, seedTask } from "../helpers/fixtures";

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

test.describe("Rename mid-polling", () => {
  // @covers FR-01.02
  test("title updates everywhere, polling does not error, no stale cache resurrects old title", async ({
    page,
    request,
  }) => {
    // Real temp cwd (not a hardcoded C:/tmp path) + teardown in `finally`, so the
    // run leaves no task behind for the isolated-stack contamination guard.
    const task = await seedTask(request, { title: "polling-rename-old" });
    const encodedDir = path.join(PROJECTS_DIR, `e2e-poll-rename-${Date.now()}`);
    try {
      mkdirSync(encodedDir, { recursive: true });
      const jsonlPath = path.join(encodedDir, `${task.sessionUuid}.jsonl`);
      writeFileSync(
        jsonlPath,
        JSON.stringify({
          type: "user",
          sessionId: task.sessionUuid,
          message: { content: "first" },
        }) + "\n",
        "utf-8",
      );

      await page.goto(`/tasks/${task.taskId}`);
      await expect(page.getByTestId("task-title-display")).toHaveText(/polling-rename-old/);

      // Trigger the polling tick by waiting for active state.
      await expect(page.getByTestId("task-state-badge")).toHaveText("In progress", { timeout: 5000 });

      // Inject more events while we rename.
      appendFileSync(
        jsonlPath,
        JSON.stringify({
          type: "assistant",
          sessionId: task.sessionUuid,
          message: { content: [{ type: "text", text: "mid-flight reply" }] },
        }) + "\n",
        "utf-8",
      );

      // Rename mid-stream.
      await page.getByTestId("task-title-display").click();
      await page.getByTestId("task-title-input-edit").fill("polling-rename-new");
      await page.getByTestId("task-title-input-edit").press("Enter");

      // The rename + a transcript update should both surface within a polling cycle.
      await expect(page.getByTestId("task-title-display")).toHaveText(/polling-rename-new/, {
        timeout: 5000,
      });
      // The reply is rendered by the Mission activity feed (the transcript pane
      // is no longer the default surface).
      await page.getByTestId("mission-tab-mission").click();
      await expect(page.getByTestId("mission-activity-feed")).toContainText("mid-flight reply");

      // Wait one more polling cycle — old title must NOT resurrect.
      await page.waitForTimeout(1500);
      await expect(page.getByTestId("task-title-display")).toHaveText(/polling-rename-new/);
    } finally {
      await cleanupTaskCwd(request, task);
      rmSync(encodedDir, { recursive: true, force: true });
    }
  });
});

/*
 * Visual baselines — TaskDetail (Mission pane + Files & Terminal). A00, AC1 + AC4.
 *
 * A18 rebuilds the Files & Terminal shell into three cards around a REAL xterm.
 * That restyle must not be able to silently wreck the surrounding chrome — but
 * the pty ITSELF is not deterministic (prompt, cwd, cursor, shell banner), so the
 * canvas is MASKED rather than captured.
 *
 * Masking is the honest move. The alternative — loosening maxDiffPixelRatio until
 * a live terminal "passes" — would blind the gate to every other pixel on the page
 * at the same time, which is how a visual gate becomes theatre.
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
import { apiUrl } from "../helpers/env";
import { freezeClock, nonDeterministicRegions, settle } from "./stabilize";

test.describe("visual: task detail", () => {
  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-visual-atlas" });
    const task = await seedTask(request, {
      title: "Survey the hull",
      projectId: project.projectId,
    });
    taskId = task.taskId;

    const created = await request
      .get(apiUrl(`/api/external/tasks/${taskId}`))
      .then((r) => r.json() as Promise<{ task: { createdAt: string } }>);
    await freezeClock(page, created.task.createdAt);
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  // A11 introduces the Mission tab NON-default (default = Files & Terminal), so
  // the Mission baseline clicks into it first. A12 adds the Operation card (verdict
  // + mission line + curated proof summary) beside the Record rail — so this
  // baseline MOVES: it is the Mission tab in the DONE state (a seeded task joins to
  // no run, so the verdict is the honest "No run data yet", never a false ALL
  // CLEAR). The collapsed-rail + artifact-open states are covered functionally in
  // flows/A11-mission-record-rail.spec.ts; A13 pixel-baselines them alongside the
  // full three-card shell.
  test("task-detail-mission", async ({ page }) => {
    await page.goto(`/tasks/${taskId}`);
    await expect(page.getByTestId("cta-launch-in-terminal")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("mission-tab-mission").click();
    await expect(page.getByTestId("record-rail")).toBeVisible();
    await expect(page.getByTestId("operation-card")).toBeVisible();
    await settle(page);

    await expect(page).toHaveScreenshot("task-detail-mission.png", {
      fullPage: true,
      mask: nonDeterministicRegions(page),
    });
  });

  // A12, AC6 — the Mission tab in the LIVE (mid-run) state. The isolated harness
  // has no live Claude to drive a task to `state: "active"`, so we override ONLY
  // that projected field on the task GET (everything else is the real seeded task):
  // the Record rail then shows a `now` frontier and the Operation card renders its
  // live layout. With no run facts the verdict is still the honest neutral state —
  // the live/done difference here is the rail frontier + the header, not a fake
  // verdict. This is the ONLY additional route this iterate baselines.
  test("task-detail-mission-live", async ({ page }) => {
    await page.route(
      (u) => u.pathname.endsWith(`/api/external/tasks/${taskId}`),
      async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        if (body?.task) body.task.state = "active";
        await route.fulfill({ response: res, json: body });
      },
    );

    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await expect(page.getByTestId("record-rail")).toBeVisible();
    await expect(page.getByTestId("operation-card")).toBeVisible();
    await settle(page);

    await expect(page).toHaveScreenshot("task-detail-mission-live.png", {
      fullPage: true,
      mask: nonDeterministicRegions(page),
    });
  });

  test("task-detail-terminal", async ({ page }) => {
    await page.goto(`/tasks/${taskId}`);

    const terminalTab = page.getByRole("tab", { name: /terminal/i });
    if (await terminalTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await terminalTab.click();
    }

    // Wait for the WS to be attached before capturing: a half-mounted terminal
    // would bake a transient loading state into the baseline, and then every
    // future run would have to reproduce that same race to match it.
    const term = page.getByTestId("embedded-terminal");
    await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 20_000 });
    await settle(page);

    await expect(page).toHaveScreenshot("task-detail-terminal.png", {
      fullPage: true,
      mask: nonDeterministicRegions(page),
    });
  });
});

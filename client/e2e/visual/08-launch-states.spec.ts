/*
 * Visual baselines — the launch state machine (A17, FR-01.61).
 *
 * The whole point of A17 is that a failed / draft launch state now HAS pixels.
 * Two new captures:
 *   - board-launch-failed: the board with a DRAFT campaign card (status badge +
 *     Start CTA) AND a task whose state is launch_failed (the task-card failure
 *     notice) — the two states that used to be invisible on the board.
 *   - task-detail-launch-failed: the task-detail header with the launch-failure
 *     notice mounted (jsonl_missing — names the watched path + the recovery).
 *
 * State overrides ride on `page.route` (the same honest trick 02-task-detail's
 * `-live` capture uses): the isolated harness has no live Claude to drive a task
 * into a failure state, so ONLY the projected `state` field is overridden — every
 * other byte is the real seeded task.
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
import { seedCampaign } from "../helpers/campaign-fixture";
import { apiUrl } from "../helpers/env";
import { freezeClock, nonDeterministicRegions, settle } from "./stabilize";

test.describe("visual: launch states", () => {
  let project: SeededProject;
  const taskIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of taskIds) await cleanupTask(request, id);
    taskIds.length = 0;
    await cleanupProject(request, project);
  });

  test("board-launch-failed", async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-visual-atlas-a17", adopted: true });
    seedCampaign(project.path, {
      slug: "2026-07-10-a17-visual",
      status: "draft",
      subIterates: [
        { id: "S1", slug: "one", status: "pending", title: "First step" },
        { id: "S2", slug: "two", status: "pending", title: "Second step" },
      ],
    });
    const failed = await seedTask(request, { title: "Launch the rigging", projectId: project.projectId });
    taskIds.push(failed.taskId);

    // Override ONLY the projected state → launch_failed, so the card mounts the
    // failure notice (the real state machine can't reach it in the harness).
    await page.route(
      (u) => u.pathname.endsWith("/api/external/tasks"),
      async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        for (const t of body?.tasks ?? []) if (t.taskId === failed.taskId) t.state = "launch_failed";
        await route.fulfill({ response: res, json: body });
      },
    );

    const created = await request
      .get(apiUrl(`/api/external/tasks/${failed.taskId}`))
      .then((r) => r.json() as Promise<{ task: { createdAt: string } }>);
    await freezeClock(page, created.task.createdAt);
    await setActiveProject(page, project.projectId);

    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();
    await expect(page.getByTestId("campaign-status-2026-07-10-a17-visual")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`task-card-failure-${failed.taskId}`)).toBeVisible();
    await settle(page);

    // The task-card commit marker is `sessionUuid.slice(0,7)` (TaskCard.tsx) and
    // the server mints a RANDOM sessionUuid per seed — an unmasked, unfrozen value
    // whose ~100px glyph diff straddles the gate tolerance, so this baseline is a
    // coin-flip run to run (it passed at #276, failed on the A19 gate). Mask the
    // marker: its content is non-deterministic, its rendering is trivial, so no
    // coverage is lost. (`board.png` carries the same latent flake — see the A19 PR
    // note; masked here where it actually bit.)
    await expect(page).toHaveScreenshot("board-launch-failed.png", {
      fullPage: true,
      mask: [page.locator('[data-testid^="task-card-commit-"]')],
    });
  });

  test("task-detail-launch-failed", async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-visual-atlas-a17b", adopted: true });
    const task = await seedTask(request, { title: "Launch the rigging", projectId: project.projectId });
    taskIds.push(task.taskId);

    await page.route(
      (u) => u.pathname.endsWith(`/api/external/tasks/${task.taskId}`),
      async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        if (body?.task) body.task.state = "jsonl_missing";
        await route.fulfill({ response: res, json: body });
      },
    );

    const created = await request
      .get(apiUrl(`/api/external/tasks/${task.taskId}`))
      .then((r) => r.json() as Promise<{ task: { createdAt: string } }>);
    await freezeClock(page, created.task.createdAt);
    await setActiveProject(page, project.projectId);

    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId(`task-detail-failure-${task.taskId}`)).toBeVisible({ timeout: 15_000 });
    await settle(page);

    await expect(page).toHaveScreenshot("task-detail-launch-failed.png", {
      fullPage: true,
      mask: nonDeterministicRegions(page),
    });
  });
});

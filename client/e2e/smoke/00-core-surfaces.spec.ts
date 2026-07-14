/*
 * CORE SMOKE — the CI gate. A00 (iterate-2026-07-10-harness-hardening), AC3.
 *
 * ── What this is ────────────────────────────────────────────────────────────
 * The subset that runs on EVERY pull request as `E2E smoke (gate)`. Before A00,
 * CI ran tsc + oxlint + vitest + diff-cover and nothing else: 114 Playwright specs
 * existed and ZERO of them gated a merge. An agent could open a fully-green PR
 * having destroyed the board, and nothing would have said a word.
 *
 * ── What belongs here, and what does not ────────────────────────────────────
 * Every screen a user can actually reach must MOUNT and show its own content.
 * This is a "the app is not broken" gate, deliberately shallow and fast (<5 min).
 * Deep behavioural coverage stays in the full suite (`npm run test:e2e`); pixel
 * fidelity is the `visual` project's job. Adding slow, deep specs here is how a
 * smoke gate rots into something people start skipping.
 *
 * Tagged `@smoke` — `npm run test:e2e:smoke` greps for exactly that tag.
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

test.describe("@smoke core surfaces", () => {
  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Smoke" });
    const task = await seedTask(request, {
      title: "Smoke task",
      projectId: project.projectId,
    });
    taskId = task.taskId;
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  test("board renders WITH its columns and the seeded card", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    // "The page rendered" is not enough — a repaint that drops the COLUMNS still
    // renders a page. The columns are the board.
    await expect(page.getByTestId("task-board-columns-AC3-DRILL")).toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId(`task-card-${taskId}`)).toBeVisible({ timeout: 15_000 });
  });

  test("task detail opens on the Mission pane with its launch CTA", async ({ page }) => {
    await page.goto(`/tasks/${taskId}`);
    await expect(page.getByTestId("cta-launch-in-terminal")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Smoke task").first()).toBeVisible();
  });

  test("the embedded terminal pane mounts and its WebSocket goes ready", async ({ page }) => {
    await page.goto(`/tasks/${taskId}`);

    const terminalTab = page.getByRole("tab", { name: /terminal/i });
    if (await terminalTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await terminalTab.click();
    }

    // data-ws-ready is the honest signal: the pane being in the DOM proves
    // nothing, because a terminal that never attaches its socket looks identical.
    const term = page.getByTestId("embedded-terminal");
    await expect(term).toBeVisible({ timeout: 15_000 });
    await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 20_000 });
  });

  for (const route of [
    { path: "/projects", name: /projects/i },
    { path: "/inbox", name: /inbox/i },
    { path: "/triage", name: /triage/i },
    { path: "/settings", name: /settings/i },
    { path: "/diagnostics", name: /diagnostics/i },
  ]) {
    test(`${route.path} mounts and shows its own heading`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));

      await page.goto(route.path);
      await expect(page.getByRole("heading", { name: route.name }).first()).toBeVisible({
        timeout: 15_000,
      });

      // A route that throws on mount can still paint a heading from a stale frame.
      expect(pageErrors, `uncaught page errors on ${route.path}`).toEqual([]);
    });
  }
});

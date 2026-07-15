/*
 * Spec 30 — Kanban → Task Detail → Launch CTA → clipboard contains
 * pre-bound `--session-id` command + state transitions to
 * `awaiting_external_start`.
 *
 * Iterate 3 section 04 rewrite: the legacy LaunchRow + CopyCommandCard
 * (three rows of PS/cmd/POSIX copy buttons) was deleted. The new
 * TaskDetailHeader renders a single state-dependent CTA
 * `cta-launch-in-terminal` that copies the platform-appropriate command
 * to the clipboard in one shot.
 */

import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect } from "@playwright/test";

test.describe("TaskDetail Launch CTA", () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "30-launch-copy" });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("Launch CTA copies pre-bound command + transitions state", async ({
    page,
    request,
    context,
  }) => {
    await context.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const title = `e2e-launch-${Date.now()}`;
    const create = await request.post("/api/external/tasks", {
      data: { title, cwd: process.cwd() },
    });
    expect(create.status()).toBe(200);
    const { task } = (await create.json()) as { task: { taskId: string } };

    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("task-detail-page")).toBeVisible();
    await expect(page.getByTestId("task-state-badge")).toHaveText("Draft");

    // A00 — the primary CTA now AUTO-EXECUTES in the embedded terminal (ADR-068-A1)
    // and no longer writes the clipboard. The surviving "copy the command to paste
    // into a DIFFERENT terminal" workaround is the header-menu item
    // `task-detail-menu-copy-resume-command`, gated on state != draft. Launch once to
    // leave draft, then copy the command via the menu.
    await page.getByTestId("cta-launch-in-terminal").click();
    await expect(page.getByTestId("task-state-badge")).toHaveText("Awaiting launch", {
      timeout: 5000,
    });

    await page.evaluate(() => navigator.clipboard.writeText(""));
    await page.getByTestId("task-detail-menu-trigger").click();
    await page.getByTestId("task-detail-menu-copy-resume-command").click();
    await expect(page.getByTestId("task-detail-menu-notice")).toHaveAttribute(
      "data-kind",
      "ok",
    );

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    // The copied command carries the pre-bound uuid via `--resume '<uuid>'` (it is the
    // Resume command — the point is continuing the session in another terminal).
    expect(clipboard).toMatch(/--resume '[0-9a-f-]{36}'/);
  });
});

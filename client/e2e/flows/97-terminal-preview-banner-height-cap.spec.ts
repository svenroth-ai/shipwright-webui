/*
 * Spec 97 — long launch-command preview banner must not squeeze the
 * terminal canvas to zero height (iterate-2026-08-14-terminal-launch-preview-height).
 *
 * Reproduces the reported bug: a `new-iterate` launch command with a long
 * task description substituted in (observed at 5341 chars against the real
 * production trg-c57bec15 report) makes the uncapped "About to run: <cmd>"
 * preview banner wrap to 1000+px tall. As a flex-column sibling ahead of the
 * xterm canvas div (min-h-0 flex-1), that squeezed the canvas to 0 height —
 * isMeasurableTerminalContainer (width>0 && height>0) then never passed, so
 * the pre-dispatch resize retry loop in useAutoLaunch.ts spun until timeout
 * and silently cancelled: the launch command was NEVER written to the pty.
 * User-visible symptom: the terminal appears to fill with echoed command
 * text, then settle at a clean, untouched shell prompt with Claude never
 * starting.
 *
 * jsdom cannot compute real flex layout (TerminalBanners.test.tsx covers the
 * CSS class fence instead) — this spec verifies the actual browser geometry:
 * the canvas must have a real height, and the preview banner must resolve
 * (not get stuck) within a bounded window.
 *
 * Self-contained: creates its own project + task, so it runs on an isolated
 * stack.
 */
import { test, expect } from "@playwright/test";
import { makeTaskCwd, cleanupCwd } from "../helpers/task-fixture";

// Mirrors the real trg-c57bec15 description length that triggered the bug —
// long enough that, uncapped, the preview banner's break-all wrap exceeds
// any reasonable terminal pane height.
const LONG_DESCRIPTION = "x".repeat(5300);

test.describe("Long launch-command preview banner stays height-capped (iterate-2026-08-14)", () => {
  test.setTimeout(60_000);

  test("canvas keeps a real height and the launch command actually reaches the pty", async ({
    page,
    request,
  }) => {
    const suffix = Date.now();
    const projectCwd = await makeTaskCwd("preview-banner-height-e2e-");
    const proj = await request.post("/api/projects", {
      data: { name: `preview-banner-height-${suffix}`, path: projectCwd, profile: "default", status: "active" },
    });
    expect(proj.ok()).toBeTruthy();
    const { data: p } = (await proj.json()) as { data: { id: string } };
    const cwd = await makeTaskCwd();
    let taskId: string | undefined;
    try {
      const created = await request.post("/api/external/tasks", {
        data: {
          title: `preview-banner-height-${suffix}`,
          cwd,
          projectId: p.id,
          description: LONG_DESCRIPTION,
          actionId: "new-iterate",
        },
      });
      expect(created.ok()).toBeTruthy();
      taskId = ((await created.json()) as { task: { taskId: string } }).task.taskId;

      await page.setViewportSize({ width: 900, height: 700 });
      await page.goto(`/tasks/${taskId}`);

      const launchCta = page.getByTestId("cta-launch-in-terminal");
      await expect(launchCta).toBeVisible();
      await launchCta.click();

      const canvas = page.getByTestId("embedded-terminal-canvas");
      await expect(canvas).toBeVisible({ timeout: 15_000 });

      // The regression: an uncapped banner drove this to exactly 0.
      await expect
        .poll(
          async () => (await canvas.boundingBox())?.height ?? 0,
          { timeout: 15_000, message: "terminal canvas must keep a nonzero height while a long command is pending" },
        )
        .toBeGreaterThan(0);

      // The launch must actually resolve — not get stuck behind the preview
      // banner until the silent retry-loop timeout. Either the banner clears
      // (dispatch succeeded) well within the loop's timeout budget, while the
      // canvas keeps a real height the whole time.
      await expect(
        page.getByTestId("embedded-terminal-launch-preview"),
      ).toHaveCount(0, { timeout: 10_000 });

      await expect
        .poll(async () => (await canvas.boundingBox())?.height ?? 0, { timeout: 5_000 })
        .toBeGreaterThan(0);
    } finally {
      if (taskId) await request.delete(`/api/external/tasks/${encodeURIComponent(taskId)}`).catch(() => {});
      await request.delete(`/api/projects/${p.id}`).catch(() => {});
      await cleanupCwd(cwd);
      await cleanupCwd(projectCwd);
    }
  });
});

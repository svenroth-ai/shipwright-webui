/*
 * iterate-2026-06-15 (terminal-reflow-repaint) — trailing repaint after a
 * width change, end-to-end regression guard.
 *
 * User report (follow-up to PR #146): after the smear fix the terminal is
 * better, but Claude's input box is "manchmal weg oder komisch umgebrochen" —
 * the TUI box border breaks / a stale title cell floats — especially on a
 * smaller monitor.
 *
 * Root cause: Claude's alt-buffer TUI redraws ASYNC after the SIGWINCH from a
 * resize. The WebGL renderer's per-cell dirty detection skips cells whose glyph
 * matches what's already on-screen, but a width change shifted the
 * logical→screen mapping → stale glyphs survive the redraw. Nothing repainted
 * AFTER the async redraw (the ResizeObserver path had no refresh; the
 * focus/visibility path refreshed synchronously, BEFORE Claude's redraw).
 *
 * Fix (useTerminalResize.ts): POST_RESIZE_REPAINT_DELAYS_MS — staggered trailing
 * `term.refresh(0, rows-1)` after every dimension change. This spec proves, in
 * real Chromium, that a width change produces a full-viewport repaint AFTER the
 * synchronous resize settles. (The actual box-border clearing needs Claude's
 * real TUI on a real GPU — manual real-device smoke.)
 *
 * Soft-skip on baseURL unreachable (matches specs 86/87/88/91).
 */

import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { ensureProject, makeTaskCwd, deleteTask } from "../helpers/terminal-selection";

/** Mount a ready embedded terminal WITHOUT launching Claude (bare-shell WS
 *  attach is all this spec needs — no token cost / side-effect). */
async function mountTerminal(
  page: Page,
  request: APIRequestContext,
): Promise<{ cleanup: () => Promise<void> }> {
  const project = await ensureProject(request);
  const cwd = await makeTaskCwd("term-reflow-");
  const created = await request.post("/api/external/tasks", {
    data: { title: "term-reflow spec 92", cwd, projectId: project.projectId },
  });
  expect(created.ok()).toBeTruthy();
  const taskId = ((await created.json()) as { task: { taskId: string } }).task
    .taskId;
  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
    "data-ws-ready",
    "true",
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1_500);
  return {
    cleanup: async () => {
      await deleteTask(request, taskId);
      try {
        const fs = await import("node:fs/promises");
        await fs.rm(cwd, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      await project.cleanup();
    },
  };
}

test.describe("Iterate terminal-reflow-repaint — trailing repaint on width change", () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ request }) => {
    try {
      await request.get("/", { timeout: 5_000 });
    } catch (err) {
      test.skip(
        true,
        `baseURL unreachable (${(err as Error).message}); soft-skipping spec 92.`,
      );
    }
  });

  test("a width change produces a full-viewport repaint AFTER the resize settles", async ({
    page,
    request,
  }) => {
    // Both widths stay >=1024 so TaskDetail keeps the desktop 3-pane (the
    // compact breakpoint is 1023px) and the terminal stays mounted.
    await page.setViewportSize({ width: 1600, height: 900 });
    const { cleanup } = await mountTerminal(page, request);
    try {
      // Arm a probe that counts FULL-viewport refreshes (the repaint signature
      // POST_RESIZE_REPAINT_DELAYS_MS emits); capture the starting grid.
      const before = await page.evaluate(() => {
        const w = window as unknown as {
          __embeddedTerminal: {
            cols: number;
            rows: number;
            refresh(s: number, e: number): void;
          };
          __reflowProbe: { full: number };
        };
        const t = w.__embeddedTerminal;
        w.__reflowProbe = { full: 0 };
        const orig = t.refresh.bind(t);
        t.refresh = (s: number, e: number) => {
          if (s === 0 && e === t.rows - 1) w.__reflowProbe.full += 1;
          return orig(s, e);
        };
        return { cols: t.cols };
      });

      // Shrink the window → the terminal pane reflows to fewer columns.
      await page.setViewportSize({ width: 1100, height: 900 });

      // Read the full-repaint count BEFORE the trailing delay elapses…
      await page.waitForTimeout(60);
      const read = async () =>
        page.evaluate(
          () =>
            (window as unknown as { __reflowProbe: { full: number } })
              .__reflowProbe.full,
        );
      const colsAfter = await page.evaluate(
        () =>
          (window as unknown as { __embeddedTerminal: { cols: number } })
            .__embeddedTerminal.cols,
      );
      const fullBeforeTrailing = await read();
      // …then AFTER it (covers RO throttle 250 + the 130/350ms passes).
      await page.waitForTimeout(900);
      const fullAfterTrailing = await read();

      // Precondition: the shrink actually changed the column count (otherwise
      // no SIGWINCH, and the scenario isn't exercised).
      expect(
        colsAfter,
        "shrinking the window must change the terminal column count",
      ).not.toBe(before.cols);

      // The fix: a full-viewport repaint lands AFTER the synchronous resize —
      // the trailing repaint that clears Claude's async-redraw stale cells.
      expect(
        fullAfterTrailing,
        "a full-viewport repaint must fire AFTER the resize settles (trailing repaint)",
      ).toBeGreaterThan(fullBeforeTrailing);
    } finally {
      await cleanup();
    }
  });
});

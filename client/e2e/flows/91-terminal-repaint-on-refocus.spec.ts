/*
 * iterate-2026-06-14 (terminal-smear-window-focus) — repaint-on-refocus
 * end-to-end regression guard.
 *
 * User report: returning to the Edge window (or navigating back from
 * Triage / a Card / the Inbox) leaves the embedded terminal "verschmiert"
 * (stale WebGL frame / wrapped at the old width). The only remedy was to
 * resize the window slightly — which fires the ResizeObserver refit.
 *
 * Root cause: the WebGL renderer (ADR-099) force-repaints on exactly three
 * triggers — ResizeObserver, tab activation, scroll — none of which fire on
 * window/tab focus regain, visibilitychange, pageshow, or GPU context loss.
 *
 * Fix (useTerminalResize.ts): a visibilitychange/focus/pageshow effect that
 * runs safeFit + term.refresh(0, rows-1) + dedupe-sends the WS resize. This
 * spec proves the listeners are actually wired in the mounted component and
 * fire a FULL-viewport repaint in real Chromium on each event — AND that
 * they re-attach after a route-navigation remount (the Triage/Card/Inbox
 * path). The unit tests (useTerminalResize.test.ts) cover the hidden-tab
 * no-op + disposed-guard + dedupe edges; the actual visual smear clearing
 * is GPU/monitor-dependent and stays a manual real-device smoke.
 *
 * Soft-skip on baseURL unreachable (matches specs 86/87/88).
 */

import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { ensureProject, makeTaskCwd, deleteTask } from "../helpers/terminal-selection";

/**
 * Mount a ready embedded terminal WITHOUT launching Claude. The WS attach
 * (a bare shell pty) is all this spec needs — we test that focus/visibility
 * fire a repaint, not the launch path. Skipping `/launch` avoids spawning a
 * real `claude` process in a temp cwd (token cost + side-effect) and keeps
 * the run fast and contained.
 */
async function mountTerminal(
  page: Page,
  request: APIRequestContext,
): Promise<{ taskId: string; cleanup: () => Promise<void> }> {
  const project = await ensureProject(request);
  const cwd = await makeTaskCwd("term-repaint-");
  const created = await request.post("/api/external/tasks", {
    data: { title: "term-repaint spec 91", cwd, projectId: project.projectId },
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
    taskId,
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

/**
 * Wrap `window.__embeddedTerminal.refresh` with a probe that counts
 * FULL-viewport refreshes (`refresh(0, rows-1)`) — the exact signature the
 * repaint effect emits. Cursor-blink / partial repaints use a narrower
 * row range, so they don't pollute the signal. Resets the counter to 0.
 * Returns false when the hook is absent (terminal not mounted).
 */
async function armRepaintProbe(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __embeddedTerminal?: {
        rows: number;
        refresh(start: number, end: number): void;
      } | null;
      __repaintProbe?: { full: number; armed: boolean };
    };
    const term = w.__embeddedTerminal;
    if (!term) return false;
    if (!w.__repaintProbe?.armed) {
      const orig = term.refresh.bind(term);
      w.__repaintProbe = { full: 0, armed: true };
      term.refresh = (start: number, end: number) => {
        if (start === 0 && end === term.rows - 1) {
          (w.__repaintProbe as { full: number }).full += 1;
        }
        return orig(start, end);
      };
    } else {
      w.__repaintProbe.full = 0;
    }
    return true;
  });
}

async function readFullRepaints(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __repaintProbe?: { full: number } })
        .__repaintProbe?.full ?? -1,
  );
}

async function dispatchWindowEvent(page: Page, type: string): Promise<void> {
  await page.evaluate((t) => window.dispatchEvent(new Event(t)), type);
}

async function dispatchDocEvent(page: Page, type: string): Promise<void> {
  await page.evaluate((t) => document.dispatchEvent(new Event(t)), type);
}

test.describe("Iterate terminal-smear-window-focus — repaint on refocus", () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ request }) => {
    try {
      await request.get("/", { timeout: 5_000 });
    } catch (err) {
      test.skip(
        true,
        `baseURL unreachable (${(err as Error).message}); soft-skipping spec 91.`,
      );
    }
  });

  test("window focus / visibilitychange / pageshow each fire a full-viewport repaint", async ({
    page,
    request,
  }) => {
    const { cleanup } = await mountTerminal(page, request);
    try {
      // Terminal is mounted + ready (mountTerminal waits for ws-ready).
      const armed = await armRepaintProbe(page);
      expect(armed, "__embeddedTerminal hook must be present").toBe(true);

      // --- Scenario 1: window focus (returning to the Edge window) ---
      await page.evaluate(
        () =>
          ((
            window as unknown as { __repaintProbe: { full: number } }
          ).__repaintProbe.full = 0),
      );
      await dispatchWindowEvent(page, "focus");
      await page.waitForTimeout(100);
      expect(
        await readFullRepaints(page),
        "window 'focus' must trigger a full-viewport term.refresh(0, rows-1)",
      ).toBeGreaterThanOrEqual(1);

      // --- Scenario 2: document visibilitychange (tab becomes visible) ---
      await page.evaluate(
        () =>
          ((
            window as unknown as { __repaintProbe: { full: number } }
          ).__repaintProbe.full = 0),
      );
      await dispatchDocEvent(page, "visibilitychange");
      await page.waitForTimeout(100);
      expect(
        await readFullRepaints(page),
        "document 'visibilitychange' (visible) must trigger a full-viewport repaint",
      ).toBeGreaterThanOrEqual(1);

      // --- Scenario 3: pageshow (bfcache restore) ---
      await page.evaluate(
        () =>
          ((
            window as unknown as { __repaintProbe: { full: number } }
          ).__repaintProbe.full = 0),
      );
      await dispatchWindowEvent(page, "pageshow");
      await page.waitForTimeout(100);
      expect(
        await readFullRepaints(page),
        "'pageshow' (bfcache restore) must trigger a full-viewport repaint",
      ).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup();
    }
  });

  test("listeners re-attach after route navigation (Triage/Card/Inbox → task)", async ({
    page,
    request,
  }) => {
    const { taskId, cleanup } = await mountTerminal(page, request);
    try {
      // Navigate AWAY to the board (simulates leaving for Triage/Card/Inbox),
      // then back to the task — this remounts EmbeddedTerminal.
      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible({
        timeout: 30_000,
      });
      await page.goto(`/tasks/${taskId}`);
      const termWrap = page.getByTestId("embedded-terminal");
      await expect(termWrap).toHaveAttribute("data-ws-ready", "true", {
        timeout: 30_000,
      });
      await page.waitForTimeout(1_500);

      // Re-arm against the freshly-remounted terminal and prove the
      // focus listener was re-bound (would be lost if the effect didn't
      // re-run on remount — the exact "coming from Triage" failure).
      const armed = await armRepaintProbe(page);
      expect(armed, "remounted terminal must expose the hook").toBe(true);
      await page.evaluate(
        () =>
          ((
            window as unknown as { __repaintProbe: { full: number } }
          ).__repaintProbe.full = 0),
      );
      await dispatchWindowEvent(page, "focus");
      await page.waitForTimeout(100);
      expect(
        await readFullRepaints(page),
        "after route-navigation remount, window 'focus' must still trigger a repaint",
      ).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup();
    }
  });
});

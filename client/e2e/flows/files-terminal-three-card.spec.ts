/*
 * A18 — Files & Terminal three-card layout around a byte-identical pty.
 *
 * The riskiest screen in the campaign: the middle card hosts the REAL live pty.
 * This flow proves the restyle is paint, not wire:
 *   - the three cards mount with the right surface classes (glass · beige · glass);
 *   - the terminal attaches (first WS `ready` awaited before any click);
 *   - switching Transcript↔Terminal, then MAXIMIZE + restore, never re-attaches
 *     the terminal socket (no remount → same pty session);
 *   - after all that, a plain keystroke still reaches the pty as EXACTLY its own
 *     bytes and nothing else (the byte path is unchanged).
 *
 * The A00 byte-path guard (terminal-byte-path-guard.spec.ts) pins the launch /
 * paste frames; this flow pins that the LAYOUT transitions this iterate adds do
 * not disturb the socket or the keystroke path.
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
import {
  attachWsCapture,
  isTerminalSocket,
  outboundDataFrames,
  outboundUnknownFrames,
} from "../helpers/ws-capture";

let project: SeededProject;

test.describe("@smoke A18 — three-card Files & Terminal (byte-identical pty)", () => {
  let taskId: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "ft-three-card" });
    await setActiveProject(page, project.projectId);
    const task = await seedTask(request, {
      title: "Three-card shell",
      projectId: project.projectId,
    });
    taskId = task.taskId;
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  test("three cards mount, terminal survives tab switch + maximize, keystroke path unchanged", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const cap = attachWsCapture(page);

    await page.goto(`/tasks/${taskId}`);

    // The three cards + their surface classes (glass · beige · glass).
    await expect(page.getByTestId("task-detail-center")).toHaveClass(/ft-term/);
    await expect(page.getByTestId("task-detail-viewer")).toHaveClass(/ft-view/);
    await expect(page.getByTestId("folder-tree")).toHaveClass(/ft-files/);

    // Wait for the first WS to be ready BEFORE any click — a fast click beats the
    // attach → prewarm → manual-send park (StrictMode also aborts the first WS).
    const term = page.getByTestId("embedded-terminal");
    await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 20_000 });
    await expect(term).toHaveAttribute("data-role", "writer", { timeout: 10_000 });

    const socketOpens = () =>
      cap.frames.filter((f) => f.kind === "open" && isTerminalSocket(f.url, taskId)).length;
    const opensBefore = socketOpens();
    expect(opensBefore).toBeGreaterThan(0);

    // Switch Terminal → Transcript → Terminal (Radix tabs; forceMount hides, never
    // unmounts). The pane bodies flip; the terminal stays mounted.
    await page.getByTestId("task-detail-tab-transcript").click();
    await expect(page.getByTestId("task-detail-transcript")).toBeVisible();
    await page.getByTestId("task-detail-tab-terminal").click();
    await expect(term).toHaveAttribute("data-ws-ready", "true");

    // Maximize the terminal (collapses both side cards) then restore.
    await page.getByTestId("terminal-maximize").click();
    await expect(page.getByTestId("pane-left")).toHaveAttribute("data-collapsed", "true");
    await expect(page.getByTestId("pane-right")).toHaveAttribute("data-collapsed", "true");
    await page.getByTestId("terminal-maximize").click();
    await expect(page.getByTestId("pane-left")).not.toHaveAttribute("data-collapsed", "true");

    // SAME SESSION: no new terminal socket was opened by the layout transitions —
    // a remount would have torn down + re-attached the WS.
    await page.waitForTimeout(500);
    expect(socketOpens(), "the terminal socket must NOT re-attach across tab/maximize").toBe(
      opensBefore,
    );
    await expect(term).toHaveAttribute("data-ws-ready", "true");

    // BYTE PATH UNCHANGED: a plain keystroke still reaches the pty as exactly its
    // own byte, one frame, nothing else on the wire.
    await page.getByTestId("embedded-terminal-canvas").click();
    const typedAt = Date.now();
    await page.keyboard.type("x");
    await expect
      .poll(() => outboundDataFrames(cap, taskId, typedAt).map((f) => f.payload).join(""), {
        timeout: 15_000,
        intervals: [150],
      })
      .toBe("x");
    expect(outboundDataFrames(cap, taskId, typedAt).map((f) => f.payload)).toEqual(["x"]);
    expect(outboundUnknownFrames(cap, taskId, typedAt)).toEqual([]);
  });
});

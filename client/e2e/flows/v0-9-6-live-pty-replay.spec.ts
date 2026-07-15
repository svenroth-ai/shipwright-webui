/*
 * Iterate E (ADR-092) — LIVE-pty re-attach regression guard.
 *
 * Promoted from the D-bis probe (`_v0-9-6-live-pty-probe.spec.ts`) when
 * Iterate E shipped the serialize-on-attach + snapshot-on-detach fix.
 * The substantive assertions are unchanged from D-bis; this file's job
 * is now to PASS on E (and any future branch that keeps the fix) and
 * FAIL on any branch that re-introduces the regression.
 *
 * The test answers: when a pty is alive (not exited / killed) and the
 * user navigates away from the task detail and back, is the terminal
 * content preserved?
 *
 * Outcome contract (post-ADR-092):
 *   A - REQUIRED: replay_snapshot envelope on re-attach AND marker text
 *       visible after navigate-back. The serialize-on-attach branch
 *       inside routes.ts WS upgrade emits this even when no disk
 *       snapshot exists.
 *   B - REGRESSION: no replay_snapshot envelope, marker text missing.
 *       This is the original D-bis finding (ADR-091); presence of this
 *       outcome on E or later means the fix was reverted / shadowed.
 *   C - Anomaly: no replay_snapshot but marker text somehow visible
 *       (xterm.js/React keep-alive). Also fails — the contract is
 *       "replay envelope is the load-bearing primitive".
 *
 * Artifacts persisted to client/playwright-report/v0.9.6-live-pty-replay/
 * (renamed from D-bis's `-probe/` dir).
 */

import { cleanupProject, seedLocalStorage, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect, type APIRequestContext, type Page, type WebSocket as PWWebSocket } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

// A00 — was a pinned operator UUID; seeded via the real API in beforeEach.
let project: SeededProject;


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACT_DIR = path.resolve(
  __dirname,
  "../../playwright-report/v0.9.6-live-pty-replay",
);

interface WsFrame {
  type: string;
  rawSlice: string; // first 400 chars
  parsedKeys: string[] | null;
}

interface WsCapture {
  url: string;
  openedAt: number;
  closedAt: number | null;
  frames: WsFrame[];
}

async function makeTaskCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "v096-live-pty-"));
}

async function deleteTask(
  request: APIRequestContext,
  taskId: string,
): Promise<void> {
  try {
    await request.delete(`/api/external/tasks/${encodeURIComponent(taskId)}`);
  } catch {
    /* best-effort */
  }
}

function attachWsCapture(page: Page): WsCapture[] {
  const capture: WsCapture[] = [];
  page.on("websocket", (ws: PWWebSocket) => {
    if (!ws.url().includes("/api/terminal/")) return;
    const entry: WsCapture = {
      url: ws.url(),
      openedAt: Date.now(),
      closedAt: null,
      frames: [],
    };
    capture.push(entry);
    ws.on("framereceived", (frame) => {
      if (typeof frame.payload !== "string") return;
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(frame.payload) as Record<string, unknown>;
      } catch {
        /* ignore non-JSON */
      }
      const type =
        parsed && typeof parsed.type === "string" ? parsed.type : "<no-type>";
      entry.frames.push({
        type,
        rawSlice: frame.payload.slice(0, 400),
        parsedKeys: parsed ? Object.keys(parsed) : null,
      });
    });
    ws.on("close", () => {
      entry.closedAt = Date.now();
    });
  });
  return capture;
}

async function readXtermRows(page: Page): Promise<string[]> {
  // ADR-097 — xterm.js 6.0 + WebGL renderer no longer mirrors text into
  // `.xterm-rows > div` (the renderer paints directly on canvas). Read
  // from the xterm buffer via the `window.__embeddedTerminal` test handle
  // (same mechanism as `readCursorPos`). This matches the production
  // contract — server's M2 fixed-point asserts visible-buffer equality
  // via the identical `translateToString(false)` call.
  return await page.evaluate(() => {
    const w = window as unknown as {
      __embeddedTerminal?: {
        buffer: {
          active: {
            length: number;
            getLine(y: number): { translateToString(trimRight?: boolean): string } | undefined;
          };
        };
      } | null;
    };
    const term = w.__embeddedTerminal;
    if (!term) return [];
    const buf = term.buffer.active;
    const out: string[] = [];
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      out.push(line ? line.translateToString(false) : "");
    }
    return out;
  });
}

async function readCursorPos(page: Page): Promise<{ cursorX: number; cursorY: number; baseY: number; length: number } | null> {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __embeddedTerminal?: {
        buffer: {
          active: {
            length: number;
            baseY: number;
            cursorX: number;
            cursorY: number;
          };
        };
      } | null;
    };
    const term = w.__embeddedTerminal;
    if (!term) return null;
    const buf = term.buffer.active;
    return {
      cursorX: buf.cursorX,
      cursorY: buf.cursorY,
      baseY: buf.baseY,
      length: buf.length,
    };
  });
}

test.describe("Iterate E (ADR-092) — LIVE-pty re-attach regression guard", () => {
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test.setTimeout(180_000);

  // External code review MED #4 — soft-skip when the configured
  // baseURL is unreachable (matches D-bis tailscale policy).
  test.beforeAll(async ({ request }) => {
    try {
      await request.get("/", { timeout: 5_000 });
    } catch (err) {
      test.skip(
        true,
        `baseURL unreachable (${(err as Error).message}); soft-skipping regression guard per ADR-092 § AC #1.`,
      );
    }
  });

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "v0-9-6-live-pty-replay" });
    await setActiveProject(page, project.projectId);
    await seedLocalStorage(page, { "shipwright:terminal-renderer": "dom", "webui:embedded-terminal-default-tab": '"terminal"', });
  });

  test("LIVE pty: type marker, navigate away, navigate back -> outcome A required (ADR-092)", async ({
    page,
    request,
  }) => {
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    const cwd = await makeTaskCwd();
    let taskId: string | undefined;

    try {
      // 1. Create + launch a fresh task. new-task is the simplest probe
      //    target — the matrix covers all four task types.
      const created = await request.post("/api/external/tasks", {
        data: {
          title: "D-bis live-pty probe",
          cwd,
          actionId: "new-task",
          projectId: project.projectId,
        },
      });
      expect(created.ok()).toBeTruthy();
      const cBody = (await created.json()) as { task: { taskId: string } };
      taskId = cBody.task.taskId;

      const launched = await request.post(
        `/api/external/tasks/${encodeURIComponent(taskId)}/launch`,
        { data: { actionId: "new-task" } },
      );
      expect(launched.ok()).toBeTruthy();

      // 2. Attach WS capture BEFORE first navigate so we see all frames
      //    for both connections (first attach + re-attach).
      const wsCapture = attachWsCapture(page);

      // 3. First attach.
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
        "data-ws-ready",
        "true",
        { timeout: 15_000 },
      );
      // Allow pty to spawn + emit prompt.
      await page.waitForTimeout(3_000);

      // 4. Verify a shell prompt is rendered.
      const rowsBeforePrompt = await readXtermRows(page);
      const joined = rowsBeforePrompt.join("\n");
      const hasPrompt = /[\$>#]\s*$|PS\s+.*>\s*$/m.test(joined) || /\$/.test(joined) || /PS /.test(joined);
      if (!hasPrompt) {
        await page.screenshot({ path: path.join(ARTIFACT_DIR, "no-prompt-detected.png") });
        await fs.writeFile(
          path.join(ARTIFACT_DIR, "no-prompt-dom.txt"),
          joined,
          "utf8",
        );
      }

      // 5. Type a deterministic marker. Use the .xterm-screen
      //    (canvas-backed) — click first to focus, then type via
      //    keyboard.
      const MARKER = `MARKER_${Date.now()}`;
      await page.locator('[data-testid="embedded-terminal-canvas"]').click({ timeout: 5_000 }).catch(async () => {
        // Fallback: click any visible xterm element.
        await page.locator(".xterm").first().click();
      });
      await page.keyboard.type(`echo ${MARKER}`, { delay: 30 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1_500);

      // 6. Verify marker is visible.
      const rowsAfterType = await readXtermRows(page);
      const markerSeenPreNav = rowsAfterType.join("\n").includes(MARKER);

      // Capture cursor pos before navigate-away.
      const cursorBefore = await readCursorPos(page);

      // 7. Screenshot pre-navigate.
      await page.getByTestId("embedded-terminal").screenshot({
        path: path.join(ARTIFACT_DIR, "pre-navigate.png"),
      });

      // 8. Navigate AWAY via in-app link click (NOT page.reload — that
      //    is a different code path). The sidebar / taskboard link is
      //    the natural target.
      const beforeFramesCount = wsCapture.reduce((n, c) => n + c.frames.length, 0);
      await page.goto(`/`);
      await page.waitForTimeout(1_500);

      // 9. Navigate BACK to the task. Wait for terminal re-mount.
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
        "data-ws-ready",
        "true",
        { timeout: 15_000 },
      );
      // Allow replay envelopes (if any) to flush.
      await page.waitForTimeout(4_000);

      // 10. Capture post-navigate-back state.
      const rowsAfterNav = await readXtermRows(page);
      const markerSeenPostNav = rowsAfterNav.join("\n").includes(MARKER);
      const cursorAfter = await readCursorPos(page);

      // 11. Screenshot post-navigate-back.
      await page.getByTestId("embedded-terminal").screenshot({
        path: path.join(ARTIFACT_DIR, "post-navigate-back.png"),
      });

      // 12. Inspect WS frames for the post-navigate-back connection.
      //     The last `/api/terminal/<taskId>/ws` connection wins.
      const taskConns = wsCapture.filter((c) =>
        c.url.includes(`/api/terminal/${taskId}/ws`),
      );
      const reattachConn = taskConns.length > 0 ? taskConns[taskConns.length - 1] : null;
      const replaySnapshotEmitted = !!reattachConn?.frames.some((f) => f.type === "replay_snapshot");
      const replayChunkEmitted = !!reattachConn?.frames.some((f) => f.type === "replay_chunk" || f.type === "replay_start");

      // 13. Determine outcome.
      let outcome: "A" | "B" | "C";
      if (markerSeenPostNav && replaySnapshotEmitted) {
        outcome = "A";
      } else if (!markerSeenPostNav && !replaySnapshotEmitted) {
        outcome = "B";
      } else {
        outcome = "C";
      }

      const result = {
        outcome,
        marker: MARKER,
        marker_seen_pre_navigate: markerSeenPreNav,
        marker_seen_post_navigate_back: markerSeenPostNav,
        replay_snapshot_envelope_emitted_on_reattach: replaySnapshotEmitted,
        replay_chunk_envelope_emitted_on_reattach: replayChunkEmitted,
        ws_connection_count: taskConns.length,
        ws_frame_count_before_nav: beforeFramesCount,
        ws_frame_total: wsCapture.reduce((n, c) => n + c.frames.length, 0),
        cursor_before: cursorBefore,
        cursor_after: cursorAfter,
        rows_after_nav_count: rowsAfterNav.length,
        rows_after_nav_excerpt: rowsAfterNav.slice(-8),
      };

      await fs.writeFile(
        path.join(ARTIFACT_DIR, "probe-result.json"),
        JSON.stringify(result, null, 2),
        "utf8",
      );
      await fs.writeFile(
        path.join(ARTIFACT_DIR, "ws-frames.json"),
        JSON.stringify(wsCapture, null, 2),
        "utf8",
      );

      // eslint-disable-next-line no-console
      console.log("E regression-guard result:", JSON.stringify(result, null, 2));

      // 14. Hard assertions — outcome A is the only acceptable result
      //     post-ADR-092. Evidence (probe-result.json + ws-frames.json
      //     + screenshots) is captured BEFORE these assertions so a
      //     failure still leaves diagnostic artifacts on disk.
      expect(result.marker_seen_pre_navigate).toBeTruthy();
      expect(reattachConn).not.toBeNull();
      expect(
        result.marker_seen_post_navigate_back,
        "MARKER lost after navigate-back — ADR-092 fix not in effect",
      ).toBeTruthy();
      expect(
        result.replay_snapshot_envelope_emitted_on_reattach,
        "replay_snapshot envelope missing on re-attach — serialize-on-attach path inactive",
      ).toBeTruthy();
      expect(outcome).toBe("A");
    } finally {
      if (taskId) await deleteTask(request, taskId);
      try {
        await fs.rm(cwd, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});

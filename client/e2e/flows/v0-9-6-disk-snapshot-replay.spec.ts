/*
 * v0-9-6-disk-snapshot-replay.spec.ts — F02 / D02 real-browser guard (GUARD 3).
 *
 * FROZEN GUARD — author ≠ fixer (must-not-modify). RED on pre-fix `main`.
 *
 * Sibling of `v0-9-6-live-pty-replay.spec.ts`. That spec covers the pty-ALIVE
 * navigate-away/back case; THIS spec covers the DEAD-pty case F02 is about:
 * kill the session's pty (POST /api/terminal/:id/close), re-open TaskDetail,
 * and assert the DISK snapshot history is rendered in the ACTUAL xterm — not
 * a blank fresh shell.
 *
 * It lives in its own file (not appended to v0-9-6-live-pty-replay.spec.ts)
 * because that spec is at its bloat baseline (372 LOC, grandfathered); adding
 * a second test would ratchet the baseline, which D02 AC4 forbids. A cohesive
 * sibling spec under 300 LOC is the sanctioned split. The finalizer's F0.5
 * web-surface run + post-merge smoke execute it under the isolated stack.
 *
 * Outcome contract:
 *   PASS (post-fix): marker text visible in the re-attach xterm — the WS
 *     upgrade reads the persisted disk snapshot when no live pty exists.
 *   FAIL (pre-fix / regressed): marker missing — buildLiveHandlers spawned a
 *     fresh empty mirror that shadowed tryReadSnapshot (F02).
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
  "../../playwright-report/v0.9.6-disk-snapshot-replay",
);

interface WsFrame {
  type: string;
  rawSlice: string;
}
interface WsCapture {
  url: string;
  frames: WsFrame[];
  /** FULL payloads of replay_snapshot frames — the disk-history assertion
   *  checks the serialized cell-state carries the marker (a 400-char slice
   *  would miss a marker past the shell banner in the serialized buffer). */
  replayPayloads: string[];
}

function attachWsCapture(page: Page): WsCapture[] {
  const capture: WsCapture[] = [];
  page.on("websocket", (ws: PWWebSocket) => {
    if (!ws.url().includes("/api/terminal/")) return;
    const entry: WsCapture = { url: ws.url(), frames: [], replayPayloads: [] };
    capture.push(entry);
    ws.on("framereceived", (frame) => {
      if (typeof frame.payload !== "string") return;
      let type = "<no-type>";
      try {
        const parsed = JSON.parse(frame.payload) as { type?: string };
        if (typeof parsed.type === "string") type = parsed.type;
      } catch {
        /* ignore non-JSON */
      }
      if (type === "replay_snapshot") entry.replayPayloads.push(frame.payload);
      entry.frames.push({ type, rawSlice: frame.payload.slice(0, 400) });
    });
  });
  return capture;
}

async function readXtermRows(page: Page): Promise<string[]> {
  // ADR-097 — xterm.js 6.0 + WebGL paints on canvas; read the buffer via the
  // `window.__embeddedTerminal` test handle (same as the live-pty spec).
  return await page.evaluate(() => {
    const w = window as unknown as {
      __embeddedTerminal?: {
        buffer: {
          active: {
            length: number;
            getLine(y: number): { translateToString(t?: boolean): string } | undefined;
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

async function deleteTask(request: APIRequestContext, taskId: string): Promise<void> {
  try {
    await request.delete(`/api/external/tasks/${encodeURIComponent(taskId)}`);
  } catch {
    /* best-effort */
  }
}

async function waitTerminalReady(page: Page): Promise<void> {
  await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
    "data-ws-ready",
    "true",
    { timeout: 15_000 },
  );
}

test.describe("F02/D02 (GUARD 3) — kill-pty-then-reattach replays the disk snapshot", () => {
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test.setTimeout(180_000);

  test.beforeAll(async ({ request }) => {
    try {
      await request.get("/", { timeout: 5_000 });
    } catch (err) {
      const reason = `baseURL unreachable (${(err as Error).message})`;
      // MAX-gate enforcement: when the finalizer's F0.5 web-surface run / the
      // post-merge smoke set SHIPWRIGHT_E2E_REQUIRE_STACK=1, a missing stack is
      // a HARD FAILURE — a silent skip would let the required gate pass vacuously.
      if (process.env.SHIPWRIGHT_E2E_REQUIRE_STACK === "1") {
        throw new Error(`${reason} — GUARD 3 is a required MAX gate (SHIPWRIGHT_E2E_REQUIRE_STACK=1)`);
      }
      // Casual local run without the flag: soft-skip, matching the sibling spec.
      test.skip(true, `${reason}; soft-skipping GUARD 3.`);
    }
  });

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "v0-9-6-disk-snapshot-replay" });
    await setActiveProject(page, project.projectId);
    await seedLocalStorage(page, { "shipwright:terminal-renderer": "dom", "webui:embedded-terminal-default-tab": '"terminal"' });
  });

  test("kill session pty, re-open TaskDetail -> disk history (marker) is rendered", async ({
    page,
    request,
  }) => {
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "v096-disk-snap-"));
    let taskId: string | undefined;

    try {
      // 1. Create + launch a fresh task (real ConPTY).
      const created = await request.post("/api/external/tasks", {
        data: {
          title: "D02 disk-snapshot replay guard",
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

      const wsCapture = attachWsCapture(page);

      // 2. First attach; wait for the shell prompt.
      await page.goto(`/tasks/${taskId}`);
      await waitTerminalReady(page);
      await page.waitForTimeout(3_000);

      // 3. Type a deterministic marker into the live shell.
      const MARKER = `DISKMARK_${Date.now()}`;
      await page
        .locator('[data-testid="embedded-terminal-canvas"]')
        .click({ timeout: 5_000 })
        .catch(async () => {
          await page.locator(".xterm").first().click();
        });
      await page.keyboard.type(`echo ${MARKER}`, { delay: 30 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1_500);

      const rowsBeforeKill = await readXtermRows(page);
      const markerSeenPreKill = rowsBeforeKill.join("\n").includes(MARKER);
      await page.getByTestId("embedded-terminal").screenshot({
        path: path.join(ARTIFACT_DIR, "pre-kill.png"),
      });

      // 4. Kill the session's pty. ADR-068-A1: finalizeMirrorSnapshot
      //    persists the rich <taskId>.snapshot to disk; no live pty remains.
      const closed = await request.post(
        `/api/terminal/${encodeURIComponent(taskId)}/close`,
      );
      expect([200, 204]).toContain(closed.status());
      // Let the fire-and-forget finalize snapshot write land.
      await page.waitForTimeout(2_500);

      // 5. Navigate away (closes conn #1) then back (re-attach = conn #2).
      //    The WS upgrade spawns a FRESH pty because the task is non-done —
      //    exactly the F02 code path.
      await page.goto(`/`);
      await page.waitForTimeout(1_500);
      await page.goto(`/tasks/${taskId}`);
      await waitTerminalReady(page);
      // Allow the replay envelope (if any) to flush into xterm.
      await page.waitForTimeout(4_000);

      // 6. Read the re-attach xterm + WS frames.
      const rowsAfterReattach = await readXtermRows(page);
      const markerSeenPostReattach = rowsAfterReattach.join("\n").includes(MARKER);
      const taskConns = wsCapture.filter((c) =>
        c.url.includes(`/api/terminal/${taskId}/ws`),
      );
      const reattachConn = taskConns.length > 0 ? taskConns[taskConns.length - 1] : null;
      const replaySnapshotEmitted = !!reattachConn?.frames.some(
        (f) => f.type === "replay_snapshot",
      );
      // The replay PATH ran AND carried the disk history: a replay_snapshot
      // frame whose serialized payload contains the marker. Distinguishes disk
      // replay from the marker re-appearing via post-respawn shell echo.
      const reattachReplayHasMarker =
        !!reattachConn?.replayPayloads.some((p) => p.includes(MARKER));
      await page.getByTestId("embedded-terminal").screenshot({
        path: path.join(ARTIFACT_DIR, "post-reattach.png"),
      });

      const result = {
        marker: MARKER,
        marker_seen_pre_kill: markerSeenPreKill,
        marker_seen_post_reattach: markerSeenPostReattach,
        replay_snapshot_emitted_on_reattach: replaySnapshotEmitted,
        reattach_replay_snapshot_carries_marker: reattachReplayHasMarker,
        ws_connection_count: taskConns.length,
        rows_after_reattach_excerpt: rowsAfterReattach.slice(-10),
      };
      await fs.writeFile(
        path.join(ARTIFACT_DIR, "result.json"),
        JSON.stringify(result, null, 2),
        "utf8",
      );
      // eslint-disable-next-line no-console
      console.log("GUARD 3 result:", JSON.stringify(result, null, 2));

      // 7. Hard assertions. The marker being visible after a kill+reattach is
      //    the load-bearing RED discriminator: pre-fix the fresh empty mirror
      //    shadows the disk snapshot, so the marker is absent (blank shell).
      expect(result.marker_seen_pre_kill).toBeTruthy();
      expect(reattachConn, "no re-attach WS connection observed").not.toBeNull();
      expect(
        result.marker_seen_post_reattach,
        "MARKER lost after kill+reattach — F02 disk-snapshot fallback not in effect",
      ).toBeTruthy();
      // Prove the replay PATH carried the disk history (not shell echo).
      expect(
        result.reattach_replay_snapshot_carries_marker,
        "reattach replay_snapshot frame did not carry the disk history (marker) — replay path did not serve the persisted snapshot",
      ).toBeTruthy();
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

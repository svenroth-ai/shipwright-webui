/*
 * Spec — dropped WS bytes are resynced, not painted over
 * (iterate-2026-07-30-terminal-ws-drop-resync, FR-01.28)
 * ================================================================================
 *
 * Regression guard for smear mechanism #3. Mechanisms #1 (WebGL glyph atlas,
 * CLAUDE.md rule 28) and #2 (post-replay redraw nudge, rule 29) are closed; this is
 * the divergence SOURCE they both fed on and neither could fix.
 *
 * `PtyManager.deliverWithBackpressure` discards a pty chunk when the WS already has
 * more than `wsBufferBytes` queued, and NEVER resends it. Claude Code repaints
 * DIFFERENTIALLY — CUP to address a row, then `ESC [ 1 C` (CUF) to skip cells it
 * believes correct — and CUF does not erase, so every later repaint leaves stale
 * characters on the hole. Where the drop lands at the end of a burst (a table),
 * nothing repaints afterwards and it never heals.
 *
 * No repaint can fix this: the browser never received those bytes, and only the
 * server's mirror still has them. So the repair is a RESYNC — re-apply the whole
 * grid — and emphatically not a tenth repaint/refresh heal.
 *
 * What this real-browser spec proves (the WIRING, which unit tests cannot):
 *   1. the SERVER half — a `resync` frame on a live socket is answered with a fresh
 *      `replay_snapshot`, and is served even to a READER (a reader's grid is holed
 *      by a drop exactly like a writer's, and resync never WRITES to the pty);
 *   2. the CLIENT half — an inbound `backpressure` notice reporting real loss
 *      produces exactly one outbound `resync`, coalesced;
 *   3. a notice reporting NO loss produces none;
 *   4. the byte-path fence still holds — no other new outbound frame types.
 *
 * Mechanism-level proofs live in unit tests, deliberately: the drop→stale-character
 * causation and the byte-exact convergence in
 * `server/src/terminal/snapshot-parser-resync.test.ts`, the countability of the loss
 * in `backpressure-telemetry.test.ts`, the ordering invariant (buffered output is
 * flushed AFTER the snapshot, or the repair drops the bytes it exists to restore) in
 * `ws-resync.test.ts`.
 *
 * The definitive visual proof — no stale glyphs on a live Claude TUI under real
 * saturation — needs an authenticated Claude session and is the user's
 * confirmation; the isolated stack has no Claude auth.
 */

import { test, expect } from "@playwright/test";

import { tryParseEnvelope, ALLOWED_OUTBOUND_TYPES } from "../helpers/ws-capture";
import {
  cleanupCwd,
  cleanupTask,
  createTask,
  makeTaskCwd,
} from "../helpers/task-fixture";

async function gotoTerminal(page: import("@playwright/test").Page, taskId: string) {
  await page.goto(`/tasks/${taskId}`);
  const term = page.getByTestId("embedded-terminal");
  await expect(term).toBeVisible({ timeout: 30_000 });
  await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 30_000 });
}

test.describe("terminal drop resync", () => {
  test.setTimeout(180_000);

  test("the server answers a resync frame with a fresh replay_snapshot", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd("drop-resync-server-");
    let taskId = "";
    try {
      taskId = await createTask(request, cwd, `resync server ${Date.now()}`);

      // Attach the UI first so it owns the WRITER slot; the raw probe below is
      // therefore a READER, which is the case that must NOT be gated.
      await gotoTerminal(page, taskId);
      await page.keyboard.type("echo resync-probe");
      await page.waitForTimeout(1_500);

      /*
       * The ATTACH itself may replay a snapshot, so counting "any snapshot" would
       * pass with no resync support at all. The request is therefore sent only after
       * the attach has settled, and the assertion demands a snapshot that arrives
       * strictly AFTER it.
       */
      const result = await page.evaluate(
        ({ id }) =>
          new Promise<{
            snapshotsBeforeResync: number;
            snapshotsAfterResync: number;
            readOnly: boolean;
            role: string | null;
          }>((resolve, reject) => {
            const ws = new WebSocket(
              `ws://${window.location.host}/api/terminal/${encodeURIComponent(id)}/ws`,
            );
            let role: string | null = null;
            let readOnly = false;
            let snapshots = 0;
            let beforeResync = -1;
            const finish = () => {
              try {
                ws.close();
              } catch {
                /* already closing */
              }
              resolve({
                snapshotsBeforeResync: beforeResync < 0 ? snapshots : beforeResync,
                snapshotsAfterResync: beforeResync < 0 ? 0 : snapshots - beforeResync,
                readOnly,
                role,
              });
            };
            const overall = setTimeout(finish, 25_000);
            ws.addEventListener("message", (ev) => {
              let env: { type?: string; role?: string };
              try {
                env = JSON.parse(ev.data as string);
              } catch {
                return;
              }
              if (env.type === "ready") {
                role = env.role ?? null;
                // Let the attach's own replay land, THEN ask for a resync.
                setTimeout(() => {
                  beforeResync = snapshots;
                  ws.send(JSON.stringify({ type: "resync" }));
                }, 3_000);
                return;
              }
              if (env.type === "read_only") {
                readOnly = true;
                return;
              }
              if (env.type === "replay_snapshot") {
                snapshots += 1;
                if (beforeResync >= 0 && snapshots > beforeResync) {
                  clearTimeout(overall);
                  finish();
                }
              }
            });
            ws.addEventListener("error", () => {
              clearTimeout(overall);
              reject(new Error("ws error"));
            });
          }),
        { id: taskId },
      );

      expect(
        result.snapshotsAfterResync,
        `a resync must be answered with a FRESH replay_snapshot (attach sent ${result.snapshotsBeforeResync})`,
      ).toBeGreaterThan(0);
      expect(
        result.readOnly,
        "resync never WRITES to the pty — it must NOT be writer-gated, or readers stay smeared",
      ).toBe(false);
      expect(result.role, "the UI holds the writer slot, so this probe is a reader").toBe(
        "reader",
      );
    } finally {
      if (taskId) await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("a backpressure notice makes the client request exactly one resync", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd("drop-resync-client-");
    let taskId = "";
    try {
      taskId = await createTask(request, cwd, `resync client ${Date.now()}`);

      /*
       * Saturating a real socket on demand is not reproducible in a browser test, so
       * the SERVER's notice is injected while everything else stays real — the route
       * relays both directions to the actual server and only ADDS frames inbound.
       *
       * Client frames are collected in the route handler rather than via
       * `attachWsCapture`: a routed socket is served by Playwright's in-page mock, so
       * `page.on("websocket")` does not observe it. `ws.onMessage` is the client's
       * outbound stream by definition, which is exactly what needs asserting.
       */
      const clientFrames: string[] = [];
      let injectLoss = false;

      await page.routeWebSocket(/\/api\/terminal\/.*\/ws/, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((m) => {
          if (typeof m === "string") clientFrames.push(m);
          server.send(m);
        });
        server.onMessage((m) => {
          ws.send(m);
          if (typeof m !== "string" || tryParseEnvelope(m)?.type !== "ready") return;
          if (!injectLoss) {
            // A notice reporting nothing lost has no hole to repair.
            ws.send(
              JSON.stringify({
                type: "backpressure",
                droppedBytes: 0,
                droppedChunks: 0,
                totalDroppedBytes: 0,
                episode: 0,
                episodeEnded: true,
              }),
            );
            return;
          }
          // One saturation episode: an opening notice plus four updates, the last
          // closing it with the accurate total.
          for (let i = 0; i < 5; i++) {
            ws.send(
              JSON.stringify({
                type: "backpressure",
                droppedBytes: 2048 * (i + 1),
                droppedChunks: i + 1,
                totalDroppedBytes: 2048 * (i + 1),
                episode: 1,
                episodeEnded: i === 4,
              }),
            );
          }
        });
      });

      const typesSent = () =>
        clientFrames
          .map((f) => tryParseEnvelope(f)?.type)
          .filter((t): t is string => typeof t === "string");

      await gotoTerminal(page, taskId);
      await page.waitForTimeout(2_500);
      expect(
        typesSent().filter((t) => t === "resync"),
        "a notice reporting no loss has no hole to repair",
      ).toHaveLength(0);

      // Re-attach with real losses injected.
      injectLoss = true;
      clientFrames.length = 0;
      await page.goto("/");
      await page.waitForTimeout(500);
      await gotoTerminal(page, taskId);
      await page.waitForTimeout(3_000);

      const resyncs = clientFrames
        .map((f) => tryParseEnvelope(f))
        .filter((e): e is Record<string, unknown> => e?.type === "resync");
      expect(
        resyncs.length,
        `five notices in one episode must coalesce into ONE resync; sent=${JSON.stringify(typesSent())}`,
      ).toBe(1);
      expect(resyncs[0]).toEqual({ type: "resync" });

      // Fence: the client grew no OTHER new way to talk to the pty. Uses the SHARED
      // allowlist rather than a local copy, so a new frame type has exactly one
      // place to be declared (and `ping` cannot make this flaky).
      const unknown = typesSent().filter(
        (t) => !(ALLOWED_OUTBOUND_TYPES as readonly string[]).includes(t),
      );
      expect(unknown, "unexpected outbound frame types").toEqual([]);
    } finally {
      if (taskId) await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});

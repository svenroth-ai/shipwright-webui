/*
 * iterate-2026-05-17 — fix-resume-guard-survives-reload (F0.5 web surface).
 *
 * The one-shot auto-inject guard (`launchInjectedThisPtyLifetimeRef`) is
 * in-memory per EmbeddedTerminal mount. A browser reload remounts the
 * component with a fresh `false` guard, while the SERVER pty persists
 * (ADR-068-A1 — detach never kills the pty; only POST /close or the
 * 30-min idle ceiling do). Before the fix, the first post-reload launch
 * auto-injected `claude --resume …` straight into the still-live Claude
 * session.
 *
 * The fix surfaces a `ptyReused` boolean on the WS `ready` envelope
 * (true when the attach reused a pre-existing pty) and arms the guard
 * from it. This spec verifies the SERVER half end-to-end through a real
 * browser, real WebSocket and real node-pty:
 *
 *   - the FIRST WS attach ever (no pty existed) reports `ptyReused:false`
 *   - the SECOND WS attach — re-attaching to the pty that persisted
 *     across the first connection's detach — reports `ptyReused:true`
 *     WHEN the first connection typed something. That re-attach is the
 *     server-side equivalent of a browser reload remounting EmbeddedTerminal.
 *   - a PASSIVE first attach (nothing typed) leaves the second attach at
 *     `ptyReused:false` (iterate-2026-08-16-task-lifecycle-ux-fixes: the
 *     flag is sourced from `hadDataWritten`, not from a writer-attach latch,
 *     so revisiting a never-launched task is not mistaken for a live session).
 *
 * Two raw `new WebSocket()` probes are used (not the React component)
 * deliberately: the raw probes are single, fully-controlled connections
 * with no React.StrictMode double-mount, so the false→true transition is
 * deterministic. The client half (guard arms → the launch parks behind
 * the explicit "Send to terminal" confirm) is locked by the
 * EmbeddedTerminal + useTerminalSocket component tests.
 */

import { test, expect } from "@playwright/test";
import { cleanupTaskCwd, seedTask } from "../helpers/fixtures";

/**
 * Open a raw WebSocket to /api/terminal/:taskId/ws from the browser
 * context (so the loopback Origin gate sees the same Origin the page
 * uses), wait for the `ready` envelope, then close. Returns the parsed
 * envelope. No React, no StrictMode — a single deterministic attach.
 * With `typeInput` the connection (the writer) sends one keystroke frame
 * before closing, which is what latches `hadDataWritten` server-side.
 */
async function probeReadyEnvelope(
  page: import("@playwright/test").Page,
  taskId: string,
  typeInput = false,
): Promise<{ status: string; ptyReused: unknown }> {
  return await page.evaluate(async ([id, type]: [string, boolean]) => {
    return await new Promise<{ status: string; ptyReused: unknown }>(
      (resolve) => {
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(
          `${proto}//${location.host}/api/terminal/${id}/ws`,
        );
        const timeout = setTimeout(() => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          resolve({ status: "timeout", ptyReused: undefined });
        }, 8000);
        ws.addEventListener("message", (evt) => {
          try {
            const parsed = JSON.parse(
              typeof evt.data === "string" ? evt.data : "",
            ) as { type?: string; ptyReused?: unknown };
            if (parsed && parsed.type === "ready") {
              clearTimeout(timeout);
              if (type) ws.send(JSON.stringify({ type: "data", payload: "\r" }));
              // Give the server a beat to process the frame before the detach.
              setTimeout(() => {
                ws.close();
                resolve({ status: "open", ptyReused: parsed.ptyReused });
              }, type ? 400 : 0);
            }
          } catch {
            /* ignore non-JSON payloads */
          }
        });
        ws.addEventListener("error", () => {
          clearTimeout(timeout);
          resolve({ status: "error", ptyReused: undefined });
        });
      },
    );
  }, [taskId, typeInput] as [string, boolean]);
}

test.describe("fix-resume-guard-survives-reload — reused-pty ready signal", () => {
  test("ready envelope: ptyReused=false on the first attach, true on re-attach to a pty that was typed into", async ({
    page,
    request,
  }) => {
    const task = await seedTask(request, { title: "resume-guard-survives-reload-e2e" });
    try {
      // Land on the board — no EmbeddedTerminal mounts here, so nothing
      // pre-spawns this task's pty before the probes run.
      await page.goto("/");

      // Attach #1 — no pty existed; this WS upgrade spawns a fresh one, and the
      // writer types a keystroke (what a launch / the user does).
      const first = await probeReadyEnvelope(page, task.taskId, true);
      expect(first.status).toBe("open");
      expect(first.ptyReused).toBe(false);

      // Attach #2 — the pty persisted across attach #1's detach
      // (ADR-068-A1: detach never kills the pty) and has real input in it.
      // Re-attaching is exactly what a browser reload remounting
      // EmbeddedTerminal does; the server must report the reused pty so the
      // client arms its one-shot inject guard.
      const second = await probeReadyEnvelope(page, task.taskId);
      expect(second.status).toBe("open");
      expect(second.ptyReused).toBe(true);
    } finally {
      await cleanupTaskCwd(request, task);
    }
  });

  test("a passive first attach (nothing typed) does not mark the pty as reused", async ({
    page,
    request,
  }) => {
    const task = await seedTask(request, { title: "resume-guard-passive-attach-e2e" });
    try {
      await page.goto("/");
      const first = await probeReadyEnvelope(page, task.taskId);
      expect(first.ptyReused).toBe(false);
      const second = await probeReadyEnvelope(page, task.taskId);
      expect(second.status).toBe("open");
      expect(second.ptyReused).toBe(false);
    } finally {
      await cleanupTaskCwd(request, task);
    }
  });
});

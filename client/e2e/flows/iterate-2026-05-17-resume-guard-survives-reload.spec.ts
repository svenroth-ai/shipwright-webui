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
 *     across the first connection's detach — reports `ptyReused:true`.
 *     That re-attach is the server-side equivalent of a browser reload
 *     remounting EmbeddedTerminal.
 *
 * Two raw `new WebSocket()` probes are used (not the React component)
 * deliberately: the raw probes are single, fully-controlled connections
 * with no React.StrictMode double-mount, so the false→true transition is
 * deterministic. The client half (guard arms → the launch parks behind
 * the explicit "Send to terminal" confirm) is locked by the
 * EmbeddedTerminal + useTerminalSocket component tests.
 */

import { test, expect } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

async function makeTaskCwd(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "resume-guard-reload-e2e-"));
}

async function cleanupCwd(dir: string): Promise<void> {
  // Windows: a freshly-spawned pty keeps the cwd open until it exits.
  // Best-effort with retries; leftover tmpdir bytes are acceptable.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

async function createTask(
  request: import("@playwright/test").APIRequestContext,
  cwd: string,
): Promise<string> {
  const res = await request.post("/api/external/tasks", {
    data: { title: "resume-guard-survives-reload-e2e", cwd },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

/**
 * Open a raw WebSocket to /api/terminal/:taskId/ws from the browser
 * context (so the loopback Origin gate sees the same Origin the page
 * uses), wait for the `ready` envelope, then close. Returns the parsed
 * envelope. No React, no StrictMode — a single deterministic attach.
 */
async function probeReadyEnvelope(
  page: import("@playwright/test").Page,
  taskId: string,
): Promise<{ status: string; ptyReused: unknown }> {
  return await page.evaluate(async (id: string) => {
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
              ws.close();
              resolve({ status: "open", ptyReused: parsed.ptyReused });
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
  }, taskId);
}

test.describe("fix-resume-guard-survives-reload — reused-pty ready signal", () => {
  test("ready envelope: ptyReused=false on the first attach, true on re-attach to the persisted pty", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      // Land on the board — no EmbeddedTerminal mounts here, so nothing
      // pre-spawns this task's pty before the probes run.
      await page.goto("/");

      // Attach #1 — no pty existed; this WS upgrade spawns a fresh one.
      const first = await probeReadyEnvelope(page, taskId);
      expect(first.status).toBe("open");
      expect(first.ptyReused).toBe(false);

      // Attach #2 — the pty persisted across attach #1's detach
      // (ADR-068-A1: detach never kills the pty). Re-attaching to it is
      // exactly what a browser reload remounting EmbeddedTerminal does;
      // the server must report the reused pty so the client arms its
      // one-shot inject guard.
      const second = await probeReadyEnvelope(page, taskId);
      expect(second.status).toBe("open");
      expect(second.ptyReused).toBe(true);
    } finally {
      await cleanupCwd(cwd);
    }
  });
});

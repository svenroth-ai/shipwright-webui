/*
 * Flow — embedded-terminal WS liveness on tab refocus.
 * iterate-2026-06-18-terminal-ws-reconnect-refocus.
 *
 * Deterministic browser-observable slice of the fix: when the user returns
 * to the tab, the client sends an app-level `{type:"ping"}` liveness probe and
 * the server replies `{type:"pong"}` (handled before the role gate). This is
 * the wire that lets a returning client detect + recover a silently-dead
 * socket (the full sleep/Tailscale partition recovery is not deterministically
 * E2E-reproducible and is covered by unit tests on both ends + a manual smoke).
 *
 * Targets the live stack (127.0.0.1:3847 backend + vite by default; override
 * with WEBUI_API_URL). Creates + cleans up its own task. Modelled on
 * 76-autolaunch-reader-writer-race.spec.ts + the ws-capture helper.
 */
import { seedLocalStorage } from "../helpers/fixtures";
import { API_BASE } from "../helpers/env";
import { test, expect } from "@playwright/test";
import {
  attachWsCapture,
  awaitFrame,
  isTerminalSocket,
  tryParseEnvelope,
} from "../helpers/ws-capture";

const API = API_BASE;

test.describe("Terminal WS liveness — refocus ping/pong", () => {
  test.setTimeout(120_000);

  test("a tab refocus sends a liveness ping and the server replies pong", async ({
    page,
    request,
  }) => {
    // Use the first real project so the task's cwd is a valid spawn dir.
    const projResp = await request.get(`${API}/api/projects`);
    expect(projResp.ok()).toBeTruthy();
    const projBody = (await projResp.json()) as {
      data?: Array<{ id: string; path?: string }>;
    };
    const project = projBody.data?.[0];
    const projectId = project?.id ?? "unassigned";
    const cwd = project?.path ?? process.cwd();

    const title = `ws-liveness-e2e-${Date.now()}`;
    const createResp = await request.post(`${API}/api/external/tasks`, {
      data: { title, cwd, projectId },
    });
    expect(createResp.ok()).toBeTruthy();
    const { task } = (await createResp.json()) as { task: { taskId: string } };
    const taskId = task.taskId;

    try {
      const cap = attachWsCapture(page);
      await seedLocalStorage(page, { "webui.activeProjectId": projectId });

      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible({ timeout: 15_000 });

      // Open the task → embedded terminal mounts → WS connects (shell pty).
      const card = page.getByTestId(`task-card-${taskId}`);
      await expect(card).toBeVisible({ timeout: 10_000 });
      await card.getByTestId("terminal-launch-solid-launch").click();

      // The embedded terminal reports ws-ready once the server `ready`
      // envelope has arrived on the terminal WS.
      const term = page.getByTestId("embedded-terminal");
      await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 30_000 });

      const ready = await awaitFrame(
        page,
        cap,
        (f, env) =>
          f.kind === "rx" && isTerminalSocket(f.url, taskId) && env?.type === "ready",
        { timeoutMs: 30_000 },
      );
      expect(ready, "terminal WS ready frame").not.toBeNull();
      const markerTs = Date.now();

      // Return to the tab: the refocus handler fires an eager liveness probe.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));

      // 1) The client sends a `{type:"ping"}` probe frame after the refocus.
      const ping = await awaitFrame(
        page,
        cap,
        (f, env) =>
          f.kind === "tx" &&
          f.ts >= markerTs &&
          isTerminalSocket(f.url, taskId) &&
          env?.type === "ping",
        { timeoutMs: 15_000 },
      );
      expect(ping, "refocus liveness ping (tx)").not.toBeNull();

      // 2) The server replies `{type:"pong"}` — proving the wire that lets a
      //    returning client confirm/recover liveness.
      const pong = await awaitFrame(
        page,
        cap,
        (f, env) =>
          f.kind === "rx" &&
          f.ts >= markerTs &&
          isTerminalSocket(f.url, taskId) &&
          env?.type === "pong",
        { timeoutMs: 15_000 },
      );
      expect(pong, "server pong reply (rx)").not.toBeNull();

      // 3) The healthy socket is NOT closed by the probe (pong answered in time).
      const closedAfter = cap.frames.some(
        (f) => f.kind === "close" && isTerminalSocket(f.url, taskId) && f.ts >= markerTs,
      );
      expect(closedAfter, "healthy socket must stay open after a probe").toBe(false);
      await expect(term).toHaveAttribute("data-ws-ready", "true");

      // Sanity: the pong is a well-formed envelope.
      expect(tryParseEnvelope(pong!.frame.text)).toEqual({ type: "pong" });
    } finally {
      await request
        .delete(`${API}/api/external/tasks/${encodeURIComponent(taskId)}`)
        .catch(() => undefined);
    }
  });
});

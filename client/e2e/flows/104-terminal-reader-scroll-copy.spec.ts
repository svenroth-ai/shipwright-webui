/*
 * Spec 104 — a read-only reader's scroll/copy gesture reaches the pty
 * (iterate-2026-08-24-terminal-readonly-scroll-copy).
 *
 * Bug report: "wenn das Terminal aktuell auf Read only ist ... erlaubt es kein
 * Scrolling mehr und es erlaubt auch kein Copy mehr" — a second tab/browser
 * attached to the same task (a genuine reader) could not scroll or copy inside
 * a live TUI, reported as feeling "frozen" rather than merely read-only.
 *
 * Root cause: Claude's live TUI runs alt-screen + any-motion mouse tracking
 * (`?1003h`), so BOTH scroll-wheel and text-selection-for-copy are implemented
 * by the app reading SGR mouse reports from its stdin — xterm has no local
 * scrollback of its own in that mode. The server's writer gate blocked EVERY
 * `data` message from a non-writer, including these reports, so a reader could
 * neither scroll nor trigger Claude's own OSC 52 copy relay.
 *
 * Fix: the client classifies an SGR mouse report into a distinct `mouse`
 * envelope (`terminal-mouse-report.ts`); the server (`ws-upgrade-handler.ts`)
 * re-validates the payload shape itself and honours it for BOTH roles, while a
 * real keystroke still classifies as `data` and stays writer-gated.
 *
 * What this real-browser spec proves (the WIRING, which the mocked-xterm unit
 * tests cannot): a SECOND, raw WS connection to a task the UI already holds as
 * writer is genuinely handed role "reader" by the real server, and on THAT
 * SAME connection a `mouse` frame is let through (no `read_only`) while a
 * `data` frame on the identical connection still gets `read_only` — proving
 * the exception is real AND narrow, exactly the user's own framing
 * ("read-only, not frozen" — scroll/copy should work, typing should not).
 *
 * Pattern mirrors 97-terminal-drop-resync.spec.ts's "raw WS probe as reader"
 * shape: attach the UI first so it owns the writer slot, then a page.evaluate
 * WebSocket is unambiguously the second (reader) connection.
 */

import { test, expect } from "@playwright/test";

import { cleanupCwd, cleanupTask, createTask, makeTaskCwd } from "../helpers/task-fixture";

async function gotoTerminal(page: import("@playwright/test").Page, taskId: string) {
  await page.goto(`/tasks/${taskId}`);
  const term = page.getByTestId("embedded-terminal");
  await expect(term).toBeVisible({ timeout: 30_000 });
  await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 30_000 });
}

test.describe("@smoke terminal reader scroll/copy exception", () => {
  test.setTimeout(120_000);

  test("a reader's SGR mouse report bypasses the writer gate; a real keystroke on the SAME connection still does not", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd("reader-scroll-copy-");
    let taskId = "";
    try {
      taskId = await createTask(request, cwd, `reader scroll/copy ${Date.now()}`);

      // Attach the UI first so it owns the WRITER slot; the raw probe below is
      // therefore unambiguously a READER — the exact case that must NOT be
      // gated for a `mouse` frame, and must STILL be gated for a `data` frame.
      await gotoTerminal(page, taskId);
      await page.waitForTimeout(1_000);

      const result = await page.evaluate(
        ({ id }) =>
          new Promise<{
            role: string | null;
            mouseGotReadOnly: boolean;
            dataGotReadOnly: boolean;
          }>((resolve, reject) => {
            const ESC = String.fromCharCode(27);
            const ws = new WebSocket(
              `ws://${window.location.host}/api/terminal/${encodeURIComponent(id)}/ws`,
            );
            let role: string | null = null;
            let mouseGotReadOnly = false;
            let dataGotReadOnly = false;
            let phase: "await-ready" | "await-mouse-reply" | "await-data-reply" | "done" =
              "await-ready";

            const finish = () => {
              try {
                ws.close();
              } catch {
                /* already closing */
              }
              resolve({ role, mouseGotReadOnly, dataGotReadOnly });
            };
            const overall = setTimeout(finish, 30_000);

            ws.addEventListener("message", (ev) => {
              let env: { type?: string; role?: string };
              try {
                env = JSON.parse(ev.data as string);
              } catch {
                return;
              }
              if (env.type === "ready" && phase === "await-ready") {
                role = env.role ?? null;
                phase = "await-mouse-reply";
                // A wheel-down report — the exact shape a real scroll gesture
                // produces (touch-scroll.ts / xterm's own wheel binding).
                ws.send(JSON.stringify({ type: "mouse", payload: ESC + "[<64;10;5M" }));
                // No reply is expected for a HANDLED mouse frame (it never
                // acks) — only `read_only` is a signal. Move to the `data`
                // probe after a window long enough for a wrongful read_only
                // to have arrived.
                setTimeout(() => {
                  phase = "await-data-reply";
                  ws.send(JSON.stringify({ type: "data", payload: "ls\n" }));
                  setTimeout(() => {
                    clearTimeout(overall);
                    phase = "done";
                    finish();
                  }, 2_000);
                }, 2_000);
                return;
              }
              if (env.type === "read_only") {
                if (phase === "await-mouse-reply") mouseGotReadOnly = true;
                if (phase === "await-data-reply") dataGotReadOnly = true;
              }
            });
            ws.addEventListener("error", () => {
              clearTimeout(overall);
              reject(new Error("ws error"));
            });
          }),
        { id: taskId },
      );

      expect(result.role, "the UI holds the writer slot, so this probe is a reader").toBe(
        "reader",
      );
      expect(
        result.mouseGotReadOnly,
        "a `mouse` frame (scroll/copy) must NOT be writer-gated for a reader — this is the fix",
      ).toBe(false);
      expect(
        result.dataGotReadOnly,
        "a `data` frame (real keystroke) on the SAME reader connection must still be gated — the exception is scoped to mouse reports only",
      ).toBe(true);
    } finally {
      if (taskId) await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});

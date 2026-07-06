/*
 * terminal-copy-cache — real-browser proof of the redraw-proof copy cache
 * (iterate-2026-07-06-terminal-copy-selection-cache).
 *
 * The bug: in Claude's mouse-tracking TUI every mouse move is reported and
 * the app redraws; an xterm redraw CLEARS the live selection a moment after
 * the drag, so by the time the user presses Ctrl+C `hasSelection()` is false
 * and Ctrl+C degrades to SIGINT — copy "does nothing". The fix captures the
 * selection at mouseup into a cache that the Ctrl+C handler and a mouse-only
 * Copy pill read from.
 *
 * This spec reproduces the redraw by calling `term.clearSelection()` AFTER the
 * capture-on-mouseup, then proves an explicit copy still works — against the
 * REAL xterm `attachCustomKeyEventHandler` + a live pty (synthetic events are
 * not sufficient evidence — the v0.8.2 lesson).
 *
 * NOTE on context: Playwright serves over http://localhost, which the browser
 * treats as a SECURE context, so `navigator.clipboard` is available here and
 * the copy takes the async-API fast path. The user's real environment is
 * http/Tailscale (non-secure) where copy falls back to `document.execCommand`
 * — that fallback is unit-covered (lib/clipboard) and was validated live via
 * console instrumentation; it cannot be exercised from a localhost E2E.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function makeTaskCwd(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "terminal-copycache-e2e-"));
}

async function cleanupCwd(dir: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

async function createTask(
  request: APIRequestContext,
  cwd: string,
): Promise<string> {
  const res = await request.post("/api/external/tasks", {
    data: { title: "terminal-copy-cache-e2e", cwd },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

function collectSentDataFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/api/terminal/")) return;
    ws.on("framesent", (f) => {
      const payload = typeof f.payload === "string" ? f.payload : "";
      if (payload.includes('"type":"data"')) frames.push(payload);
    });
  });
  return frames;
}

async function openTerminal(
  page: Page,
  taskId: string,
  settleMs: number,
): Promise<void> {
  await page.goto(`/tasks/${taskId}`);
  const term = page.getByTestId("embedded-terminal");
  await expect(term).toBeVisible();
  await expect(term).toHaveAttribute("data-ws-ready", "true", {
    timeout: 15000,
  });
  await page.waitForTimeout(settleMs);
}

function readTerminalBuffer(page: Page) {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __embeddedTerminal?: {
          buffer: {
            active: {
              length: number;
              getLine(i: number): { translateToString(): string } | undefined;
            };
          };
        };
      }
    ).__embeddedTerminal;
    if (!t) return "";
    const buf = t.buffer.active;
    let s = "";
    for (let i = 0; i < buf.length; i++) {
      s += (buf.getLine(i)?.translateToString() ?? "") + "\n";
    }
    return s;
  });
}

/** Type a marker, wait for the pty to echo it, then select-all + fire the
 *  document mouseup that the production capture listener is gated on. */
async function typeSelectAndSettle(page: Page, marker: string): Promise<void> {
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type(marker);
  await expect
    .poll(() => readTerminalBuffer(page), { timeout: 10000 })
    .toContain(marker);
  await page.evaluate(() => {
    const t = (
      window as unknown as {
        __embeddedTerminal?: {
          selectAll(): void;
          element: HTMLElement;
        };
      }
    ).__embeddedTerminal;
    if (!t) throw new Error("no __embeddedTerminal");
    t.selectAll();
    // The capture-on-settle path is a `document` mouseup gated by
    // termElement.contains(target); dispatch on the xterm element.
    t.element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

test.describe("iterate-2026-07-06 — redraw-proof terminal copy cache", () => {
  test("Ctrl+C copies the captured selection AFTER a redraw wiped the live selection", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      await openTerminal(page, taskId, 1000);
      const marker = "CACHEMARKER-AC1";
      await typeSelectAndSettle(page, marker);

      // Simulate Claude's redraw wiping the LIVE selection between the drag
      // and the Ctrl+C — this is the exact condition that broke copy.
      await page.evaluate(() => {
        const t = (
          window as unknown as {
            __embeddedTerminal?: { clearSelection(): void; hasSelection(): boolean };
          }
        ).__embeddedTerminal;
        t?.clearSelection();
      });
      expect(
        await page.evaluate(
          () =>
            (
              window as unknown as {
                __embeddedTerminal?: { hasSelection(): boolean };
              }
            ).__embeddedTerminal?.hasSelection() ?? true,
        ),
        "precondition: the live selection is gone (redraw simulated)",
      ).toBe(false);

      // Clear the clipboard, then Ctrl+C must still copy via the cache.
      await page.evaluate(() => navigator.clipboard.writeText("EMPTY"));
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.press("Control+C");

      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
          timeout: 5000,
        })
        .toContain(marker);
    } finally {
      await cleanupCwd(cwd);
    }
  });

  test("the mouse-only Copy pill appears on selection and copies on click", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      await openTerminal(page, taskId, 1000);
      const marker = "CACHEMARKER-AC3";
      await typeSelectAndSettle(page, marker);

      const pill = page.getByTestId("embedded-terminal-copy-pill");
      await expect(pill).toBeVisible({ timeout: 4000 });

      await page.evaluate(() => navigator.clipboard.writeText("EMPTY"));
      await page.getByTestId("embedded-terminal-copy-pill-button").click();

      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
          timeout: 5000,
        })
        .toContain(marker);
      // Pill clears after a successful copy.
      await expect(pill).toBeHidden({ timeout: 4000 });
    } finally {
      await cleanupCwd(cwd);
    }
  });

  test("committing keyboard input invalidates the cache → Ctrl+C reverts to SIGINT", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    const sent = collectSentDataFrames(page);
    try {
      await openTerminal(page, taskId, 1000);
      const marker = "CACHEMARKER-AC4";
      await typeSelectAndSettle(page, marker);

      // Pill is up (cache populated) …
      await expect(
        page.getByTestId("embedded-terminal-copy-pill"),
      ).toBeVisible({ timeout: 4000 });

      // … then a committing keystroke must invalidate it.
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.press("x");
      await expect(
        page.getByTestId("embedded-terminal-copy-pill"),
      ).toBeHidden({ timeout: 4000 });

      // With the cache gone, Ctrl+C is an interrupt again (ETX / 0x03),
      // NOT a stale-selection copy.
      await page.keyboard.press("Control+C");
      await expect
        .poll(() => sent.join(""), { timeout: 6000 })
        .toContain("\\u0003");
    } finally {
      await cleanupCwd(cwd);
    }
  });
});

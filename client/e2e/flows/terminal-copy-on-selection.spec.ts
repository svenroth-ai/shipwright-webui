/*
 * terminal-copy-on-selection + single-send paste guard
 * (iterate-2026-06-30-terminal-paste-single-sink).
 *
 * Two regressions this pins, in a REAL browser against a live pty:
 *   1. Copy-on-selection is OFF by default — selecting terminal text with
 *      the mouse must NOT overwrite the OS clipboard (it used to clobber
 *      the item the user was about to paste).
 *   2. A single paste reaches the pty EXACTLY ONCE — for both the Ctrl+V
 *      key path and the native `paste` event path (right-click → Paste).
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function makeCwd(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "copy-on-selection-e2e-"));
}
async function cleanup(dir: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
async function createTask(request: APIRequestContext, cwd: string): Promise<string> {
  const res = await request.post("/api/external/tasks", {
    data: { title: "copy-on-selection-e2e", cwd },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  return ((await res.json()) as { task: { taskId: string } }).task.taskId;
}

/** Count {type:"data"} frames whose payload contains `needle`. */
function countDataFramesContaining(page: Page, needle: string): () => number {
  let n = 0;
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/api/terminal/")) return;
    ws.on("framesent", (f) => {
      const payload = typeof f.payload === "string" ? f.payload : "";
      if (payload.includes('"type":"data"') && payload.includes(needle)) n++;
    });
  });
  return () => n;
}

async function openTerminal(page: Page, taskId: string): Promise<void> {
  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByTestId("embedded-terminal")).toBeVisible();
  await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
    "data-ws-ready",
    "true",
    { timeout: 20000 },
  );
  await page.waitForTimeout(1200);
}

test.describe("iterate-2026-06-30 — copy-on-selection + single-send paste", () => {
  test("copy-on-selection is OFF by default — selecting does NOT clobber the clipboard", async ({
    page,
    request,
  }) => {
    const cwd = await makeCwd();
    const taskId = await createTask(request, cwd);
    try {
      await openTerminal(page, taskId);
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.type("SELECTME_NO_CLOBBER");
      await page.waitForTimeout(400);

      // Stage a sentinel clipboard value, then select terminal text.
      await page.evaluate(() => navigator.clipboard.writeText("SENTINEL_KEEP_ME"));
      await page.evaluate(() =>
        (window as unknown as { __embeddedTerminal?: { selectAll(): void } }).__embeddedTerminal?.selectAll(),
      );
      await page.evaluate(() => {
        const el = (window as unknown as { __embeddedTerminal?: { element: HTMLElement } }).__embeddedTerminal?.element;
        el?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
      });
      await page.waitForTimeout(300);

      // Clipboard must be untouched — copy-on-selection is off by default.
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        "SENTINEL_KEEP_ME",
      );
    } finally {
      await cleanup(cwd);
    }
  });

  test("Ctrl+V reaches the pty exactly once", async ({ page, request }) => {
    const cwd = await makeCwd();
    const taskId = await createTask(request, cwd);
    const countCtrlV = countDataFramesContaining(page, "CTRLV_ONCE_MARKER");
    try {
      await openTerminal(page, taskId);
      await page.evaluate(() => navigator.clipboard.writeText("CTRLV_ONCE_MARKER"));
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.press("Control+V");
      await expect.poll(() => countCtrlV(), { timeout: 8000 }).toBe(1);
      // Settle, then assert it did NOT climb to 2 (no double-send).
      await page.waitForTimeout(800);
      expect(countCtrlV()).toBe(1);
    } finally {
      await cleanup(cwd);
    }
  });

  test("a native paste event (right-click path) reaches the pty exactly once", async ({
    page,
    request,
  }) => {
    const cwd = await makeCwd();
    const taskId = await createTask(request, cwd);
    const countRC = countDataFramesContaining(page, "RIGHTCLICK_ONCE_MARKER");
    try {
      await openTerminal(page, taskId);
      await page.locator(".xterm-helper-textarea").focus();
      await page.evaluate(() => {
        const ta = document.querySelector(".xterm-helper-textarea") as HTMLElement;
        const dt = new DataTransfer();
        dt.setData("text/plain", "RIGHTCLICK_ONCE_MARKER");
        ta.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: dt,
            bubbles: true,
            cancelable: true,
            composed: true,
          } as ClipboardEventInit),
        );
      });
      await expect.poll(() => countRC(), { timeout: 8000 }).toBe(1);
      await page.waitForTimeout(800);
      expect(countRC()).toBe(1);
    } finally {
      await cleanup(cwd);
    }
  });
});

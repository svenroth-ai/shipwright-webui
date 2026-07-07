/*
 * terminal-rightclick-mouse — a right-click in mouse-reporting mode must NOT be
 * forwarded to the pty (iterate-2026-07-07-terminal-rightclick-double-paste).
 *
 * Claude Code treats a reported right-click as PASTE (from its own copy buffer),
 * so forwarding it double-pasted with the browser's own context-menu "Paste".
 * This drives a REAL xterm: put it in SGR mouse mode (what Claude does), fire a
 * real right-click and a real left-click on the canvas, and assert the sent WS
 * frames carry the LEFT-button report but NOT the right-button one. Left/middle/
 * wheel stay forwarded so Claude's selection / clicks / scroll are unaffected.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

async function makeTaskCwd(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "terminal-rclick-e2e-"));
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
async function createTask(request: APIRequestContext, cwd: string): Promise<string> {
  const res = await request.post("/api/external/tasks", {
    data: { title: "terminal-rightclick-e2e", cwd },
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
async function openTerminal(page: Page, taskId: string): Promise<void> {
  await page.goto(`/tasks/${taskId}`);
  const term = page.getByTestId("embedded-terminal");
  await expect(term).toBeVisible();
  await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 15000 });
  await page.waitForTimeout(800);
}

test.describe("iterate-2026-07-07 — right-click not forwarded to the pty", () => {
  test("a right-click in mouse mode is NOT sent to the pty; a left-click is", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    const sent = collectSentDataFrames(page);
    try {
      await openTerminal(page, taskId);
      // Put xterm into SGR mouse-reporting mode (mode 1000 press/release + 1006
      // SGR encoding) — the same thing Claude Code's TUI enables.
      await page.evaluate(() => {
        const ESC = String.fromCharCode(27);
        (
          window as unknown as { __embeddedTerminal?: { write(d: string): void } }
        ).__embeddedTerminal?.write(ESC + "[?1006h" + ESC + "[?1000h");
      });
      await page.waitForTimeout(200);

      const canvas = page.getByTestId("embedded-terminal-canvas");
      // Real right-click → xterm reports button 2; the WebUI must DROP it.
      await canvas.click({ button: "right" });
      await page.keyboard.press("Escape"); // dismiss the native context menu
      // Real left-click → forwarded (button 0).
      await canvas.click({ button: "left" });
      await page.waitForTimeout(300);

      const all = sent.join("");
      // A left-button SGR report reached the pty …
      expect(all, "left-click should be forwarded").toMatch(/<0;\d+;\d+/);
      // … but NO right-button report did (that was the double-paste trigger).
      expect(all, "right-click must NOT reach the pty").not.toMatch(/<2;\d+;\d+/);
    } finally {
      await cleanupCwd(cwd);
    }
  });
});

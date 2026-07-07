/*
 * terminal-copy-paste — real-browser keyboard copy/paste for the
 * embedded terminal (iterate-2026-05-18, FR-01.28 / FR-01.29 AC-8).
 *
 * The chord classifier + handler decision logic are exhaustively unit-
 * tested (terminal-clipboard*.test.ts) and the component wiring has
 * vitest coverage. This spec is the F0.5 surface gate: it proves the
 * REAL xterm `attachCustomKeyEventHandler` fires for real OS keypresses
 * and that `term.paste()` / selection round-trip against a live pty —
 * the v0.8.2 lesson: synthetic events are not sufficient evidence.
 *
 * Covered (real keypresses, live pty):
 *   - Ctrl+V pastes a MULTI-LINE payload — and the sent frame is
 *     CR-normalized (no raw `\n`), proving it went through term.paste()
 *     and NOT the old raw socket.send (AC-8 regression).
 *   - Shift+Insert is wired as a second paste chord.
 *   - Ctrl+C with NO selection passes through as SIGINT (``).
 *   - Ctrl+C / Ctrl+Insert with a selection copy to the OS clipboard.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function makeTaskCwd(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "terminal-copypaste-e2e-"));
}

async function cleanupCwd(dir: string): Promise<void> {
  // A pty spawned by the WS upgrade keeps the cwd open on Windows until
  // it exits — best-effort with retries.
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
    data: { title: "terminal-copy-paste-e2e", cwd },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

/** Collect every {type:"data"} frame sent on the embedded-terminal WS. */
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

/** Open a task's terminal pane and wait for the WS handshake. */
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
  // Let the shell paint its prompt before the keypress under test.
  await page.waitForTimeout(settleMs);
}

test.describe("iterate-2026-05-18 — terminal copy/paste", () => {
  test("Ctrl+V pastes a multi-line payload — CR-normalized via term.paste(), no truncation", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    const sent = collectSentDataFrames(page);
    try {
      await openTerminal(page, taskId, 1500);

      const payload = "ALPHA-section\nBETA-section\n\nGAMMA-section";
      await page.evaluate((t) => navigator.clipboard.writeText(t), payload);

      // A REAL Ctrl+V — exercises xterm's attachCustomKeyEventHandler.
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.press("Control+V");

      // The frame(s) carrying the paste must hold every section.
      await expect
        .poll(() => sent.filter((f) => f.includes("ALPHA-section")).join(""), {
          timeout: 8000,
        })
        .toContain("ALPHA-section");
      const pasteFrame = sent.filter((f) => f.includes("ALPHA-section")).join("");
      expect(pasteFrame, "BETA-section must survive the paste").toContain(
        "BETA-section",
      );
      expect(
        pasteFrame,
        "GAMMA-section (after the blank line) must survive the paste",
      ).toContain("GAMMA-section");
      // term.paste() normalizes `\r?\n` → `\r`. The OLD raw socket.send
      // kept `\n`. The sent frame's JSON therefore carries `\r` escapes
      // and ZERO `\n` escapes — the decisive AC-8 proof that paste went
      // through term.paste() (and would be bracketed-paste wrapped when
      // the app enabled it) rather than the prior mangling raw send.
      expect(pasteFrame, "line breaks must be CR-normalized").toContain("\\r");
      expect(
        pasteFrame,
        "no raw \\n may reach the pty — that was the truncation bug",
      ).not.toContain("\\n");
    } finally {
      await cleanupCwd(cwd);
    }
  });

  test("Shift+Insert is wired as a second paste chord", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    const sent = collectSentDataFrames(page);
    try {
      await openTerminal(page, taskId, 1500);
      await page.evaluate(() =>
        navigator.clipboard.writeText("SHIFTINSERT-payload"),
      );
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.press("Shift+Insert");
      await expect
        .poll(() => sent.join(""), { timeout: 8000 })
        .toContain("SHIFTINSERT-payload");
    } finally {
      await cleanupCwd(cwd);
    }
  });

  test("Ctrl+C with NO selection passes through to the pty as SIGINT", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    const sent = collectSentDataFrames(page);
    try {
      await openTerminal(page, taskId, 1000);
      // No selection staged → Ctrl+C must reach the pty as ETX (0x03),
      // not be swallowed by the copy handler.
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.press("Control+C");
      await expect
        .poll(() => sent.join(""), { timeout: 6000 })
        .toContain("\\u0003");
    } finally {
      await cleanupCwd(cwd);
    }
  });

  // Terminal-text COPY (Ctrl+C / Ctrl+Insert) was removed in
  // iterate-2026-07-07-terminal-osc52-clipboard — Claude copies its own mouse
  // selection via OSC 52 and the WebUI relays it (see terminal-osc52.spec.ts).
  // Ctrl+C now always passes through as SIGINT (covered above).
});

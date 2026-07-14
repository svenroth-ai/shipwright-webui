/*
 * Terminal-driving helpers. iterate-2026-07-10-harness-hardening (A00).
 *
 * WHY THIS EXISTS. Specs v0-9-2 and v0-9-3 were written against ONE task on one
 * developer's machine (`31b4076d-…`), chosen because it happened to carry ~82 KB
 * of persisted scrollback — the replay path only runs when there is something to
 * replay. That task has since been deleted, so both specs have been silently
 * `test.skip(...)`-ing on every machine, for every run, ever since. A spec that
 * always skips is not a regression fence; it is a comment.
 *
 * These helpers let a spec MANUFACTURE the precondition instead of inheriting it:
 * seed a task, open its terminal, drive real bytes through the real pty until the
 * scrollback is genuinely large. The assertions are then unchanged — they just
 * finally get to run.
 */

import { expect, type Page } from "@playwright/test";

/** Bytes of scrollback the replay-path specs need to exercise a real replay. */
export const SUBSTANTIAL_SCROLLBACK_BYTES = 80_000;

/**
 * Navigate to a task and wait for its embedded terminal to be attached AND
 * promoted to writer. Waiting for the WS `ready` (surfaced as `data-ws-ready`)
 * before any input is mandatory — a fast click beats the WS
 * attach → prewarm → manual-send park and the input is simply dropped.
 */
export async function openTaskTerminal(
  page: Page,
  taskId: string,
  opts: { expectWriter?: boolean } = {},
): Promise<void> {
  await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });

  const terminalTab = page.getByRole("tab", { name: /terminal/i });
  if (await terminalTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await terminalTab.click();
  }

  const term = page.getByTestId("embedded-terminal");
  await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 20_000 });
  if (opts.expectWriter !== false) {
    await expect(term).toHaveAttribute("data-role", "writer", { timeout: 10_000 });
  }
}

/**
 * Emit a high-volume payload through the REAL pty so the task accumulates real
 * persisted scrollback. Shell-dialect-aware: the pty spawns the platform's
 * whitelisted shell (PowerShell on win32, sh/bash on Linux CI), and a `for`
 * loop written for the wrong one just prints an error instead of 5000 lines.
 *
 * Returns once the terminal has actually rendered the sentinel that closes the
 * payload — polling on the sentinel rather than sleeping a fixed duration keeps
 * this deterministic on a slow CI runner.
 */
export async function driveScrollback(
  page: Page,
  opts: { lines?: number; timeoutMs?: number } = {},
): Promise<void> {
  const lines = opts.lines ?? 1200;
  const sentinel = `SCROLLBACK_READY_${Date.now()}`;

  await page.getByTestId("embedded-terminal-canvas").click();
  await page.waitForTimeout(300);

  // ~66 bytes/line × 1200 ≈ 80 KB — past SUBSTANTIAL_SCROLLBACK_BYTES.
  const filler = "payload bytes to fill the wire and the scrollback ring";
  const script =
    process.platform === "win32"
      ? `for ($i=1; $i -le ${lines}; $i++) { Write-Host "line $i ${filler}" }; Write-Host "${sentinel}"`
      : `for i in $(seq 1 ${lines}); do echo "line $i ${filler}"; done; echo "${sentinel}"`;

  await page.keyboard.insertText(script);
  await page.keyboard.press("Enter");

  // The sentinel lands in the xterm buffer once the whole payload has flushed.
  await expect
    .poll(
      async () =>
        page.evaluate(() => document.querySelector('[data-testid="embedded-terminal"]')?.textContent ?? ""),
      { timeout: opts.timeoutMs ?? 60_000, intervals: [250] },
    )
    .toContain(sentinel);
}

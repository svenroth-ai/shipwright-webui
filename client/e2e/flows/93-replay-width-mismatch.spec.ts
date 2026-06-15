/*
 * Spec 93 — replay snapshot width-mismatch fidelity
 * (iterate-2026-06-15-terminal-readonly-reflow).
 *
 * Reproduces the reported bug: a terminal snapshot serialized at a WIDE
 * (writer/desktop) width, replayed into a NARROWER terminal on re-attach, was
 * written WITHOUT first resizing the terminal → @xterm/addon-serialize's
 * absolute cursor moves clamped at the wrong column → character interleaving
 * ("Dein vom" → "De invom"). The fix (useReplayDrainGate) resizes the terminal
 * to the snapshot's cols/rows before the write, so the content reconstructs
 * faithfully (a clean reflow to the viewport may follow, but the CHARACTERS
 * stay in order).
 *
 * Self-contained: creates its own project + task (no hardcoded dev-registry
 * project id), so it runs on an isolated stack.
 */

import { test, expect, type Page } from "@playwright/test";
import { makeTaskCwd, cleanupCwd } from "../helpers/task-fixture";

const WIDE = { width: 1400, height: 900 };
const NARROW = { width: 390, height: 780 };

// A 36-char strictly-sequential token: interleaving/clamping reorders or drops
// chars, so the contiguous sequence only survives a faithful reconstruction.
const SEQ = "abcdefghijklmnopqrstuvwxyz0123456789";

async function readXtermJoined(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __embeddedTerminal?: {
        buffer: { active: { length: number; getLine(y: number): { translateToString(t?: boolean): string } | undefined } };
      } | null;
    };
    const term = w.__embeddedTerminal;
    if (!term) return "";
    const buf = term.buffer.active;
    let out = "";
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      out += line ? line.translateToString(false) : "";
    }
    return out;
  });
}

test.describe("Replay width-mismatch fidelity (read-only/narrow re-attach)", () => {
  test.setTimeout(120_000);

  test("a wide snapshot replayed into a narrow terminal keeps characters in order (no interleaving)", async ({
    page,
    request,
  }) => {
    const suffix = Date.now();
    const proj = await request.post("/api/projects", {
      data: { name: `replay-width-${suffix}`, path: process.cwd(), profile: "default", status: "active" },
    });
    expect(proj.ok()).toBeTruthy();
    const { data: p } = (await proj.json()) as { data: { id: string } };
    const cwd = await makeTaskCwd();
    let taskId: string | undefined;
    try {
      const created = await request.post("/api/external/tasks", {
        data: { title: `replay-width-${suffix}`, cwd, projectId: p.id },
      });
      expect(created.ok()).toBeTruthy();
      taskId = ((await created.json()) as { task: { taskId: string } }).task.taskId;

      // 1. Open WIDE — the embedded shell pane spawns a pty that fits the wide
      //    terminal (many cols).
      await page.setViewportSize(WIDE);
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("embedded-terminal")).toHaveAttribute("data-ws-ready", "true", { timeout: 20_000 });
      await page.waitForTimeout(3_000); // pty spawn + prompt

      // 2. Echo the sequential token (echo + token ≈ 41 chars — wider than the
      //    narrow viewport, so a wrong-width replay would wrap/clamp it).
      await page.locator('[data-testid="embedded-terminal-canvas"]').click({ timeout: 5_000 })
        .catch(async () => { await page.locator(".xterm").first().click(); });
      await page.keyboard.type(`echo ${SEQ}`, { delay: 20 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1_500);
      // The token is present (stripped of whitespace) before we navigate away.
      expect((await readXtermJoined(page)).replace(/\s/g, "")).toContain(SEQ);

      // 3. Navigate away, shrink to a NARROW (phone) viewport, navigate back.
      //    The snapshot was serialized at the WIDE width; the re-attached
      //    terminal fits the narrow container → the bug's trigger.
      await page.goto("/");
      await page.waitForTimeout(1_000);
      await page.setViewportSize(NARROW);
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("embedded-terminal")).toHaveAttribute("data-ws-ready", "true", { timeout: 20_000 });
      await page.waitForTimeout(4_000); // replay flush

      // 4. The token's characters must still be in order after the wide→narrow
      //    replay. Whitespace-stripping absorbs any clean reflow wrapping; only
      //    interleaving (the bug) breaks the contiguous sequence.
      const joinedStripped = (await readXtermJoined(page)).replace(/\s/g, "");
      expect(joinedStripped).toContain(SEQ);
    } finally {
      if (taskId) await request.delete(`/api/external/tasks/${encodeURIComponent(taskId)}`).catch(() => {});
      await request.delete(`/api/projects/${p.id}`).catch(() => {});
      await cleanupCwd(cwd);
    }
  });
});

/*
 * iterate-2026-05-23 (terminal-selection-uxd) — drag-select → clipboard
 * end-to-end regression guard for the NON-mouse-tracking shell case.
 *
 * Verifies AC1 of the iterate spec: in a non-mouse-tracking shell, the
 * user drag-selects text in the embedded terminal pane, and the OS
 * clipboard auto-fills with that selection. Drives the full production
 * pipeline through a real Chromium + real xterm + isolated dev stack.
 *
 * The companion `87-terminal-mouse-mode.spec.ts` verifies the
 * MOUSE-MODE case (banner appears, plain drag is consumed by the
 * pty, Shift+Drag bypasses mouse-mode and still auto-copies).
 *
 * Soft-skips:
 *   - baseURL unreachable (matches the v0-9-6-live-pty-replay pattern).
 *   - clipboard permission denied (Chromium policy may strip in some
 *     test contexts; we'd rather skip than false-flag).
 */

import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  dragInTerminal,
  readXtermSelection,
  setupTerminalTask,
  termWrite,
} from "../helpers/terminal-selection";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACT_DIR = path.resolve(
  __dirname,
  "../../playwright-report/86-terminal-selection",
);

test.describe("Iterate terminal-selection-uxd — drag-select → clipboard (non-mouse-mode)", () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ request }) => {
    try {
      await request.get("/", { timeout: 5_000 });
    } catch (err) {
      test.skip(
        true,
        `baseURL unreachable (${(err as Error).message}); soft-skipping spec 86.`,
      );
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "webui:embedded-terminal-default-tab",
          '"terminal"',
        );
      } catch {
        /* noop */
      }
    });
  });

  test("drag-select inside a fresh shell auto-fills the OS clipboard", async ({
    page,
    request,
  }) => {
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    const { cleanup } = await setupTerminalTask(page, request);
    try {
      // Inject a deterministic marker. Avoids depending on the
      // freshly-spawned shell's prompt-paint timing.
      const MARKER = `SELECTION_MARKER_${Date.now()}`;
      await termWrite(page, `${MARKER}\r\n`);

      const canvas = page
        .locator('[data-testid="embedded-terminal-canvas"]')
        .first();
      const box = await canvas.boundingBox();
      if (!box) throw new Error("terminal canvas has no bounding box");

      await dragInTerminal(page, box);
      await page.waitForTimeout(250);

      const selectionText = await readXtermSelection(page);
      if (!selectionText) {
        await page.screenshot({
          path: path.join(ARTIFACT_DIR, "no-selection.png"),
          fullPage: true,
        });
      }
      expect(selectionText.length).toBeGreaterThan(0);

      const clipText = await page.evaluate(async () => {
        try {
          return await navigator.clipboard.readText();
        } catch (err) {
          return `__READ_FAILED__: ${(err as Error).message}`;
        }
      });
      if (clipText.startsWith("__READ_FAILED__")) {
        test.skip(
          true,
          `navigator.clipboard.readText rejected: ${clipText}; spec 86 assumes clipboard permissions per playwright.config.ts`,
        );
        return;
      }
      expect(clipText.trim().length).toBeGreaterThan(0);
      const normalise = (s: string) => s.trim().replace(/\s+/g, " ");
      expect(normalise(clipText)).toContain(normalise(selectionText));
    } finally {
      await cleanup();
    }
  });
});

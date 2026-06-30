/*
 * iterate-2026-05-23 (terminal-selection-uxd) — mouse-mode banner +
 * Shift+Drag bypass end-to-end regression guard.
 *
 * Verifies AC2 + AC3 of the iterate spec EMPIRICALLY against a real
 * Chromium + real xterm (no mocks): when xterm's mouse-tracking mode
 * is active (the foreground app in the pty enabled DECSET 1000/1002/
 * 1003/1006 — which Claude TUI does via `?1006h`),
 *
 *   1. xterm-core toggles `.enable-mouse-events` on `term.element`.
 *   2. EmbeddedTerminal's MutationObserver picks that up and renders
 *      the dismissable hint badge.
 *   3. A plain (no-Shift) drag is consumed by the mouse-tracking
 *      handler (sent to the pty as SGR mouse events) — no selection
 *      is produced, and the auto-copy pipeline correctly does nothing.
 *   4. Holding Shift across the same drag bypasses mouse-mode (this
 *      is xterm.js's built-in MouseService behaviour, gated on
 *      `event.shiftKey`), so SelectionService takes over, the
 *      selection IS produced, mouseup fires, and the OS clipboard
 *      auto-fills.
 *
 * This is the second F0.5 surface beyond `86-terminal-selection.spec.ts`
 * (which exercises the non-mouse-mode path). Together they prove
 * the user's actual reported problem ("can't mark text in Claude
 * terminal") is mechanically closed — no human UAT required.
 *
 * Soft-skips on baseURL unreachable + clipboard permission denied,
 * same policy as spec 86.
 */

import { test, expect, type Page } from "@playwright/test";
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
  "../../playwright-report/87-terminal-mouse-mode",
);

/**
 * Enter SGR-mouse-tracking mode by writing the DEC private-mode
 * sequences directly to xterm. `?1000h` activates X10 mouse tracking
 * (the base mode xterm-core uses to add the `.enable-mouse-events`
 * class). `?1006h` selects the SGR encoding modifier — added so the
 * end state matches what Claude TUI actually negotiates in practice.
 */
async function enterMouseMode(page: Page): Promise<void> {
  await termWrite(page, "\x1b[?1000h\x1b[?1006h");
}

async function exitMouseMode(page: Page): Promise<void> {
  await termWrite(page, "\x1b[?1006l\x1b[?1000l");
}

/**
 * Read the current selection from xterm AND clear it via the dev
 * hook. Used between the no-shift and shift drag arms so we don't
 * have stale state polluting the second assertion.
 */
async function clearSelection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __embeddedTerminal?: {
        clearSelection?: () => void;
        hasSelection?: () => boolean;
      } | null;
    };
    const term = w.__embeddedTerminal;
    try {
      if (term && term.clearSelection) term.clearSelection();
    } catch {
      /* ignore */
    }
  });
}

/**
 * Write a string to the OS clipboard (page-side) so we can later
 * verify the no-shift drag did NOT overwrite it. If `writeText`
 * is unavailable we return false and the caller relaxes the
 * non-overwrite assertion.
 */
async function seedClipboard(page: Page, text: string): Promise<boolean> {
  return await page.evaluate(async (seed: string) => {
    try {
      await navigator.clipboard.writeText(seed);
      return true;
    } catch {
      return false;
    }
  }, text);
}

async function readClipboard(page: Page): Promise<string> {
  return await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch (err) {
      return `__READ_FAILED__: ${(err as Error).message}`;
    }
  });
}

test.describe("Iterate terminal-selection-uxd — mouse-mode banner + Shift+Drag bypass", () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ request }) => {
    try {
      await request.get("/", { timeout: 5_000 });
    } catch (err) {
      test.skip(
        true,
        `baseURL unreachable (${(err as Error).message}); soft-skipping spec 87.`,
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
        // iterate-2026-06-30-terminal-paste-single-sink — copy-on-selection
        // is now OPT-IN (default off). This spec verifies Shift+Drag copy,
        // so enable it explicitly.
        localStorage.setItem("shipwright.terminal.copyOnSelection", "true");
      } catch {
        /* noop */
      }
    });
  });

  test("xterm in mouse-tracking mode: banner appears, plain drag blocked, Shift+Drag still copies", async ({
    page,
    request,
  }) => {
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    const { cleanup } = await setupTerminalTask(page, request);
    try {
      // 1. Paint a deterministic marker BEFORE entering mouse mode so
      //    the marker bytes flow through xterm's normal text-write
      //    path (mouse mode does not affect `term.write`; only mouse
      //    events).
      const MARKER = `MOUSE_MODE_${Date.now()}`;
      await termWrite(page, `${MARKER}\r\n${MARKER}\r\n${MARKER}\r\n`);

      // 2. Enter SGR mouse-tracking. xterm-core's MouseService adds
      //    `.enable-mouse-events` to `term.element` synchronously
      //    when the DECSET parser hits `?1000h`.
      await enterMouseMode(page);

      // 3. The hint badge MUST appear (it's the MutationObserver's
      //    job in EmbeddedTerminal.tsx). 5s timeout — react-state +
      //    re-render is sub-second, but the production server's
      //    dev-stack settle and Vite HMR sometimes add a beat.
      const banner = page.getByTestId("embedded-terminal-mouse-mode-hint");
      await expect(banner).toBeVisible({ timeout: 5_000 });

      // 4. Snapshot the current clipboard so we can prove the
      //    no-shift drag did NOT overwrite it. Use a sentinel string
      //    so a regression that fires copyText on every mouseup
      //    surfaces unambiguously.
      const SENTINEL = `__SENTINEL_${Date.now()}__`;
      const sentinelWritten = await seedClipboard(page, SENTINEL);

      // 5. Locate the canvas.
      const canvas = page
        .locator('[data-testid="embedded-terminal-canvas"]')
        .first();
      const box = await canvas.boundingBox();
      if (!box) throw new Error("terminal canvas has no bounding box");

      // 6. Plain drag — xterm.js's MouseService consumes the events
      //    (sends them to the pty as SGR mouse reports), no
      //    SelectionService update fires, term.getSelection() is empty.
      await clearSelection(page);
      await dragInTerminal(page, box);
      await page.waitForTimeout(300);

      const plainSelection = await readXtermSelection(page);
      if (plainSelection.length > 0) {
        // Captured for diagnostics if this assertion ever fails.
        await page.screenshot({
          path: path.join(ARTIFACT_DIR, "plain-drag-leaked-selection.png"),
          fullPage: true,
        });
      }
      expect(
        plainSelection,
        "plain drag should not produce a selection in mouse mode",
      ).toBe("");

      // The OS clipboard must still hold the sentinel — proving the
      // auto-copy pipeline correctly DID NOT fire.
      if (sentinelWritten) {
        const clipAfterPlain = await readClipboard(page);
        if (clipAfterPlain.startsWith("__READ_FAILED__")) {
          test.skip(
            true,
            `clipboard read denied (${clipAfterPlain}); spec 87 cannot verify non-overwrite invariant`,
          );
          return;
        }
        expect(
          clipAfterPlain,
          "plain drag in mouse mode must not overwrite the OS clipboard",
        ).toBe(SENTINEL);
      }

      // 7. Shift+Drag — xterm's MouseService checks `event.shiftKey`
      //    and BYPASSES mouse-mode, letting SelectionService take
      //    over. Our auto-copy pipeline then fires on mouseup.
      await clearSelection(page);
      await dragInTerminal(page, box, { shift: true });
      await page.waitForTimeout(300);

      const shiftSelection = await readXtermSelection(page);
      if (!shiftSelection) {
        await page.screenshot({
          path: path.join(ARTIFACT_DIR, "shift-drag-no-selection.png"),
          fullPage: true,
        });
      }
      expect(
        shiftSelection.length,
        "Shift+Drag must bypass mouse mode and produce a selection",
      ).toBeGreaterThan(0);

      const clipAfterShift = await readClipboard(page);
      if (clipAfterShift.startsWith("__READ_FAILED__")) {
        test.skip(
          true,
          `clipboard read denied (${clipAfterShift}); spec 87 cannot verify Shift+Drag copy`,
        );
        return;
      }
      // The clipboard must now hold the Shift+Drag selection (NOT
      // the sentinel any more).
      expect(clipAfterShift.trim().length).toBeGreaterThan(0);
      expect(clipAfterShift, "Shift+Drag should overwrite sentinel").not.toBe(
        SENTINEL,
      );
      const normalise = (s: string) => s.trim().replace(/\s+/g, " ");
      expect(normalise(clipAfterShift)).toContain(normalise(shiftSelection));
    } finally {
      // Restore xterm to plain (non-mouse) mode so a subsequent
      // re-run of the dev stack does not boot into mouse-tracking.
      try {
        await exitMouseMode(page);
      } catch {
        /* best-effort */
      }
      await cleanup();
    }
  });
});

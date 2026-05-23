/*
 * iterate-2026-05-23 (terminal-tab-autofocus) — auto-focus on tab
 * activation, end-to-end regression guard.
 *
 * Verifies that when the user is on TaskDetailPage with the Transcript
 * tab active and clicks the Terminal tab, the xterm helper-textarea
 * receives keyboard focus immediately — no extra canvas click required.
 * This is the user's reported pain point ("Ich muss immer ins terminal
 * klicken"); the unit tests cover the React-effect wiring, this E2E
 * proves the integration against a real Chromium + xterm + isolated
 * dev stack.
 *
 * Soft-skip on baseURL unreachable (matches specs 86 + 87).
 */

import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setupTerminalTask } from "../helpers/terminal-selection";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACT_DIR = path.resolve(
  __dirname,
  "../../playwright-report/88-terminal-tab-autofocus",
);

test.describe("Iterate terminal-tab-autofocus — auto-focus on tab activation", () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ request }) => {
    try {
      await request.get("/", { timeout: 5_000 });
    } catch (err) {
      test.skip(
        true,
        `baseURL unreachable (${(err as Error).message}); soft-skipping spec 88.`,
      );
    }
  });

  test.beforeEach(async ({ page }) => {
    // Force Transcript as the default tab so the test starts with the
    // Terminal tab INACTIVE. This is the inverse of specs 86 + 87,
    // which pre-pin Terminal as default.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "webui:embedded-terminal-default-tab",
          '"transcript"',
        );
      } catch {
        /* noop */
      }
    });
  });

  test("clicking the Terminal tab from Transcript focuses xterm's helper-textarea", async ({
    page,
    request,
  }) => {
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    const { cleanup } = await setupTerminalTask(page, request);
    try {
      // 1. Assert the page landed on Transcript (not Terminal). If the
      //    default-tab localStorage was ignored or overridden somewhere,
      //    we want to know loudly — otherwise the rest of the spec
      //    would be testing a different state than intended.
      const transcriptTrigger = page.getByTestId("task-detail-tab-transcript");
      const terminalTrigger = page.getByTestId("task-detail-tab-terminal");
      await expect(transcriptTrigger).toHaveAttribute("data-state", "active");
      await expect(terminalTrigger).toHaveAttribute("data-state", "inactive");

      // 2. Move focus AWAY from any element that might happen to hold it
      //    after navigation (sidebar nav link, header button). Focus the
      //    Transcript trigger explicitly — that's a plausible
      //    starting state when the user clicks a sibling tab. After the
      //    Terminal-tab click we then prove focus MOVED to the xterm
      //    helper-textarea (not stayed on the trigger, not stayed on
      //    the body).
      await transcriptTrigger.focus();

      // 3. Click the Terminal tab.
      await terminalTrigger.click();
      await expect(terminalTrigger).toHaveAttribute("data-state", "active");

      // 4. Allow the useEffect + React commit + xterm focus() to flush.
      //    The autofocus runs synchronously inside the effect, but
      //    Playwright's `click` resolves on the synthetic-event
      //    dispatch — give the microtask queue + xterm's focus-on-
      //    textarea call a brief breathing room.
      await page.waitForTimeout(150);

      // 5. document.activeElement must now be xterm's hidden
      //    helper-textarea (`.xterm-helper-textarea`). That's the
      //    element xterm.js uses to receive keyboard input when the
      //    terminal is "focused" — keypresses on it become onData
      //    events.
      const activeClass = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? el.className : null;
      });
      if (
        !activeClass ||
        !/(?:^|\s)xterm-helper-textarea(?:\s|$)/.test(activeClass)
      ) {
        await page.screenshot({
          path: path.join(ARTIFACT_DIR, "no-autofocus.png"),
          fullPage: true,
        });
      }
      expect(
        activeClass,
        "after Terminal-tab click, document.activeElement should be the xterm helper-textarea",
      ).toMatch(/(?:^|\s)xterm-helper-textarea(?:\s|$)/);
    } finally {
      await cleanup();
    }
  });
});

/*
 * Collecting browser-side errors from a Playwright page, without the race that
 * makes the collection read clean when it isn't.
 * iterate-2026-07-29-mermaid-real-render-e2e.
 */

import type { Page } from "@playwright/test";

/**
 * Start collecting console errors and uncaught page errors. Attach BEFORE the
 * first navigation — listeners registered later miss everything already emitted.
 *
 * The returned array is live: read it at assertion time, after
 * {@link flushPageEvents}.
 */
export function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/**
 * Give the page one frame and one more round-trip before reading the array
 * {@link watchForErrors} returned.
 *
 * Console and pageerror arrive as asynchronous CDP events, while `evaluate()`
 * resolves off a command reply. Asserting the array the instant `evaluate()`
 * returns can therefore miss an error emitted right at the end of the work — a
 * FALSE GREEN, the one direction a guard must never fail in. CDP delivers
 * events and replies in order on a single session, so everything the page
 * emitted before this call has been dispatched by the time it returns.
 *
 * `setTimeout` rather than `requestAnimationFrame`: rAF would additionally
 * catch an error thrown during paint, but it does not fire at all on a
 * backgrounded page, so a future config change could turn this flush into a
 * test-timeout instead of a failed assertion. A macrotask turn is what the
 * ordering argument actually needs, and it always fires.
 * (Raised by external code review, gemini, 2026-07-29 — accepted-and-fixed;
 * rAF-hang hardening from the Stage-1 spec-reviewer pass.)
 */
export async function flushPageEvents(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => setTimeout(() => resolve(), 0)),
  );
}

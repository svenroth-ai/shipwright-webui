/*
 * Determinism kit for the visual project. A00 (iterate-2026-07-10).
 *
 * A screenshot gate is only worth having if a NO-OP change produces a
 * byte-identical image. Everything below exists to kill a specific source of
 * drift that would otherwise force people to run `--update-snapshots` reflexively
 * — which hands back exactly the property the gate is supposed to buy.
 *
 * 1. RELATIVE TIMESTAMPS. TaskCard/TaskList/TriageItemCard render
 *    `relative(Date.now() - createdAt)` (client/src/lib/formatTime.ts). Seeded
 *    fixtures are created seconds before the shot, so the label would wobble
 *    between "just now" and "1m ago" run to run. We pin the CLIENT clock to a
 *    large fixed offset from the fixture's own createdAt, so every card renders a
 *    stable coarse label ("2h ago") no matter how many ms apart they were seeded.
 *    `setFixedTime` freezes Date.now() but LEAVES TIMERS RUNNING — React Query
 *    polling and the WS still work, which `pauseAt()` would have broken.
 *
 * 2. THE LIVE PTY. A real terminal is not deterministic (prompt, cwd, cursor
 *    blink, shell banner). It is MASKED, never screenshotted. Masking the pty is
 *    honest; loosening the pixel threshold until a live terminal "passes" would
 *    quietly blind the gate to every other pixel on the page too.
 *
 * 3. CARET + ANIMATIONS: handled in playwright.config.ts (`caret: 'hide'`,
 *    `animations: 'disabled'`).
 */

import type { Locator, Page } from "@playwright/test";

/**
 * Offset between the fixture's createdAt and the frozen client clock.
 *
 * The half-hour is load-bearing, not decoration. `formatRelativeTime` buckets by
 * FLOOR, so a plain 2h offset puts the anchor task at exactly 2h ("2h ago") while a
 * sibling seeded one second later lands at 1h59m59s — which floors to "1h ago". Two
 * cards created a second apart then render different labels, and worse, whether they
 * do depends on how fast the seeding ran. Offsetting into the MIDDLE of a bucket
 * means a few seconds of seeding jitter cannot cross a boundary.
 */
export const CLOCK_OFFSET_MS = 2.5 * 60 * 60 * 1000; // 2h30m — mid-bucket

/**
 * Freeze the page clock at `anchorIso + CLOCK_OFFSET_MS`. MUST be called before
 * `page.goto`. `anchorIso` should be the seeded fixture's own `createdAt`, so the
 * offset — and therefore every rendered relative label — is identical on every run.
 */
export async function freezeClock(page: Page, anchorIso: string): Promise<void> {
  const anchor = new Date(anchorIso).getTime();
  await page.clock.setFixedTime(new Date(anchor + CLOCK_OFFSET_MS));
}

/**
 * Regions that are never deterministic and are masked out of every screenshot.
 * The xterm canvas renders a live shell; nothing about it is reproducible.
 */
export function nonDeterministicRegions(page: Page): Locator[] {
  return [
    page.getByTestId("embedded-terminal-canvas"),
    page.getByTestId("embedded-terminal-launch-preview"),
  ];
}

/**
 * Settle the page before capture: fonts loaded (a mid-capture webfont swap
 * silently reflows every glyph) and no in-flight network.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

/*
 * TITLE BAR IS FULL-BLEED — it reaches the right edge on every route.
 * (iterate-2026-07-21-mac-titlebar-right-clip)
 *
 * THE BUG. `.scene-fore` (the shell scroller) carried `scrollbar-gutter: stable`,
 * which permanently subtracts a scrollbar-wide strip from the RIGHT of the
 * scrollport. Both title bars (`.page-head`, `.mc-top`) live INSIDE that
 * scrollport, while `.scene-bg` — the photo plate — is absolutely positioned on
 * `.screen` and therefore spans the FULL width. Net effect: every title bar
 * stopped short and the photo showed through the reserved strip. Reported on
 * macOS Edge + Safari ("cut, right hand side, about 5mm"); reproduced in headed
 * Edge on Windows at 15px on all six routes.
 *
 * WHY A REAL BROWSER. jsdom has no layout — a unit test cannot see a 15px strip.
 * The sibling ratchet `src/test/shell-scroll-invariant.test.ts` only pins the
 * SOURCE shape; THIS spec is the one that measures the actual geometry.
 *
 * SCOPE — what this spec does NOT cover. Mission Control's bar is `.mc-top`, not
 * `.page-head`, and reaching it needs a seeded task; seeding writes into the
 * real `sdk-sessions.json` unless the run is under an isolated USERPROFILE, so
 * it is deliberately NOT asserted here. It WAS verified by direct measurement
 * against both builds (pre-fix 15px gap, post-fix 0px) — see the iterate ADR.
 * Both bars share one root cause (the shell scroller's reserved gutter), and
 * that root cause is pinned unconditionally by the sibling vitest ratchet.
 *
 * PROOF IT BITES. Re-adding `[scrollbar-gutter:stable]` to the SceneBackdrop
 * className in layouts/MainLayout.tsx fails `gap` on every route below (measured
 * 15px in headed Chromium and headed msedge). Reverting Settings to a body
 * WITHOUT its own scroller re-fails the no-spring assertion, because the shell
 * scroller then overflows on /settings alone and its scrollbar takes width there
 * and nowhere else.
 */
import { test, expect } from '@playwright/test';

/**
 * Every route that renders the shared `.page-head` title bar.
 *
 * `/?view=list` is NOT redundant with `/`. The Board has two body modes and only
 * the kanban one bounded its own scroll; list view handed it to the shell and
 * was clipped exactly like the original defect (measured: overflowed the shell
 * by ~19000px, gap back to 15px) while every other assertion here stayed green.
 * The view is persisted in localStorage and deep-linkable, so it is a state a
 * user simply lives in.
 */
const ROUTES = ['/', '/?view=list', '/projects', '/inbox', '/triage', '/settings', '/diagnostics'];

/** Deliberately short: forces content to exceed the viewport where it can. */
test.use({ viewport: { width: 1280, height: 600 } });

async function measure(page: import('@playwright/test').Page) {
  await page.waitForSelector('.page-head', { timeout: 20000 });
  // Let fonts/data settle so the bar has its final geometry.
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const screen = document.querySelector('.screen') as HTMLElement;
    const fore = document.querySelector('.scene-fore') as HTMLElement;
    const head = document.querySelector('.page-head') as HTMLElement;
    return {
      gap: screen.getBoundingClientRect().right - head.getBoundingClientRect().right,
      foreClientWidth: fore.clientWidth,
      reservedStrip: fore.getBoundingClientRect().width - fore.clientWidth,
      shellOverflows: fore.scrollHeight > fore.clientHeight,
      shellOverflowsHorizontally: fore.scrollWidth > fore.clientWidth,
    };
  });
}

// @smoke — the CI E2E gate runs `--grep @smoke` (.github/scripts/e2e-stack.sh).
// Without the tag this spec would never run again after the authoring session,
// and the ledger rows claiming these behaviours are "tested" would rest on a
// one-off local run. Seven page loads is cheap next to the existing smoke set.
test.describe('title bar reaches the right edge @smoke', () => {
  for (const route of ROUTES) {
    test(`no strip is carved out of the title bar on ${route}`, async ({ page }) => {
      await page.goto(route);
      const m = await measure(page);

      expect(
        m.gap,
        `the title bar on ${route} stops ${m.gap}px short of the viewport edge; the photo ` +
          'backdrop shows through that strip. Check for a reserved scrollbar gutter on .scene-fore.',
      ).toBeLessThanOrEqual(0.5);

      // Two-sided on purpose. A bar that OVERHANGS the viewport also "reaches
      // the edge", and one rejected candidate fix did exactly that (negative
      // margin-right on .page-head) at the cost of horizontal overflow. A
      // one-sided assertion would have green-lit it.
      expect(
        m.gap,
        `the title bar on ${route} overhangs the viewport by ${-m.gap}px — it is being pushed ` +
          'past the edge rather than fitted to it, which buys the full-bleed look with horizontal overflow.',
      ).toBeGreaterThanOrEqual(-0.5);

      expect(
        m.shellOverflowsHorizontally,
        `${route} scrolls horizontally at shell level (scrollWidth > clientWidth) — something is ` +
          'wider than the scrollport.',
      ).toBe(false);
    });
  }

  test('Settings scrolls its own body while the title bar stays put', async ({ page }) => {
    // AC4. The shell-level assertions below prove no route hands scrolling
    // UPWARD; they do not prove Settings still scrolls at all. Without this,
    // a change that clipped the Settings body (or made it unscrollable) would
    // keep every other assertion green.
    //
    // The viewport is pinned SHORT on purpose. Settings renders a project list,
    // so on an isolated CI stack (empty home, zero projects) the body would fit
    // at 1280x600 and this test would fail on a perfectly correct build —
    // asserting on machine state rather than on behaviour. 300px of height
    // guarantees the overflow regardless of how much data exists.
    await page.setViewportSize({ width: 1280, height: 300 });
    await page.goto('/settings');
    await page.waitForSelector('[data-testid="settings-scroll-body"]', { timeout: 20000 });
    await page.waitForTimeout(600);

    const result = await page.evaluate(async () => {
      const body = document.querySelector('[data-testid="settings-scroll-body"]') as HTMLElement;
      const head = document.querySelector('.page-head') as HTMLElement;
      const scrollable = body.scrollHeight > body.clientHeight;
      const headTopBefore = head.getBoundingClientRect().top;
      body.scrollTop = 120;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {
        scrollable,
        scrolled: body.scrollTop,
        headTopBefore,
        headTopAfter: head.getBoundingClientRect().top,
      };
    });

    expect(
      result.scrollable,
      'the Settings body no longer overflows at this viewport, so this test proves nothing about ' +
        'its scrolling. Shrink the viewport or add content until it does.',
    ).toBe(true);
    expect(result.scrolled, 'the Settings body did not scroll when scrollTop was set').toBeGreaterThan(0);
    expect(
      result.headTopAfter,
      'the Settings title bar moved when the body scrolled — the header must stay put',
    ).toBeCloseTo(result.headTopBefore, 1);
  });

  test('the shell scroller never scrolls, so no route pays for a scrollbar', async ({ page }) => {
    const widths: Record<string, number> = {};

    for (const route of ROUTES) {
      await page.goto(route);
      const m = await measure(page);

      expect(
        m.shellOverflows,
        `${route} hands its scrolling up to the shell scroller. That route then grows a ` +
          'scrollbar the others do not have, which both insets its title bar and springs the ' +
          'content width across route changes. Bound the page body instead (flex-1 overflow-y-auto).',
      ).toBe(false);

      expect(m.reservedStrip, `${route} reserves a ${m.reservedStrip}px strip on the shell scroller`).toBeLessThanOrEqual(0.5);

      widths[route] = m.foreClientWidth;
    }

    // No horizontal "spring": identical usable width on every route.
    const distinct = [...new Set(Object.values(widths))];
    expect(
      distinct.length,
      `content width differs across routes (a horizontal jump when switching): ${JSON.stringify(widths)}`,
    ).toBe(1);
  });
});

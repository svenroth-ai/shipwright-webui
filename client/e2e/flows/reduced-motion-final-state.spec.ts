/*
 * Reduced-motion FINAL-STATE walk (A20, FR-01.64 — AC1, the load-bearing AC).
 *
 * Sven runs Windows with animations OFF. `prefers-reduced-motion: reduce` is his
 * everyday state, so this spec encodes "Sven's machine": with reduced motion
 * FORCED, every directly-navigable route in A00's manifest renders its full
 * content — nothing stuck at opacity:0, staggered lists showing ALL items at
 * their final opacity, the grade ring showing its final (drawn) arc. A component
 * whose content only becomes visible via an animation is a BUG that fails here.
 *
 * The parametrised manifest routes (Mission done/live, design-gate, ships-log)
 * need per-task fixture seeding; their reduced-motion FINAL state is covered by
 * the `visual` project, which now emulates `reducedMotion: 'reduce'`
 * (playwright.config.ts), plus the Vitest reduced-motion contract tests. This
 * flow walks the routes that render without that seeding, under BOTH media
 * states, with no hardcoded host/port (helpers/env.ts) and no operator UUIDs.
 */

import { test, expect } from "@playwright/test";
import { VISUAL_ROUTES } from "../visual/routes";

// The manifest routes a browser can reach directly (no `:param`, no seeded
// per-task state). Derived from the A00 manifest so a new static route is walked
// automatically; parametrised/descriptive paths are excluded here (covered by
// the reduced-motion `visual` project).
const NAVIGABLE = VISUAL_ROUTES.filter(
  (r) => r.status === "baselined" && r.path.startsWith("/") && !/[:\s()]/.test(r.path),
).map((r) => ({ id: r.id, path: r.path }));

/** Assert every layered-entrance item rests at its FINAL opacity (never mid-fade
 *  or hidden). Zero items on a route is a pass — the point is that when they DO
 *  exist under reduced motion, they are all fully visible. */
async function assertStaggerItemsFinal(pageOpacities: string[]) {
  for (const opacity of pageOpacities) {
    expect(Number(opacity)).toBeGreaterThanOrEqual(0.99);
  }
}

async function staggerOpacities(page: import("@playwright/test").Page): Promise<string[]> {
  return page.$$eval(".motion-stagger-item", (els) =>
    els.map((el) => getComputedStyle(el as Element).opacity),
  );
}

test.describe("reduced motion renders the complete final state (AC1)", () => {
  for (const route of NAVIGABLE) {
    test(`${route.id} (${route.path}) — full content, nothing hidden by animation`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(route.path);
      // The main content region is present and painted (not a blank shell).
      const main = page.locator("main").first();
      await expect(main).toBeVisible();

      // Every staggered-entrance item is at its final opacity, not mid-fade.
      await assertStaggerItemsFinal(await staggerOpacities(page));

      // Any grade ring on the page shows its final DRAWN arc (an offset strictly
      // below the full circumference), never an empty ring waiting to animate.
      const rings = await page.$$eval('[data-testid="wizard-grade-ring"] circle[stroke-dashoffset]', (els) =>
        els.map((el) => ({
          off: Number((el as Element).getAttribute("stroke-dashoffset")),
          arr: Number((el as Element).getAttribute("stroke-dasharray")),
        })),
      );
      for (const ring of rings) {
        // A drawn arc: offset < dasharray (an empty ring would have offset == arr).
        expect(ring.off).toBeLessThan(ring.arr);
      }
    });
  }
});

test.describe("no-preference walk — the same routes still render, nothing lost", () => {
  for (const route of NAVIGABLE) {
    test(`${route.id} (${route.path}) — renders under motion`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto(route.path);
      await expect(page.locator("main").first()).toBeVisible();
    });
  }
});

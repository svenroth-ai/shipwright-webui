import { test, expect, type Page } from '@playwright/test';

/**
 * Create-CTA parity — real-browser geometry guard
 * (iterate-2026-07-21-all-projects-new-button-parity).
 *
 * Sven's requirement is literally geometric: the "New" buttons must have the
 * same styling AND sit in the same place on every page. jsdom applies no
 * stylesheet, so the vitest class fence
 * (src/components/external/ProjectCreateCascade.test.tsx) can only prove the
 * CLASS is attached — never that the resulting box matches. This spec closes
 * that gap by measuring the computed box in a real Chromium.
 *
 * Measured on main before the fix, for the record:
 *   All-Projects "New"  34.8px tall ·  98.7px wide · rgb(53,184,164) · radius 0
 *   Projects "Create"   36px    tall · 136.8px wide · rgb(14,122,107) · radius 8
 * rgb(53,184,164) is #35B8A4 — the brighter teal styles/buttons.css records as
 * RETIRED. It leaked in because the trigger hand-rolled
 * `bg-[var(--color-primary)]`, and the board header's `.chrome-dark-controls`
 * re-points --color-primary at exactly that value.
 *
 * The right-edge assertion is the "same place" half of the requirement:
 * PageHead right-aligns the actions cluster, so equal geometry ⇒ equal
 * position. Height/colour/radius are asserted exactly; WIDTH is asserted as
 * `>= --btn-min-w` because buttons.css deliberately lets a long label grow the
 * button ("ausser der Text passt nicht, dann darf er länger werden") — pinning
 * width would encode a bug, not the contract.
 */

const PROJECT_ID = 'proj-cta-parity';

const project = {
  id: PROJECT_ID,
  name: 'CTA Parity Project',
  path: '/tmp/cta-parity',
  profile: 'vite-hono',
  status: 'active',
  lastActive: '2026-07-21T09:00:00Z',
  createdAt: '2026-07-01T09:00:00Z',
  settings: { color: '#3b82f6' },
};

/** The buttons.css contract (:root --btn-h / --btn-min-w). */
const BTN_H = 36;
const BTN_MIN_W = 132;
const BTN_BG = 'rgb(14, 122, 107)'; // --btn-primary-bg #0E7A6B
const BTN_RADIUS = '8px';
/** The teal buttons.css RETIRED — must never be a create CTA's background. */
const RETIRED_TEAL = 'rgb(53, 184, 164)';

async function mockProjects(page: Page) {
  await page.route('**/api/projects', (route) =>
    route.fulfill({ json: { data: [project] } }),
  );
}

function metrics(locator: ReturnType<Page['getByTestId']>) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      height: Math.round(r.height * 10) / 10,
      width: Math.round(r.width * 10) / 10,
      right: Math.round(r.right),
      bg: cs.backgroundColor,
      radius: cs.borderTopLeftRadius,
      fontWeight: cs.fontWeight,
      fontSize: cs.fontSize,
    };
  });
}

test.describe('Create CTAs share one primary-button standard', () => {
  test('the All-Projects "New" trigger matches the standard box', async ({ page }, testInfo) => {
    await mockProjects(page);
    await page.goto('/');

    const trigger = page.getByTestId('create-menu-cascade-trigger');
    await expect(trigger).toBeVisible();
    const m = await metrics(trigger);

    expect(m.height).toBe(BTN_H);
    expect(m.width).toBeGreaterThanOrEqual(BTN_MIN_W);
    expect(m.radius).toBe(BTN_RADIUS);
    expect(m.fontWeight).toBe('600');
    expect(m.fontSize).toBe('13px');
    // The regression that shipped: the retired teal, inherited from
    // .chrome-dark-controls via a hand-rolled bg-[var(--color-primary)].
    expect(m.bg).not.toBe(RETIRED_TEAL);
    expect(m.bg).toBe(BTN_BG);

    await page.screenshot({
      path: testInfo.outputPath('all-projects-header.png'),
      fullPage: false,
    });
  });

  test('All-Projects "New" and the Projects page CTA occupy the same box + edge', async ({
    page,
  }) => {
    await mockProjects(page);

    await page.goto('/');
    const cascade = page.getByTestId('create-menu-cascade-trigger');
    await expect(cascade).toBeVisible();
    const board = await metrics(cascade);

    await page.goto('/projects');
    const create = page.getByTestId('projects-create-button');
    await expect(create).toBeVisible();
    const projects = await metrics(create);

    // Same styling…
    expect(board.height).toBe(projects.height);
    expect(board.bg).toBe(projects.bg);
    expect(board.radius).toBe(projects.radius);
    expect(board.fontWeight).toBe(projects.fontWeight);
    expect(board.fontSize).toBe(projects.fontSize);
    // …and the same place. Both ride PageHead's right-aligned actions cluster,
    // so their right edges must land on the same gutter (±1px for subpixel
    // rounding of the label-driven width).
    expect(Math.abs(board.right - projects.right)).toBeLessThanOrEqual(1);
  });

  test('the single-project split button keeps the same outer box', async ({ page }) => {
    await mockProjects(page);
    await page.goto(`/?projectId=${PROJECT_ID}`);

    const split = page.getByTestId('create-menu-split-button');
    await expect(split).toBeVisible();
    const m = await metrics(split);

    // The wrapper carries the standard box; its two halves fill it.
    expect(m.height).toBe(BTN_H);
    expect(m.width).toBeGreaterThanOrEqual(BTN_MIN_W);
    expect(m.radius).toBe(BTN_RADIUS);

    const main = await metrics(page.getByTestId('create-menu-primary'));
    expect(main.bg).toBe(BTN_BG);
    expect(main.bg).not.toBe(RETIRED_TEAL);
  });
});

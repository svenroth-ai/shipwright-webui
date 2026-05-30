import { test, expect, type Page } from '@playwright/test';

/**
 * Triage header restyle — match the Inbox/Projects full-bleed white title bar
 * (iterate-2026-05-30-page-chrome-cleanup, UAT point 3).
 *
 * Triage previously used a centred max-w-5xl header with a muted 20px h1 and
 * a "Pre-backlog intake…" subtitle paragraph. Per UAT it should match the
 * Inbox/Projects chrome: a full-bleed --color-surface (white) title bar with
 * a 24px / 700 dark h1, an inline count badge, and NO subtitle.
 *
 * Route-mock pattern mirrors triage-restyle.spec.ts (apiFetch unwraps the
 * { data } envelope for /api/projects; the bare-fetch triage endpoints do
 * not).
 */

const PROJECT_ID = 'proj-verify';

const project = {
  id: PROJECT_ID,
  name: 'Verify Project',
  path: '/tmp/verify',
  profile: 'vite-hono',
  status: 'active',
  lastActive: '2026-05-15T09:00:00Z',
  createdAt: '2026-05-01T09:00:00Z',
  settings: { color: '#3b82f6' },
};

async function mockTriage(page: Page) {
  await page.route('**/api/projects', (route) =>
    route.fulfill({ json: { data: [project] } }),
  );
  await page.route('**/api/triage/counts', (route) =>
    route.fulfill({ json: { counts: { [PROJECT_ID]: 0 }, total: 0 } }),
  );
  await page.route(`**/api/triage/${PROJECT_ID}`, (route) =>
    route.fulfill({ json: { items: [] } }),
  );
}

test.describe('Triage header restyle', () => {
  test('full-bleed white title bar, 24px/700 h1, count badge, no subtitle', async ({
    page,
  }, testInfo) => {
    await mockTriage(page);
    await page.goto('/triage');

    await expect(page.getByTestId('triage-page')).toBeVisible();

    const h1 = page.getByRole('heading', { name: /^Triage$/ });
    await expect(h1).toBeVisible();

    // 24px / >=700 dark heading — matches Inbox/Projects.
    const fontSize = await h1.evaluate((el) => getComputedStyle(el).fontSize);
    const fontWeight = await h1.evaluate(
      (el) => getComputedStyle(el).fontWeight,
    );
    expect(fontSize).toBe('24px');
    expect(Number(fontWeight)).toBeGreaterThanOrEqual(700);

    // Full-bleed surface bar: the header's bar ancestor is the white
    // --color-surface with a bottom border.
    const bar = await h1.evaluate((el) => {
      const barEl = el.closest('header')?.parentElement as HTMLElement;
      const cs = getComputedStyle(barEl);
      return { bg: cs.backgroundColor, borderBottom: cs.borderBottomWidth };
    });
    expect(bar.bg).toBe('rgb(255, 255, 255)');
    expect(bar.borderBottom).not.toBe('0px');

    // Inline count badge present.
    await expect(page.getByTestId('triage-header-count')).toBeVisible();

    // Subtitle paragraph is gone.
    await expect(
      page.getByText('Pre-backlog intake', { exact: false }),
    ).toHaveCount(0);

    await page.screenshot({
      path: testInfo.outputPath('triage-header.png'),
      fullPage: true,
    });
  });
});

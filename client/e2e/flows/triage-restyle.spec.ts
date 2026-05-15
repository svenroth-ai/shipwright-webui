import { test, expect, type Page } from '@playwright/test';

/**
 * Triage restyle — real-browser visual regression guard
 * (iterate-20260515-triage-card-styling).
 *
 * The triage cards previously rendered with no background fill, so the
 * warm-beige page showed through ("beige on beige"). This spec route-mocks
 * the triage API and asserts the *computed* styles in a real Chromium —
 * catching the Tailwind-silent-drop failure mode that jsdom unit tests
 * cannot see.
 *
 * Screenshots are written to the Playwright per-test output dir for
 * manual evidence review.
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

function triageItem(over: Record<string, unknown>) {
  return {
    id: 'trg-0000',
    ts: '2026-05-15T08:00:00Z',
    originalTs: '2026-05-15T08:00:00Z',
    source: 'phaseQuality',
    severity: 'high',
    kind: 'bug',
    title: 'Placeholder',
    detail: 'Placeholder detail body.',
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: 'phaseQuality:placeholder',
    status: 'triage',
    suggestedPriority: 'P1',
    suggestedDomain: 'engineering',
    statusBy: null,
    statusReason: null,
    promotedTaskId: null,
    ...over,
  };
}

const items = [
  triageItem({
    id: 'trg-aaaa1111',
    severity: 'critical',
    source: 'compliance',
    title: 'Traceability matrix references a stale file path',
    detail: 'FR-01.30 maps to client/src/components/triage/Old.tsx which no longer exists.',
    suggestedPriority: 'P0',
  }),
  triageItem({
    id: 'trg-bbbb2222',
    severity: 'high',
    source: 'phaseQuality',
    title: 'C1 — no phase_completed event for phase=iterate',
    detail: 'Phase-Quality Tier-1 FAIL: the iterate phase produced no completion event.',
    suggestedPriority: 'P1',
  }),
  triageItem({
    id: 'trg-cccc3333',
    severity: 'medium',
    source: 'phaseQuality',
    title: 'C5 — [Unreleased]/Added sub-section missing',
    detail: 'CHANGELOG drop-directory has no Added entry for the last run.',
    suggestedPriority: 'P2',
  }),
];

async function mockTriage(page: Page) {
  // apiFetch() unwraps an { data: T } envelope; the bare-fetch triage
  // endpoints below do not.
  await page.route('**/api/projects', (route) =>
    route.fulfill({ json: { data: [project] } }),
  );
  await page.route('**/api/triage/counts', (route) =>
    route.fulfill({ json: { counts: { [PROJECT_ID]: items.length }, total: items.length } }),
  );
  await page.route(`**/api/triage/${PROJECT_ID}`, (route) =>
    route.fulfill({ json: { items } }),
  );
}

test.describe('Triage restyle — white-surface cards + wizard-matched dialogs', () => {
  test('cards render on the white --color-surface with a real shadow', async ({ page }, testInfo) => {
    await mockTriage(page);
    await page.goto('/triage');

    const card = page.getByTestId('triage-item-trg-bbbb2222');
    await expect(card).toBeVisible();

    const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    const shadow = await card.evaluate((el) => getComputedStyle(el).boxShadow);
    // White surface — NOT the transparent / beige-page-bleed of the old card.
    expect(bg).toBe('rgb(255, 255, 255)');
    expect(shadow).not.toBe('none');

    await page.screenshot({
      path: testInfo.outputPath('triage-page.png'),
      fullPage: true,
    });
  });

  test('detail dialog matches the Project-wizard surface tokens', async ({ page }, testInfo) => {
    await mockTriage(page);
    await page.goto('/triage');

    await page.getByTestId('triage-item-trg-bbbb2222').click();
    const modal = page.getByTestId('triage-detail-modal');
    await expect(modal).toBeVisible();

    const bg = await modal.evaluate((el) => getComputedStyle(el).backgroundColor);
    const shadow = await modal.evaluate((el) => getComputedStyle(el).boxShadow);
    const radius = await modal.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(bg).toBe('rgb(255, 255, 255)');
    expect(shadow).not.toBe('none');
    expect(radius).toBe('12px'); // --radius-card

    await page.screenshot({ path: testInfo.outputPath('triage-detail-modal.png') });
  });

  test('promote dialog matches the Project-wizard surface tokens', async ({ page }, testInfo) => {
    await mockTriage(page);
    await page.goto('/triage');

    await page.getByTestId('triage-item-trg-bbbb2222').click();
    await page.getByTestId('triage-promote').click();
    const modal = page.getByTestId('triage-promote-modal');
    await expect(modal).toBeVisible();

    const bg = await modal.evaluate((el) => getComputedStyle(el).backgroundColor);
    const radius = await modal.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(bg).toBe('rgb(255, 255, 255)');
    expect(radius).toBe('12px');

    await page.screenshot({ path: testInfo.outputPath('triage-promote-modal.png') });
  });
});

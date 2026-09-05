import { test, expect, type Page } from '@playwright/test';

/**
 * Diagnostics — Versions section (iterate-2026-09-05-nav-collapse-and-
 * version-badges).
 *
 * The page shows the webui's own version (`app.version`) and the shipwright
 * plugin suite version (`shipwrightPlugin.version`) at a glance. Route-mocks
 * /api/diagnostics like diagnostics-launchers-removed.spec.ts.
 */

const snapshot = {
  app: { name: 'shipwright-command-center', version: '9.9.9-e2e' },
  shipwrightPlugin: { version: '0.42.0' as string | null },
  claudeCli: {
    raw: 'claude 2.0.0 (Claude Code)',
    parsed: { major: 2, minor: 0, patch: 0 },
    supported: true,
    minSupported: '1.0.0',
  },
  sessions: { total: 3, byState: { active: 1, idle: 2 } },
  launchers: {
    copy: { available: true },
    terminal: { available: false, reason: 'not on PATH' },
    vscode: { available: false, reason: 'not on PATH' },
    desktop: { available: false, reason: 'not on PATH' },
  },
};

async function mockDiagnostics(page: Page, overrides: Partial<typeof snapshot> = {}) {
  await page.route('**/api/diagnostics', (route) =>
    route.fulfill({ json: { ...snapshot, ...overrides } }),
  );
}

test.describe('Diagnostics — Versions section', () => {
  test('shows the webui version and the shipwright plugin version', async ({ page }) => {
    await mockDiagnostics(page);
    await page.goto('/diagnostics');

    await expect(page.getByTestId('diagnostics-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Versions' })).toBeVisible();
    await expect(page.getByText('9.9.9-e2e')).toBeVisible();
    await expect(page.getByText('0.42.0')).toBeVisible();
  });

  test('shows a "(not detected)" fallback when the plugin version is unresolvable', async ({
    page,
  }) => {
    await mockDiagnostics(page, { shipwrightPlugin: { version: null } });
    await page.goto('/diagnostics');

    await expect(page.getByRole('heading', { name: 'Versions' })).toBeVisible();
    await expect(page.getByText('(not detected)')).toBeVisible();
  });

  test('degrades to the fallback (no crash) when a stale server omits shipwrightPlugin entirely', async ({
    page,
  }) => {
    // Deploy-skew guard: an older server (or a rolled-back API) that predates
    // this field must not blank the whole page — the additive field is
    // optional-chained, not assumed present.
    const { shipwrightPlugin: _omitted, ...withoutPluginField } = snapshot;
    await page.route('**/api/diagnostics', (route) =>
      route.fulfill({ json: withoutPluginField }),
    );
    await page.goto('/diagnostics');

    await expect(page.getByTestId('diagnostics-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Versions' })).toBeVisible();
    await expect(page.getByText('(not detected)')).toBeVisible();
  });
});

import { test, expect, type Page } from '@playwright/test';

/**
 * Diagnostics — Launchers section removed
 * (iterate-2026-05-30-page-chrome-cleanup, UAT point 2).
 *
 * The Diagnostics page previously rendered a "Launchers" section listing
 * Copy / Terminal / VSCode / Desktop availability. Per UAT that adds noise
 * (launcher availability is surfaced contextually on the task header), so
 * the section is dropped from the page. This spec route-mocks
 * /api/diagnostics and asserts in a real Chromium that the Claude CLI +
 * Sessions sections still render while the Launchers section is gone.
 *
 * /api/diagnostics is fetched via httpJson() (NO { data } envelope), so the
 * mock returns the bare DiagnosticsSnapshot.
 */

const snapshot = {
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

async function mockDiagnostics(page: Page) {
  await page.route('**/api/diagnostics', (route) =>
    route.fulfill({ json: snapshot }),
  );
}

test.describe('Diagnostics — Launchers section removed', () => {
  test('renders CLI + Sessions sections but no Launchers section', async ({
    page,
  }, testInfo) => {
    await mockDiagnostics(page);
    await page.goto('/diagnostics');

    await expect(page.getByTestId('diagnostics-page')).toBeVisible();

    // Sanity: the page rendered its surviving sections.
    await expect(
      page.getByRole('heading', { name: 'Claude CLI' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();

    // The Launchers section heading must be gone…
    await expect(
      page.getByRole('heading', { name: 'Launchers' }),
    ).toHaveCount(0);
    // …and no launcher rows leak through.
    await expect(page.getByText('VSCode', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Desktop', { exact: true })).toHaveCount(0);

    await page.screenshot({
      path: testInfo.outputPath('diagnostics-page.png'),
      fullPage: true,
    });
  });
});

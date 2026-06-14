import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test('navigates to settings page', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('main')).toBeVisible();
  });

  // iterate-2026-06-14-actions-config-ux — the stale "Launcher preferences"
  // card was removed; the actions-config surface remains.
  test('shows the actions-config surface and not the removed Launcher card', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('settings-configure-actions')).toBeVisible();
    await expect(page.getByText('Configure actions')).toBeVisible();
    await expect(page.getByText('Launcher preferences')).toHaveCount(0);
  });
});

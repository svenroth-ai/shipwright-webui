import { test, expect } from '@playwright/test';

/**
 * Triage Tab — smoke E2E (FR-01.30, ADR-101).
 *
 * Mirrors 02-inbox.spec.ts shape: page reachable, sidebar nav visible,
 * empty-state renders. Full promote click-through requires per-project
 * fixture state (`<path>/.shipwright/triage.jsonl`) which the standing
 * E2E harness doesn't provision; that path is covered by the server-side
 * route integration tests + client-side PromoteModal.test instead.
 */

test.describe('Triage tab', () => {
  test('navigates to /triage and renders the page header', async ({ page }) => {
    await page.goto('/triage');
    await expect(page).toHaveURL('/triage');
    await expect(page.getByTestId('triage-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Triage$/i })).toBeVisible();
  });

  test('sidebar exposes a Triage entry that links to /triage', async ({ page }) => {
    await page.goto('/');
    const sidebarLink = page.getByRole('link', { name: /Triage/i });
    await expect(sidebarLink.first()).toBeVisible();
    await sidebarLink.first().click();
    await expect(page).toHaveURL('/triage');
  });

  test('renders an empty-state line when no triage items pending', async ({ page }) => {
    await page.goto('/triage');
    // Either the empty-state is visible, or items are present (depends on
    // whether the dev environment has registered projects with triage.jsonl
    // files). This smoke test accepts both.
    await page.waitForLoadState('networkidle');
    const emptyState = page.getByTestId('triage-empty-state');
    const noProjects = page.getByTestId('triage-no-projects');
    const hasItems = page.getByTestId(/^triage-item-/);
    const visible = await Promise.race([
      emptyState.waitFor({ timeout: 4000 }).then(() => 'empty'),
      noProjects.waitFor({ timeout: 4000 }).then(() => 'no-projects'),
      hasItems.first().waitFor({ timeout: 4000 }).then(() => 'items'),
    ]).catch(() => 'unknown');
    expect(['empty', 'no-projects', 'items']).toContain(visible);
  });
});

import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect } from '@playwright/test';

test.describe('Board Navigation', () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "01-board-navigation" });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test('loads kanban board at root route', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
  });

  test('sidebar navigation links are visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /board/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /inbox/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /projects/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /settings/i })).toBeVisible();
  });

  test('create-task split-button is visible', async ({ page }) => {
    // Iterate 3 section 03 — the inline form was replaced by the
    // `+ New ▾` split-button + NewIssueModal. The primary sub-button
    // is the discoverable entry point.
    await page.goto('/');
    await expect(page.getByTestId('create-menu-primary')).toBeVisible();
  });
});

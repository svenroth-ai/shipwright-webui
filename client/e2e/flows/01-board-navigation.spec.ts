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

  test('status filter is the compact funnel dropdown, not the bare-on-photo pill strip (on-photo-legibility)', async ({ page }) => {
    // The old top-left STATUS chip strip is retired: the sole status-filter
    // affordance is now the compact funnel in the taupe header (every viewport).
    // Filtering behaviour is unchanged — this proves the relocation on desktop.
    await page.goto('/');
    await expect(page.getByTestId('task-board-header')).toBeVisible();
    await expect(page.getByTestId('board-filter-status')).toHaveCount(0);
    const trigger = page.getByTestId('board-filter-menu-trigger');
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByTestId('board-filter-menu')).toBeVisible();
    // Prototype `__filterMenu` — the "All" row (clears the filter) is present.
    await expect(page.getByTestId('board-filter-menu-all')).toBeVisible();

    // The funnel is WIRED to the board's statusFilter state (a disconnected
    // dropdown would fail here). A CheckboxItem uses preventDefault so the menu
    // stays OPEN across a multi-select toggle; selecting a state raises the
    // active dot on the trigger. Keyboard-selected to also cover a11y.
    await page.getByTestId('board-filter-menu-item-active').press('Enter');
    await expect(page.getByTestId('board-filter-menu')).toBeVisible();
    await expect(page.getByTestId('board-filter-menu-dot')).toBeVisible();
    // The "All" row clears the filter and closes the menu → dot gone.
    await page.getByTestId('board-filter-menu-all').click();
    await expect(page.getByTestId('board-filter-menu-dot')).toHaveCount(0);
  });
});

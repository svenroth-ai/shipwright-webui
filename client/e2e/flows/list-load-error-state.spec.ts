import { test, expect, type Page } from '@playwright/test';

/**
 * List load-error state — real-browser proof (FR-01.01 triage trg-0f040744
 * finding 1). Unit tests already cover each page's branch logic in jsdom;
 * this spec proves the same distinct error state (not the onboarding empty
 * state) actually renders and recovers via Retry against a real Chromium +
 * running stack.
 */

async function failThenRecover(page: Page, urlPattern: string, okBody: unknown) {
  let failing = true;
  await page.route(urlPattern, (route) => {
    if (failing) {
      return route.fulfill({ status: 500, json: { error: 'boom' } });
    }
    return route.fulfill({ json: okBody });
  });
  return () => {
    failing = false;
  };
}

test.describe('List load-error state (not the onboarding empty state)', () => {
  test('Projects page shows a distinct load-error state and recovers on retry', async ({ page }) => {
    const recover = await failThenRecover(page, '**/api/projects', { data: [] });

    await page.goto('/projects');

    await expect(page.getByTestId('projects-load-error')).toBeVisible();
    await expect(page.getByTestId('projects-empty')).toHaveCount(0);

    recover();
    await page.getByTestId('projects-load-error-retry').click();

    await expect(page.getByTestId('projects-empty')).toBeVisible();
    await expect(page.getByTestId('projects-load-error')).toHaveCount(0);
  });

  test("Task Board shows a distinct load-error state, not the onboarding empty state", async ({
    page,
  }) => {
    await page.route('**/api/projects', (route) => route.fulfill({ json: { data: [] } }));
    const recover = await failThenRecover(page, '**/api/external/tasks*', { tasks: [] });

    await page.goto('/');

    await expect(page.getByTestId('task-board-load-error')).toBeVisible();
    await expect(page.getByTestId('task-board-empty')).toHaveCount(0);

    recover();
    await page.getByTestId('task-board-load-error-retry').click();

    await expect(page.getByTestId('task-board-load-error')).toHaveCount(0);
  });
});

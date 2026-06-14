/*
 * iterate-2026-06-14-actions-config-ux — E2E: the project edit modal
 * (ProjectSettingsDialog, opened from the Projects-table gear) hosts the
 * actions.json upload surface (compact mode). Seeds a project via the API,
 * opens the gear dialog, and asserts the Actions configuration section +
 * the per-project row + Upload control render in a real browser.
 */
import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test.describe('Project Settings — actions config', () => {
  test('edit modal hosts the actions upload surface', async ({ page, request }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'e2e-actions-'));
    const res = await request.post('/api/projects', {
      data: { name: 'E2E Actions Proj', path: dir },
    });
    expect(res.ok()).toBeTruthy();
    const created = (await res.json()) as { data?: { id: string }; id?: string };
    const id = (created.data ?? created).id as string;
    expect(id).toBeTruthy();

    try {
      await page.goto('/projects');
      await page.getByTestId(`projects-settings-${id}`).click();

      await expect(page.getByTestId('project-settings-dialog')).toBeVisible();
      // The new Actions configuration section + per-project row + Upload control.
      await expect(page.getByTestId('project-settings-actions')).toBeVisible();
      await expect(page.getByTestId(`actions-config-row-${id}`)).toBeVisible();
      await expect(page.getByText('Upload .json')).toBeVisible();
    } finally {
      // Best-effort cleanup so the isolated registry doesn't accrete projects.
      await request.delete(`/api/projects/${id}`).catch(() => {});
    }
  });
});

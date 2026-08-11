/*
 * Spec 49 — project filter persists across reload (FR-03.03..05).
 *
 * Iterate 3 section 02, refreshed in iterate 3.8a after the chip-bar UI
 * was replaced by <ProjectFilterDropdown> (iterate 3 remediation Phase B1).
 * Creates two projects, seeds one task per project via the API, then
 * exercises the header dropdown:
 *   1. "All projects" shows both tasks.
 *   2. Open dropdown + pick project-B → only project-B card remains.
 *   3. Reload → filter persists via localStorage + URL.
 *   4. Open dropdown + pick "All projects" → both return.
 */

import { test, expect } from "@playwright/test";
import { cleanupCwd, makeTaskCwd } from "../helpers/task-fixture";

test.describe("Project filter dropdown (iterate 3.8a)", () => {
  test("filter persists across reload + toggles back to all", async ({ page, request }) => {
    const suffix = Date.now();
    const projectACwd = await makeTaskCwd("proj-a-e2e-");
    const projectBCwd = await makeTaskCwd("proj-b-e2e-");

    // Seed two real projects via the API. Use directories that already
    // exist on the test machine (cwd is fine) to bypass the existsSync
    // guard in ProjectManager.create.
    const projA = await request.post("/api/projects", {
      data: {
        name: `proj-a-${suffix}`,
        path: projectACwd,
        profile: "default",
        status: "active",
      },
    });
    const projB = await request.post("/api/projects", {
      data: {
        name: `proj-b-${suffix}`,
        path: projectBCwd,
        profile: "default",
        status: "active",
      },
    });
    const { data: aBody } = (await projA.json()) as { data: { id: string } };
    const { data: bBody } = (await projB.json()) as { data: { id: string } };

    // Seed one task per project via POST /api/external/tasks.
    const tA = await request.post("/api/external/tasks", {
      data: { title: `task-A-${suffix}`, cwd: projectACwd, projectId: aBody.id },
    });
    const tB = await request.post("/api/external/tasks", {
      data: { title: `task-B-${suffix}`, cwd: projectBCwd, projectId: bBody.id },
    });
    const { task: taskA } = (await tA.json()) as { task: { taskId: string } };
    const { task: taskB } = (await tB.json()) as { task: { taskId: string } };

    try {
      await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    // Dropdown trigger is present and lists both projects when opened.
    const trigger = page.getByTestId("project-filter-dropdown");
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByTestId(`project-filter-dropdown-item-${aBody.id}`)).toBeVisible();
    await expect(page.getByTestId(`project-filter-dropdown-item-${bBody.id}`)).toBeVisible();
    // Close without picking — ESC returns to all-projects state.
    await page.keyboard.press("Escape");

    // All-projects mode — both cards visible.
    await expect(page.getByText(`task-A-${suffix}`)).toBeVisible();
    await expect(page.getByText(`task-B-${suffix}`)).toBeVisible();

    // Pick project-B via dropdown → only B remains.
    await trigger.click();
    await page.getByTestId(`project-filter-dropdown-item-${bBody.id}`).click();
    await expect(page.getByText(`task-B-${suffix}`)).toBeVisible();
    await expect(page.getByText(`task-A-${suffix}`)).not.toBeVisible();
    // URL reflects the filter.
    expect(page.url()).toContain(`projectId=${bBody.id}`);

    // Reload — filter persists (URL carries it, localStorage mirrors it).
    await page.reload();
    await expect(page.getByTestId("task-board-page")).toBeVisible();
    await expect(page.getByText(`task-B-${suffix}`)).toBeVisible();
    await expect(page.getByText(`task-A-${suffix}`)).not.toBeVisible();

    // Pick "All projects" via dropdown → both return.
    await trigger.click();
    await page.getByTestId("project-filter-dropdown-item-all").click();
    await expect(page.getByText(`task-A-${suffix}`)).toBeVisible();
    await expect(page.getByText(`task-B-${suffix}`)).toBeVisible();

    } finally {
      // Owner deletes first so live PTYs release their directories before rm.
      await request.delete(`/api/external/tasks/${taskA.taskId}`).catch(() => {});
      await request.delete(`/api/external/tasks/${taskB.taskId}`).catch(() => {});
      await request.delete(`/api/projects/${aBody.id}`).catch(() => {});
      await request.delete(`/api/projects/${bBody.id}`).catch(() => {});
      await cleanupCwd(projectACwd);
      await cleanupCwd(projectBCwd);
    }
  });
});

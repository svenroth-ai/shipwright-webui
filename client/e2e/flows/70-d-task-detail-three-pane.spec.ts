/*
 * Flow D — TaskDetail 3-pane coverage.
 *
 *   1. TaskDetailPage renders header + 3 panes (folder tree / transcript
 *      / smart viewer). No composer, no old LaunchRow/CopyCommandCard.
 *   2. Header CTA is state-dependent (Launch for draft, none for done).
 *   3. ProjectChipMenu popover lists projects + "Unassigned".
 *   4. Folder Tree root fetches on mount; clicking a dir lazy-expands.
 *   5. Clicking README.md shows the MarkdownRenderer with content.
 *   6. Splitter ArrowRight persists leftWidth in localStorage.
 */

import { cleanupProject, seedLocalStorage, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { apiUrl } from "../helpers/env";
import { test, expect } from "@playwright/test";

// A00 — was a pinned operator UUID; seeded via the real API in beforeEach.
let project: SeededProject;



async function createTask(
  request: import("@playwright/test").APIRequestContext,
  title: string,
) {
  const resp = await request.post(apiUrl("/api/external/tasks"), {
    data: { title, cwd: project.path, projectId: project.projectId },
  });
  expect(resp.ok()).toBeTruthy();
  const body = (await resp.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

test.describe("Flow D — TaskDetail 3-pane", () => {
  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, {
      name: "70-d-task-detail-three-pane",
      adopted: true,
      // The task cwd IS the project dir, and the folder tree lists it — so it
      // needs real files. This used to be `C:\tmp\uat-1`, a Windows-only
      // absolute path on one developer's disk that does not exist on a CI runner.
      files: {
        "README.md": "# Seeded\n\nE2E fixture file.\n",
        "src/index.ts": "export const seeded = true;\n",
      },
    });
    await setActiveProject(page, project.projectId);
    // The center tab is persisted and defaults to "terminal", so the
    // transcript pane is hidden on a fresh profile.
    await seedLocalStorage(page, {
      "webui:embedded-terminal-default-tab": '"transcript"',
    });
  });
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("3-pane layout renders header + folder tree + transcript + viewer without legacy components", async ({
    page,
    request,
  }) => {
    const taskId = await createTask(request, `spec70d-layout-${Date.now()}`);
    await page.goto(`/tasks/${taskId}`);
    await expect(page.getByTestId("task-detail-page")).toBeVisible();

    // Structural: header + 3 panes.
    await expect(page.getByTestId("task-detail-header")).toBeVisible();
    await expect(page.getByTestId("folder-tree")).toBeVisible();
    await expect(page.getByTestId("task-detail-transcript")).toBeVisible();
    await expect(page.getByTestId("task-detail-viewer")).toBeVisible();

    // Regression: legacy LaunchRow and CopyCommandCard components were
    // deleted in iterate 3 section 04 (plan § 7 O15). Their testids must
    // not be in the DOM anywhere on /tasks/:id.
    await expect.soft(page.getByTestId("launch-row")).toHaveCount(0);
    await expect.soft(page.getByTestId("copy-command-card")).toHaveCount(0);

    // Regression (DO-NOT #3): no chat composer / textarea on /tasks/:id.
    await expect(page.locator("textarea")).toHaveCount(0);
    await expect.soft(page.locator('[data-testid*="composer"]')).toHaveCount(0);
    await expect.soft(page.locator('[data-testid*="message-input"]')).toHaveCount(0);

    // Two splitters, both marked role="separator".
    await expect(page.locator('[role="separator"]').filter({ has: page.locator('[data-testid^="splitter-"]') })).toHaveCount(0);
    const splitters = page.locator('[data-testid^="splitter-"][role="separator"]');
    await expect(splitters).toHaveCount(2);

    // State-dependent CTA — draft tasks show "Launch in Terminal".
    await expect(page.getByTestId("cta-launch-in-terminal")).toBeVisible();
    await expect(page.getByTestId("cta-copy-resume-command")).toHaveCount(0);

    await request.delete(apiUrl(`/api/external/tasks/${taskId}`));
  });

  test("ProjectChipMenu opens popover + lists all projects + Unassigned", async ({
    page,
    request,
  }) => {
    const taskId = await createTask(request, `spec70d-chip-${Date.now()}`);
    await page.goto(`/tasks/${taskId}`);
    await expect(page.getByTestId("task-detail-header")).toBeVisible();

    // iterate 3.7d-b2: TaskDetail no longer renders the chip button — the
    // ProjectChipMenu is controlled and opened via the 3-dots "Move to
    // project…" menu item. Drive the menu path instead.
    await page.getByTestId("task-detail-menu-trigger").click();
    await page.getByTestId("task-detail-menu-move-project").click();
    const popover = page.getByTestId("project-chip-popover");
    await expect(popover).toBeVisible();

    // UAT project option is present.
    await expect(page.getByTestId(`project-chip-option-${project.projectId}`)).toBeVisible();
    // Unassigned option is present.
    await expect(page.getByTestId("project-chip-option-unassigned")).toBeVisible();

    // Close the popover to not interfere with subsequent test runs.
    await page.keyboard.press("Escape");

    await request.delete(apiUrl(`/api/external/tasks/${taskId}`));
  });

  test("Folder tree lazy-loads root and SmartViewer renders a markdown file", async ({
    page,
    request,
  }) => {
    const taskId = await createTask(request, `spec70d-tree-${Date.now()}`);

    // Pre-capture the tree request so we verify it actually fires.
    const treeReqPromise = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/external/projects/${project.projectId}/tree`) &&
        r.request().method() === "GET",
    );

    await page.goto(`/tasks/${taskId}`);
    await expect(page.getByTestId("folder-tree")).toBeVisible();

    const treeResp = await treeReqPromise;
    expect(treeResp.ok()).toBeTruthy();

    // README.md row visible (we seeded it in C:/tmp/uat-1).
    const readmeRow = page.getByTestId("folder-tree-row-README.md");
    await expect(readmeRow).toBeVisible({ timeout: 5_000 });

    // Click → fires GET /file?path=README.md → SmartViewer renders markdown.
    const fileReqPromise = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/external/projects/${project.projectId}/file`) &&
        r.request().method() === "GET",
    );
    await readmeRow.click();
    const fileResp = await fileReqPromise;
    expect(fileResp.ok()).toBeTruthy();

    // SmartViewer shows the MarkdownRenderer.
    await expect(page.getByTestId("smart-viewer-markdown")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("smart-viewer-markdown")).toContainText("UAT 1 Test Project");

    await request.delete(apiUrl(`/api/external/tasks/${taskId}`));
  });

  test("splitter ArrowRight persists leftWidth in localStorage", async ({
    page,
    request,
  }) => {
    const taskId = await createTask(request, `spec70d-splitter-${Date.now()}`);
    await page.goto(`/tasks/${taskId}`);
    const splitter = page.getByTestId("splitter-left");
    await expect(splitter).toBeVisible();

    await splitter.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");

    // Persistence is debounced; wait up to 2 s.
    await page.waitForFunction(
      () => {
        const raw = localStorage.getItem("webui.taskDetail.leftWidth");
        if (raw === null) return false;
        const n = Number(JSON.parse(raw));
        return Number.isFinite(n) && n > 0;
      },
      { timeout: 2_500 },
    );

    await request.delete(apiUrl(`/api/external/tasks/${taskId}`));
  });
});

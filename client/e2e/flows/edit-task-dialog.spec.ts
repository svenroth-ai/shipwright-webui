/*
 * Spec — Edit Task dialog. iterate-2026-05-18-edit-task-dialog.
 *
 * End-to-end proof against a live stack:
 *   - a never-started Backlog task can be re-edited; the PATCH round-trips
 *     to sdk-sessions.json and the TaskDetail header reflects it (AC-1/3/5);
 *   - a started task's brief renders read-only in the dialog (AC-2);
 *   - the board card ⋯ menu exposes "Edit task" (AC-7).
 *
 * Tasks are seeded via the API so the test isolates from the create form.
 */
import { test, expect } from "@playwright/test";

test.describe("Edit Task dialog", () => {
  test("edits a never-started Backlog task — PATCH round-trips + header reflects it", async ({
    page,
    request,
  }) => {
    const create = await request.post("/api/external/tasks", {
      data: {
        title: "edit-e2e",
        cwd: process.cwd(),
        description: "original brief",
      },
    });
    expect(create.ok()).toBeTruthy();
    const { task } = (await create.json()) as { task: { taskId: string } };

    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("task-detail-page")).toBeVisible();

    // AC-5/AC-3 — the seeded brief shows in the header disclosure.
    await expect(page.getByTestId("task-description-body")).toHaveText(
      /original brief/,
    );

    // Open the Edit dialog from the header ⋯ menu.
    await page.getByTestId("task-detail-menu-trigger").click();
    await page.getByTestId("task-detail-menu-edit-task").click();
    await expect(page.getByTestId("edit-task-modal")).toBeVisible();

    // Every field is editable on a never-started task (AC-1).
    await page.getByTestId("edit-task-description-input").fill("rewritten brief");
    await page.getByTestId("edit-task-domain-input").fill("auth");
    await page.getByTestId("edit-task-save").click();

    // Dialog closes; the header disclosure reflects the new text live.
    await expect(page.getByTestId("edit-task-modal")).toHaveCount(0);
    await expect(page.getByTestId("task-description-body")).toHaveText(
      /rewritten brief/,
    );

    // Hard reload — proves the PATCH persisted to sdk-sessions.json.
    await page.reload();
    await expect(page.getByTestId("task-description-body")).toHaveText(
      /rewritten brief/,
    );

    const fresh = (await (
      await request.get(`/api/external/tasks/${task.taskId}`)
    ).json()) as { task: { description?: string; domain?: string } };
    expect(fresh.task.description).toBe("rewritten brief");
    expect(fresh.task.domain).toBe("auth");
  });

  test("a started task shows the brief read-only in the Edit dialog (AC-2)", async ({
    page,
    request,
  }) => {
    const create = await request.post("/api/external/tasks", {
      data: {
        title: "started-e2e",
        cwd: process.cwd(),
        description: "frozen brief",
      },
    });
    const { task } = (await create.json()) as { task: { taskId: string } };
    // Launch → state leaves `draft` + `launchedAt` is set → "started".
    const launch = await request.post(
      `/api/external/tasks/${task.taskId}/launch`,
      { data: {} },
    );
    expect(launch.ok()).toBeTruthy();

    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("task-detail-page")).toBeVisible();

    await page.getByTestId("task-detail-menu-trigger").click();
    await page.getByTestId("task-detail-menu-edit-task").click();
    await expect(page.getByTestId("edit-task-modal")).toBeVisible();

    // The brief is frozen — read-only display, no editable input.
    await expect(page.getByTestId("edit-task-readonly-description")).toHaveText(
      /frozen brief/,
    );
    await expect(page.getByTestId("edit-task-description-input")).toHaveCount(0);
    // Routing metadata stays editable.
    await expect(page.getByTestId("edit-task-domain-input")).toBeVisible();
  });

  test("the board card ⋯ menu exposes Edit task (AC-7)", async ({
    page,
    request,
  }) => {
    const create = await request.post("/api/external/tasks", {
      data: { title: "card-edit-e2e", cwd: process.cwd() },
    });
    const { task } = (await create.json()) as { task: { taskId: string } };

    await page.goto("/");
    await expect(page.getByTestId(`task-card-${task.taskId}`)).toBeVisible();
    await page.getByTestId(`task-card-menu-${task.taskId}`).click();
    const editItem = page.getByTestId(`task-card-edit-${task.taskId}`);
    await expect(editItem).toBeVisible();
    await editItem.click();
    await expect(page.getByTestId("edit-task-modal")).toBeVisible();
  });
});

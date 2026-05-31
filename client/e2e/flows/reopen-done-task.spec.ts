/*
 * Flow — Re-open a done task back to the Backlog column.
 *
 * iterate-2026-05-31-reopen-done-task. Counterpart of move-to-backlog.spec.ts
 * for the terminal `done` state.
 *
 * End-to-end coverage of the board-level UX: a done task's TaskCard carries
 * a "Re-open" item in its ⋯-menu; selecting it POSTs
 * /api/external/tasks/:id/reopen and the card relocates from the Done column
 * to the Backlog (Draft) column. The server-side state flip is verified
 * independently via the REST API.
 *
 * Targets the live servers (localhost:3847 backend + localhost:5173 vite,
 * override the API base via WEBUI_API_URL) and cleans up the task it creates.
 */
import { test, expect } from "@playwright/test";

const API = process.env.WEBUI_API_URL || "http://127.0.0.1:3847";

test.describe("Re-open done task", () => {
  test("a done task relocates to the Backlog column via the card ⋯-menu", async ({
    page,
    request,
  }) => {
    const projResp = await request.get(`${API}/api/projects`);
    expect(projResp.ok()).toBeTruthy();
    const projBody = (await projResp.json()) as {
      data?: Array<{ id: string; path?: string }>;
    };
    const project = projBody.data?.[0];
    const projectId = project?.id ?? "unassigned";
    const cwd = project?.path ?? "/tmp/reopen-done-e2e";

    const title = `reopen-done-e2e-${Date.now()}`;
    const createResp = await request.post(`${API}/api/external/tasks`, {
      data: { title, cwd, projectId },
    });
    expect(createResp.ok()).toBeTruthy();
    const { task } = (await createResp.json()) as { task: { taskId: string } };
    const taskId = task.taskId;

    try {
      // Drive the task to the terminal `done` state via /close (the same
      // endpoint the "Close (mark done)" menu item uses).
      const closeResp = await request.post(
        `${API}/api/external/tasks/${taskId}/close`,
        { data: {} },
      );
      expect(
        closeResp.ok(),
        `close must succeed — got ${closeResp.status()}`,
      ).toBeTruthy();

      await page.addInitScript((id) => {
        try {
          localStorage.setItem("webui.activeProjectId", id);
        } catch {
          /* noop */
        }
      }, projectId);
      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible();
      await expect(page.getByTestId(`task-card-${taskId}`)).toBeVisible({
        timeout: 6_000,
      });
      await expect(page.getByTestId("column-done")).toContainText(title);

      // Open the card ⋯-menu and select "Re-open".
      await page.getByTestId(`task-card-menu-${taskId}`).click();
      const reopenItem = page.getByTestId(`task-card-reopen-${taskId}`);
      await expect(reopenItem).toBeVisible();

      const reopenResp = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/external/tasks/${taskId}/reopen`) &&
          r.request().method() === "POST",
      );
      await reopenItem.click();
      expect((await reopenResp).ok()).toBeTruthy();

      // The card has relocated to the Backlog (Draft) column.
      await expect(page.getByTestId("column-draft")).toContainText(title, {
        timeout: 6_000,
      });
      await expect(page.getByTestId("column-done")).not.toContainText(title);

      // Negative-visibility: the now-`draft` card no longer offers "Re-open".
      await page.getByTestId(`task-card-menu-${taskId}`).click();
      await expect(
        page.getByTestId(`task-card-reopen-${taskId}`),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");

      // The server confirms the registry-state flip.
      const afterResp = await request.get(
        `${API}/api/external/tasks/${taskId}`,
      );
      expect(afterResp.ok()).toBeTruthy();
      const after = (await afterResp.json()) as { task: { state: string } };
      expect(after.task.state).toBe("draft");
    } finally {
      await request
        .delete(`${API}/api/external/tasks/${taskId}`)
        .catch(() => {});
    }
  });
});

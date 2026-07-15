/*
 * Flow — Move an In-Progress task back to the Backlog column.
 *
 * iterate-2026-05-17-move-to-backlog (FR-01.32 + FR-01.01).
 *
 * End-to-end coverage of the board-level UX: an In-Progress task's
 * TaskCard carries a "Move to Backlog" item in its ⋯-menu; selecting it
 * POSTs /api/external/tasks/:id/backlog and the card relocates from the
 * In-Progress column to the Backlog (Draft) column. The server-side
 * state flip is verified independently via the REST API.
 *
 * Targets the live servers (localhost:3847 backend + localhost:5173
 * vite) and cleans up the task it creates.
 */
import { seedLocalStorage } from "../helpers/fixtures";
import { API_BASE } from "../helpers/env";
import { test, expect } from "@playwright/test";

// Hono API base. Defaults to the loopback dev port; override via
// WEBUI_API_URL when the stack runs elsewhere. Uses 127.0.0.1 (not
// `localhost`) so it is unambiguous when the dev server binds IPv4-only.
const API = API_BASE;

test.describe("Move to Backlog (FR-01.32)", () => {
  test("an In-Progress task relocates to the Backlog column via the card ⋯-menu", async ({
    page,
    request,
  }) => {
    // Pick a project the board's project filter can resolve. Falls back
    // to the reserved "unassigned" bucket on a registry with no projects.
    const projResp = await request.get(`${API}/api/projects`);
    expect(projResp.ok()).toBeTruthy();
    const projBody = (await projResp.json()) as {
      data?: Array<{ id: string; path?: string }>;
    };
    const project = projBody.data?.[0];
    const projectId = project?.id ?? "unassigned";
    const cwd = project?.path ?? "/tmp/move-to-backlog-e2e";

    // Create a task, then launch it so it sits in an In-Progress state
    // (`awaiting_external_start`). No JSONL is needed for this state.
    const title = `move-to-backlog-e2e-${Date.now()}`;
    const createResp = await request.post(`${API}/api/external/tasks`, {
      data: { title, cwd, projectId },
    });
    expect(createResp.ok()).toBeTruthy();
    const { task } = (await createResp.json()) as { task: { taskId: string } };
    const taskId = task.taskId;

    try {
      const launchResp = await request.post(
        `${API}/api/external/tasks/${taskId}/launch`,
        { data: {} },
      );
      expect(
        launchResp.ok(),
        `launch must succeed — got ${launchResp.status()}`,
      ).toBeTruthy();

      // The board must show the card in the In-Progress column.
      await seedLocalStorage(page, { "webui.activeProjectId": projectId });
      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible();
      await expect(page.getByTestId(`task-card-${taskId}`)).toBeVisible({
        timeout: 6_000,
      });
      await expect(page.getByTestId("column-in-progress")).toContainText(title);

      // Open the card ⋯-menu and select "Move to Backlog".
      await page.getByTestId(`task-card-menu-${taskId}`).click();
      const backlogItem = page.getByTestId(`task-card-backlog-${taskId}`);
      await expect(backlogItem).toBeVisible();

      const backlogResp = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/external/tasks/${taskId}/backlog`) &&
          r.request().method() === "POST",
      );
      await backlogItem.click();
      expect((await backlogResp).ok()).toBeTruthy();

      // The card has relocated to the Backlog (Draft) column.
      await expect(page.getByTestId("column-draft")).toContainText(title, {
        timeout: 6_000,
      });
      await expect(page.getByTestId("column-in-progress")).not.toContainText(
        title,
      );

      // Negative-visibility: the now-`draft` card no longer offers
      // "Move to Backlog" in its ⋯-menu (it is already in the Backlog).
      await page.getByTestId(`task-card-menu-${taskId}`).click();
      await expect(
        page.getByTestId(`task-card-backlog-${taskId}`),
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

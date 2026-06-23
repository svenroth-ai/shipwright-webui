/*
 * Flow — Task-Board drag-and-drop with the board column decoupled from
 * session state. iterate-2026-06-17-board-dnd-status-decouple.
 *
 * Covers the move that was IMPOSSIBLE before this iterate: dragging a
 * Backlog card into the In-Progress column. Verifies:
 *   - AC-4: the move persists (server boardColumn) and survives a reload
 *     + the ~2 s board poll (no snap-back).
 *   - AC-5: Status ↔ Resume are decoupled — the dragged card's `state`
 *     stays `draft` (never launched), so it still shows the green Launch
 *     CTA even though it now lives in the In-Progress column.
 *
 * Targets the live stack (127.0.0.1:3847 backend + vite). Cleans up after
 * itself. Modelled on move-to-backlog.spec.ts.
 */
import { test, expect, type Page } from "@playwright/test";

const API = process.env.WEBUI_API_URL || "http://127.0.0.1:3847";

/** Simulate a @dnd-kit mouse drag (MouseSensor, 8 px activation distance)
 *  from a card to a target column. dnd-kit needs intermediate mousemove
 *  events: one past the activation threshold, then stepped moves into the
 *  droppable so collision detection registers the target. */
async function dragCardToColumn(
  page: Page,
  taskId: string,
  columnTestId: string,
): Promise<void> {
  const card = page.getByTestId(`task-card-draggable-${taskId}`);
  const target = page.getByTestId(columnTestId);
  const cardBox = await card.boundingBox();
  const targetBox = await target.boundingBox();
  if (!cardBox || !targetBox) throw new Error("drag: missing bounding box");
  const cx = cardBox.x + cardBox.width / 2;
  const cy = cardBox.y + cardBox.height / 2;
  const tx = targetBox.x + targetBox.width / 2;
  const ty = targetBox.y + Math.min(targetBox.height / 2, 120);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 14, cy, { steps: 5 }); // pass activation distance
  await page.mouse.move(tx, ty, { steps: 12 });
  await page.mouse.move(tx, ty + 6, { steps: 4 });
  await page.mouse.up();
}

test.describe("Board DnD — status decoupled from session state", () => {
  test("drag Backlog → In Progress persists across reload; state stays draft (AC-4/AC-5)", async ({
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
    const cwd = project?.path ?? "/tmp/board-dnd-e2e";

    const title = `board-dnd-e2e-${Date.now()}`;
    const createResp = await request.post(`${API}/api/external/tasks`, {
      data: { title, cwd, projectId },
    });
    expect(createResp.ok()).toBeTruthy();
    const { task } = (await createResp.json()) as { task: { taskId: string } };
    const taskId = task.taskId;

    try {
      await page.addInitScript((id) => {
        try {
          localStorage.setItem("webui.activeProjectId", id);
        } catch {
          /* noop */
        }
      }, projectId);
      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible();

      // A fresh task starts in the Backlog column (state=draft → derived).
      await expect(page.getByTestId(`task-card-${taskId}`)).toBeVisible({
        timeout: 6_000,
      });
      await expect(page.getByTestId("column-draft")).toContainText(title);

      // Drag it into In Progress — the previously-impossible move.
      const colResp = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/external/tasks/${taskId}/column`) &&
          r.request().method() === "POST",
      );
      await dragCardToColumn(page, taskId, "column-in-progress");
      expect((await colResp).ok()).toBeTruthy();

      // Card relocated; no snap-back across the board poll.
      await expect(page.getByTestId("column-in-progress")).toContainText(title, {
        timeout: 6_000,
      });
      await expect(page.getByTestId("column-draft")).not.toContainText(title);

      // AC-4 — survives a full reload (board reads persisted boardColumn).
      await page.reload();
      await expect(page.getByTestId("column-in-progress")).toContainText(title, {
        timeout: 6_000,
      });

      // AC-5 — decoupling: state stayed draft, so the card still offers the
      // green never-launched Launch CTA even though it lives in In Progress.
      await expect(page.getByTestId(`task-card-launch-${taskId}`)).toBeVisible();

      // Server confirms: boardColumn flipped, state untouched.
      const afterResp = await request.get(`${API}/api/external/tasks/${taskId}`);
      expect(afterResp.ok()).toBeTruthy();
      const after = (await afterResp.json()) as {
        task: { state: string; boardColumn?: string };
      };
      expect(after.task.boardColumn).toBe("in_progress");
      expect(after.task.state).toBe("draft");
    } finally {
      await request
        .delete(`${API}/api/external/tasks/${taskId}`)
        .catch(() => {});
    }
  });

  test("accessible ⋯-menu 'Move to…' relocates a card without dragging (AC-7 a11y path)", async ({
    page,
    request,
  }) => {
    const projResp = await request.get(`${API}/api/projects`);
    const projBody = (await projResp.json()) as {
      data?: Array<{ id: string; path?: string }>;
    };
    const project = projBody.data?.[0];
    const projectId = project?.id ?? "unassigned";
    const cwd = project?.path ?? "/tmp/board-dnd-e2e";

    const title = `board-menu-move-e2e-${Date.now()}`;
    const createResp = await request.post(`${API}/api/external/tasks`, {
      data: { title, cwd, projectId },
    });
    const { task } = (await createResp.json()) as { task: { taskId: string } };
    const taskId = task.taskId;

    try {
      await page.addInitScript((id) => {
        try {
          localStorage.setItem("webui.activeProjectId", id);
        } catch {
          /* noop */
        }
      }, projectId);
      await page.goto("/");
      await expect(page.getByTestId(`task-card-${taskId}`)).toBeVisible({
        timeout: 6_000,
      });
      await expect(page.getByTestId("column-draft")).toContainText(title);

      // Drive the ⋯-menu → "Move to…" submenu entirely by KEYBOARD — the
      // truest AC-7 evidence (and it sidesteps the Radix-submenu mouse-click
      // detach gotcha). Radix typeahead highlights "Move to…" on "m";
      // ArrowRight opens the submenu and focuses its first ENABLED item
      // (In Progress — Backlog is the current column, hence disabled); Enter
      // selects it.
      await page.getByTestId(`task-card-menu-${taskId}`).click();
      await page.getByTestId(`task-card-movecol-trigger-${taskId}`).click();
      const item = page.getByTestId(`task-card-movecol-in_progress-${taskId}`);
      await expect(item).toBeVisible();
      const colResp = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/external/tasks/${taskId}/column`) &&
          r.request().method() === "POST",
      );
      await item.press("Enter");
      expect((await colResp).ok()).toBeTruthy();
      // Authoritative: did the menu action set the RIGHT column server-side?
      const moved = await request.get(`${API}/api/external/tasks/${taskId}`);
      expect(((await moved.json()) as { task: { boardColumn?: string } }).task.boardColumn).toBe(
        "in_progress",
      );

      await expect(page.getByTestId("column-in-progress")).toContainText(title, {
        timeout: 6_000,
      });
      const afterResp = await request.get(`${API}/api/external/tasks/${taskId}`);
      const after = (await afterResp.json()) as {
        task: { boardColumn?: string };
      };
      expect(after.task.boardColumn).toBe("in_progress");
    } finally {
      await request
        .delete(`${API}/api/external/tasks/${taskId}`)
        .catch(() => {});
    }
  });

  test("drag Done → In Progress REOPENS + unlocks the card (board-drag-done-reopen)", async ({
    page,
    request,
  }) => {
    const projResp = await request.get(`${API}/api/projects`);
    const projBody = (await projResp.json()) as {
      data?: Array<{ id: string; path?: string }>;
    };
    const project = projBody.data?.[0];
    const projectId = project?.id ?? "unassigned";
    const cwd = project?.path ?? "/tmp/board-dnd-e2e";

    const title = `board-reopen-e2e-${Date.now()}`;
    const createResp = await request.post(`${API}/api/external/tasks`, {
      data: { title, cwd, projectId },
    });
    const { task } = (await createResp.json()) as { task: { taskId: string } };
    const taskId = task.taskId;
    // Close it → terminal `done` (locked: TaskCard hides the action row).
    const closeResp = await request.post(
      `${API}/api/external/tasks/${taskId}/close`,
    );
    expect(closeResp.ok()).toBeTruthy();

    try {
      await page.addInitScript((id) => {
        try {
          localStorage.setItem("webui.activeProjectId", id);
        } catch {
          /* noop */
        }
      }, projectId);
      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible();

      // Starts in Done, locked — no action row (the `!isDone` gate).
      await expect(page.getByTestId(`task-card-${taskId}`)).toBeVisible({
        timeout: 6_000,
      });
      await expect(page.getByTestId("column-done")).toContainText(title);
      await expect(page.getByTestId(`task-card-actions-${taskId}`)).toHaveCount(0);

      // Drag Done → In Progress: the move-out reopens via POST /reopen.
      const reopenResp = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/external/tasks/${taskId}/reopen`) &&
          r.request().method() === "POST",
      );
      await dragCardToColumn(page, taskId, "column-in-progress");
      expect((await reopenResp).ok()).toBeTruthy();

      // Lands in In Progress, UNLOCKED — the action row + a CTA now render
      // (never-launched → green Launch). The reported bug: it stayed "locked".
      await expect(page.getByTestId("column-in-progress")).toContainText(title, {
        timeout: 6_000,
      });
      await expect(page.getByTestId(`task-card-actions-${taskId}`)).toBeVisible();
      await expect(page.getByTestId(`task-card-launch-${taskId}`)).toBeVisible();

      // Server: status WAS adjusted (done → draft) + boardColumn=in_progress.
      const afterResp = await request.get(`${API}/api/external/tasks/${taskId}`);
      const after = (await afterResp.json()) as {
        task: { state: string; boardColumn?: string };
      };
      expect(after.task.state).toBe("draft");
      expect(after.task.boardColumn).toBe("in_progress");
    } finally {
      await request
        .delete(`${API}/api/external/tasks/${taskId}`)
        .catch(() => {});
    }
  });
});

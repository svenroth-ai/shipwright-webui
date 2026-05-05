/*
 * Spec 76 — Auto-launch reader→writer promotion race regression guard.
 *
 * Bug (UAT 2026-05-05):
 *   When a NEW WebSocket attaches to an EXISTING pty (StrictMode dev
 *   double-mount race; or genuine multi-tab handoff), the server emits
 *   `ready{role:"reader"}` followed within ~5ms by `writer-promoted`
 *   once the previous writer's close handler fires. TaskDetailPage's
 *   `handleTerminalReady` was cancelling the pending launch immediately
 *   on the first reader-signal — losing roughly 50% of TaskCard launches
 *   to a `cancelLaunch("role-not-writer")` race.
 *
 * Fix: TaskDetailPage now defers the reader-cancel by a 1500ms
 * stability window. If the role flips to "writer" before the timer
 * fires (the StrictMode-race case), the cancel is cleared. Genuine
 * second-tab readers hit the timeout and cancel as before.
 *
 * This spec covers all 3 failing UAT flows × 3 repetitions to flush
 * out timing-dependent regressions. Outcome is observed via WebSocket
 * frame capture: a successful auto-launch sends a `data` frame whose
 * payload contains `claude --session-id` (the launch command body).
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const SHIPWRIGHT_WEBUI_PROJECT_ID = "50e86b6e-3ade-44c4-9e21-2c62c65f804e";

interface CapturedFrame {
  ts: number;
  kind: "tx" | "rx" | "open" | "close";
  text: string;
}

type Outcome = "send" | "no-send";

function attachWsCapture(page: Page): { frames: CapturedFrame[] } {
  const frames: CapturedFrame[] = [];
  page.on("websocket", (ws) => {
    const url = ws.url();
    if (!url.includes("/api/terminal/")) return;
    frames.push({ ts: Date.now(), kind: "open", text: url });
    ws.on("framesent", (f) => {
      const payload = typeof f.payload === "string" ? f.payload : "";
      frames.push({ ts: Date.now(), kind: "tx", text: payload });
    });
    ws.on("framereceived", (f) => {
      const payload = typeof f.payload === "string" ? f.payload : "";
      frames.push({ ts: Date.now(), kind: "rx", text: payload });
    });
    ws.on("close", () => {
      frames.push({ ts: Date.now(), kind: "close", text: url });
    });
  });
  return { frames };
}

async function awaitLaunchSent(
  page: Page,
  frames: CapturedFrame[],
  clickAt: number,
  timeoutMs = 25_000,
): Promise<Outcome> {
  const observeUntil = Date.now() + timeoutMs;
  while (Date.now() < observeUntil) {
    const sentLaunch = frames.find(
      (f) =>
        f.kind === "tx" &&
        f.ts > clickAt &&
        f.text.includes('"type":"data"') &&
        f.text.includes("claude --session-id"),
    );
    if (sentLaunch) return "send";
    await page.waitForTimeout(150);
  }
  return "no-send";
}

async function cleanup(request: APIRequestContext, taskId: string): Promise<void> {
  if (!taskId) return;
  try {
    await request.delete(`http://localhost:3847/api/external/tasks/${taskId}`);
  } catch {
    /* ignore */
  }
}

test.describe("Spec 76 — auto-launch reader→writer race", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      try {
        localStorage.setItem("webui.activeProjectId", id);
      } catch {
        /* noop */
      }
    }, SHIPWRIGHT_WEBUI_PROJECT_ID);
  });

  test("Pure Claude (new-plain) Save → TaskCard Launch ×3", async ({ page, request }) => {
    const results: Outcome[] = [];
    const created: string[] = [];

    for (let i = 1; i <= 3; i++) {
      const cap = attachWsCapture(page);
      const title = `spec76-A-${Date.now()}-${i}`;

      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible({ timeout: 10_000 });

      await page.getByTestId("plain-claude-button").click();
      await expect(page.getByTestId("new-issue-modal-new-plain")).toBeVisible({ timeout: 5_000 });
      await page.getByTestId("new-issue-title-input").fill(title);

      const createResp = page.waitForResponse(
        (r) => r.url().endsWith("/api/external/tasks") && r.request().method() === "POST",
      );
      await page.getByTestId("new-issue-save-btn").click();
      const c = await createResp;
      const body = (await c.json()) as { task: { taskId: string } };
      const taskId = body.task.taskId;
      created.push(taskId);

      await expect(page.getByTestId("new-issue-modal-new-plain")).toHaveCount(0, { timeout: 5_000 });
      const card = page.getByTestId(`task-card-${taskId}`);
      await expect(card).toBeVisible({ timeout: 5_000 });

      const launchBtn = card.getByTestId("terminal-launch-solid-launch");
      await expect(launchBtn).toBeVisible();
      const clickAt = Date.now();
      await launchBtn.click();
      await page.waitForURL(new RegExp(`/tasks/${taskId}$`), { timeout: 10_000 });

      const outcome = await awaitLaunchSent(page, cap.frames, clickAt);
      results.push(outcome);
    }

    for (const id of created) await cleanup(request, id);
    expect(results, "all 3 Pure-Claude TaskCard launches must reach the WS").toEqual([
      "send",
      "send",
      "send",
    ]);
  });

  test("New Task direct-Launch from NewIssueModal ×3", async ({ page, request }) => {
    const results: Outcome[] = [];
    const created: string[] = [];

    for (let i = 1; i <= 3; i++) {
      const cap = attachWsCapture(page);
      const title = `spec76-B-${Date.now()}-${i}`;

      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible({ timeout: 10_000 });

      await page.getByTestId("create-menu-primary").click();
      await expect(page.getByTestId("new-issue-modal-new-task")).toBeVisible({ timeout: 5_000 });
      await page.getByTestId("new-issue-title-input").fill(title);
      await page.getByTestId("new-issue-description-input").fill("spec76-B");

      const createResp = page.waitForResponse(
        (r) => r.url().endsWith("/api/external/tasks") && r.request().method() === "POST",
      );
      const launchResp = page.waitForResponse(
        (r) => /\/api\/external\/tasks\/[\w-]+\/launch$/.test(r.url()) && r.request().method() === "POST",
      );

      const clickAt = Date.now();
      await page.getByTestId("new-issue-launch-btn").click();
      const c = await createResp;
      const body = (await c.json()) as { task: { taskId: string } };
      const taskId = body.task.taskId;
      created.push(taskId);
      await launchResp;

      await page.waitForURL(new RegExp(`/tasks/${taskId}$`), { timeout: 10_000 });

      const outcome = await awaitLaunchSent(page, cap.frames, clickAt);
      results.push(outcome);
    }

    for (const id of created) await cleanup(request, id);
    expect(results, "all 3 NewIssueModal direct-launches must reach the WS").toEqual([
      "send",
      "send",
      "send",
    ]);
  });

  test("Save → Backlog → TaskCard Launch (new-task) ×3", async ({ page, request }) => {
    const results: Outcome[] = [];
    const created: string[] = [];

    for (let i = 1; i <= 3; i++) {
      const cap = attachWsCapture(page);
      const title = `spec76-C-${Date.now()}-${i}`;

      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible({ timeout: 10_000 });

      await page.getByTestId("create-menu-primary").click();
      await expect(page.getByTestId("new-issue-modal-new-task")).toBeVisible({ timeout: 5_000 });
      await page.getByTestId("new-issue-title-input").fill(title);
      await page.getByTestId("new-issue-description-input").fill("spec76-C");

      const createResp = page.waitForResponse(
        (r) => r.url().endsWith("/api/external/tasks") && r.request().method() === "POST",
      );
      await page.getByTestId("new-issue-save-btn").click();
      const c = await createResp;
      const body = (await c.json()) as { task: { taskId: string } };
      const taskId = body.task.taskId;
      created.push(taskId);

      await expect(page.getByTestId("new-issue-modal-new-task")).toHaveCount(0, { timeout: 5_000 });
      const card = page.getByTestId(`task-card-${taskId}`);
      await expect(card).toBeVisible({ timeout: 5_000 });

      const launchBtn = card.getByTestId("terminal-launch-solid-launch");
      await expect(launchBtn).toBeVisible();
      const clickAt = Date.now();
      await launchBtn.click();
      await page.waitForURL(new RegExp(`/tasks/${taskId}$`), { timeout: 10_000 });

      const outcome = await awaitLaunchSent(page, cap.frames, clickAt);
      results.push(outcome);
    }

    for (const id of created) await cleanup(request, id);
    expect(results, "all 3 Save→Backlog→TaskCard launches must reach the WS").toEqual([
      "send",
      "send",
      "send",
    ]);
  });
});

/*
 * Flow F — Load-bearing regression guards.
 *
 * From CLAUDE.md DO-NOT rules + iterate 2/3 invariants:
 *   - No <textarea> inside /tasks/:id (DO-NOT #3 — no composer).
 *   - No chat-composer / message-input surfaces anywhere on /tasks/:id.
 *   - Terminal-launch button still fires its launch mutation.
 */

import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { APP_BASE, apiUrl } from "../helpers/env";
import { test, expect } from "@playwright/test";

// A00 — was a pinned operator UUID; seeded via the real API in beforeEach.
let project: SeededProject;


const UAT_PATH = "C:\\tmp\\uat-1";

async function createTask(
  request: import("@playwright/test").APIRequestContext,
  title: string,
) {
  const resp = await request.post(apiUrl("/api/external/tasks"), {
    data: { title, cwd: UAT_PATH, projectId: project.projectId },
  });
  expect(resp.ok()).toBeTruthy();
  const body = (await resp.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

test.describe("Flow F — iterate-2 / iterate-3 regression guards", () => {
  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "70-f-regression-invariants" });
    await setActiveProject(page, project.projectId);
  });
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("/tasks/:id has no textarea and no composer/message-input surface", async ({
    page,
    request,
  }) => {
    const taskId = await createTask(request, `spec70f-invariants-${Date.now()}`);
    await page.goto(`/tasks/${taskId}`);
    await expect(page.getByTestId("task-detail-page")).toBeVisible();

    // DO-NOT #3: no textarea anywhere on /tasks/:id.
    await expect(page.locator("textarea")).toHaveCount(0);

    // Defensive: nothing with a test id suggesting a composer lives here.
    const composerCandidates = [
      "chat-composer",
      "message-input",
      "message-composer",
      "send-message",
      "composer",
    ];
    for (const tid of composerCandidates) {
      await expect.soft(page.locator(`[data-testid="${tid}"]`)).toHaveCount(0);
    }
    // And there is no <input type="text" placeholder~"message"> sneaking in.
    await expect.soft(page.locator('input[placeholder*="message" i]')).toHaveCount(0);

    await request.delete(apiUrl(`/api/external/tasks/${taskId}`));
  });

  test("Launch button on a draft task fires POST /launch and transitions state", async ({
    page,
    context,
    request,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: APP_BASE,
    });

    const taskId = await createTask(request, `spec70f-launch-${Date.now()}`);
    await page.goto(`/tasks/${taskId}`);
    await expect(page.getByTestId("cta-launch-in-terminal")).toBeVisible();

    const launchReq = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/external/tasks/${taskId}/launch`) &&
        r.request().method() === "POST",
    );
    await page.getByTestId("cta-launch-in-terminal").click();
    const resp = await launchReq;
    expect(resp.ok(), `launch must succeed — got ${resp.status()}`).toBeTruthy();

    // Task state flipped.
    const after = await request.get(apiUrl(`/api/external/tasks`));
    const { tasks } = (await after.json()) as { tasks: Array<{ taskId: string; state: string }> };
    const server = tasks.find((t) => t.taskId === taskId);
    expect(server?.state).not.toBe("draft");

    await request.delete(apiUrl(`/api/external/tasks/${taskId}`));
  });
});

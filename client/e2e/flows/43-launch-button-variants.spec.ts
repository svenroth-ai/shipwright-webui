/*
 * Spec 43 — TerminalLaunchButton variant consistency.
 *
 * Each variant emits the same launch command for a given task; only the
 * interaction differs. Compact (TaskBoard card) = click → copy. Primary
 * (TaskDetail header) = click → copy + announce. Inline (Inbox row) =
 * click → navigate to TaskDetail.
 *
 * The shared command is ensured by every variant going through the
 * /api/external/tasks/:id/launch endpoint and reading the same PowerShell
 * (Windows-UA) form.
 */

import { cleanupProject, seedLocalStorage, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect } from "@playwright/test";

test.describe("TerminalLaunchButton — TaskCard launch handoff", () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "43-launch-button-variants", adopted: true });
    await setActiveProject(page, project.projectId);
    // A00 — the center tab is persisted and defaults to "terminal"
    // (TaskDetailPage.tsx), so the transcript pane is HIDDEN on a fresh profile.
    // These specs were inheriting the developer's selected tab.
    await seedLocalStorage(page, {
      "webui:embedded-terminal-default-tab": '"transcript"',
    });
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("TaskBoard launch hands off to TaskDetail, where the resume command is copyable", async ({
    page,
    request,
    context,
  }) => {
    await context.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    // Use a unique title so we can't see a leftover clipboard from
    // another spec while polling.
    const uniqueTitle = `variant-spec-${Date.now()}`;
    const create = await request.post("/api/external/tasks", {
      data: { title: uniqueTitle, cwd: process.cwd(), projectId: project.projectId },
    });
    const { task } = (await create.json()) as { task: { taskId: string } };

    // Backlog-card variant — TaskBoard. Iterate 3.7d renamed the compact
    // button to a solid-green launch variant scoped by `task-card-launch-<id>`;
    // the button itself carries `terminal-launch-solid-launch`.
    await page.goto("/");
    await page.evaluate(() => navigator.clipboard.writeText(""));
    const compact = page
      .getByTestId(`task-card-launch-${task.taskId}`)
      .getByTestId("terminal-launch-solid-launch");
    await expect(compact).toBeVisible({ timeout: 5000 });
    await compact.click();

    // TaskCard actions now hand the command to TaskDetail through
    // sessionStorage so the embedded terminal can execute it. They never
    // write the clipboard; that legacy assertion was an A00 suite failure.
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}$`));
    await expect(page.getByTestId("task-state-badge")).toHaveText("Awaiting launch");

    // The accessible manual-copy path is the TaskDetail header menu. It
    // exposes the resume command for a different terminal after the handoff.
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await page.getByTestId("task-detail-menu-trigger").click();
    await page.getByTestId("task-detail-menu-copy-resume-command").click();
    await expect(page.getByTestId("task-detail-menu-notice")).toHaveAttribute("data-kind", "ok");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`--name '${uniqueTitle}'`);
    expect(copied).toMatch(/--resume '[0-9a-f-]{36}'/);
    expect(copied).not.toContain("--session-id");
  });
});

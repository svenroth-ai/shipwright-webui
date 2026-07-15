/*
 * Spec 36b — TerminalLaunchButton clipboard contents.
 *
 * The 2.1 TerminalLaunchButton (primary variant in TaskDetail header) writes
 * the platform-appropriate launch command to the clipboard. We assert the
 * clipboard contents include --name with the task title properly quoted.
 *
 * Tricky-char title coverage moves to spec 48 (per plan). This test focuses
 * on the round-trip: button click → clipboard → command shape correct.
 */

import { cleanupProject, seedLocalStorage, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect } from "@playwright/test";

test.describe("TerminalLaunchButton — clipboard --name shape", () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "36b-clipboard-name", adopted: true });
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

  test("primary variant copies command including --name '<title>' (PowerShell on Windows-UA)", async ({
    page,
    request,
    context,
  }) => {
    // Force a Windows User-Agent so the component picks the PowerShell form.
    await context.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const create = await request.post("/api/external/tasks", {
      data: { title: "clipboard-name-spec", cwd: process.cwd() },
    });
    const { task } = (await create.json()) as { task: { taskId: string } };

    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("cta-launch-in-terminal")).toBeVisible();

    // A00 — the primary CTA now AUTO-EXECUTES the command inside the embedded
    // terminal (ADR-068-A1) and no longer writes the clipboard. The surviving
    // "copy the command so I can paste it into a DIFFERENT terminal" workaround is
    // the header-menu item `task-detail-menu-copy-resume-command`
    // (HeaderMenuItems.tsx). It is gated on state != draft, so launch once to leave
    // draft, then copy via the menu. This spec now exercises that real workaround.
    await page.getByTestId("cta-launch-in-terminal").click();
    await expect(page.getByTestId("task-state-badge")).toHaveText("Awaiting launch", {
      timeout: 5000,
    });

    await page.evaluate(() => navigator.clipboard.writeText(""));
    await page.getByTestId("task-detail-menu-trigger").click();
    await page.getByTestId("task-detail-menu-copy-resume-command").click();
    await expect(page.getByTestId("task-detail-menu-notice")).toHaveAttribute(
      "data-kind",
      "ok",
    );

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    // The workaround copies the RESUME command (the whole point is pasting it into a
    // different terminal to CONTINUE the session), so the pre-bound uuid is carried
    // via `--resume '<uuid>'`, not the initial-launch `--session-id`.
    expect(clipboard).toMatch(/--resume '[0-9a-f-]{36}'/);
    expect(clipboard).toContain("--name 'clipboard-name-spec'");
    // PowerShell form: the command runs claude in the task's cwd, so it is
    // cd-prefixed (`Set-Location '<cwd>' -ErrorAction Stop; & claude …`) rather than
    // bare `& claude` — assert the two PS-specific markers instead of the old
    // `startsWith("& claude ")`, which the cd-prefix retired.
    expect(clipboard).toContain("& claude ");
    expect(clipboard).toMatch(/Set-Location .+ -ErrorAction Stop/);
  });
});

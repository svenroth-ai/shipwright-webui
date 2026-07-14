/*
 * Spec 48 — Tricky-character titles round-trip through clipboard correctly.
 *
 * Asserts the launcher's PowerShell escape spec holds end-to-end:
 *   - single quote → ''
 *   - double quote, backtick, dollar, semicolon, &, |, $ — pass through
 *     literally inside single-quoted string
 *   - umlauts, emoji, CJK — pass through as UTF-8
 *
 * The unit smoke test (server) already verifies PowerShell parses the
 * generated literal cleanly. This spec ensures the renamed title makes
 * it from API → clipboard without escape artifacts.
 */

import { cleanupProject, seedLocalStorage, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect } from "@playwright/test";

test.describe("Tricky-char titles — clipboard round-trip", () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "48-tricky-char-titles" });
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

  test("single quotes, dollar, backtick, emoji, umlaut, CJK all preserved", async ({
    page,
    request,
    context,
  }) => {
    await context.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const trickyTitle = `Test's $weird \`title; & 日本語 ä 🚀`;
    const create = await request.post("/api/external/tasks", {
      data: { title: trickyTitle, cwd: process.cwd() },
    });
    const { task } = (await create.json()) as { task: { taskId: string; title: string } };
    expect(task.title).toBe(trickyTitle);

    await page.goto(`/tasks/${task.taskId}`);
    // Iterate 3 section 04 — header CTA replaces TerminalLaunchButton on
    // TaskDetail. A fresh task renders the Launch variant of the CTA.
    await page.getByTestId("cta-launch-in-terminal").click();
    // iterate 3.9c: after click, state flips draft → awaiting_external_start
    // and cta-launch-in-terminal unmounts. Wait on the badge transition
    // instead of the transient "Copied" label.
    await expect(page.getByTestId("task-state-badge")).toHaveText(
      "Awaiting launch",
      { timeout: 5000 },
    );

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());

    // Single quote → '' (PowerShell single-quoted escape).
    expect(clipboard).toContain(`Test''s`);
    // Backtick + $ + ; + & + Unicode pass through inside single quotes.
    expect(clipboard).toContain(`$weird`);
    expect(clipboard).toContain("`title");
    expect(clipboard).toContain(`& 日本語 ä 🚀`);
  });
});

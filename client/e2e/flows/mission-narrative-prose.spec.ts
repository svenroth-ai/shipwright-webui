/*
 * FR-01.68 — the Mission middle card tells a story.
 *
 * Drives the real browser against a real seeded JSONL, because the two defects
 * this iterate fixed were both invisible to unit tests: a quoted tool name that
 * faked a phase, and a slash command whose ARGUMENTS the parser discarded. Both
 * only surface when a real transcript flows through the whole chain.
 *
 * What is asserted is mostly RESTRAINT — what the card may not say.
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";

const tool = (id: string, name: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
});
const toolResult = (id: string, content: string, isError = false) => ({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }],
  },
});
/** The operator's request lives in the command ARGUMENTS — the shape the parser
 *  rejected 124 times out of 124 before this iterate. */
const kickoff = (args: string) => ({
  type: "user",
  message: {
    role: "user",
    content:
      "<command-message>shipwright-iterate:iterate</command-message>\n" +
      "<command-name>/shipwright-iterate:iterate</command-name>\n" +
      `<command-args>${args}</command-args>`,
  },
});

test.describe("FR-01.68 — the Mission middle card tells a story", () => {
  test.describe.configure({ timeout: 120_000 });

  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Mission prose" });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  /** Create a new-plain task through the REAL UI, returning its identity. */
  async function createTask(
    page: import("@playwright/test").Page,
    title: string,
  ): Promise<{ taskId: string; sessionUuid: string; cwd: string }> {
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("plain-claude-button").click();
    await expect(page.getByTestId("new-issue-modal-new-plain")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("new-issue-title-input").fill(title);
    const createResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/external/tasks") && r.request().method() === "POST",
    );
    await page.getByTestId("new-issue-save-btn").click();
    const body = (await (await createResp).json()) as {
      task: { taskId: string; sessionUuid: string; cwd: string };
    };
    return body.task;
  }

  async function openMission(page: import("@playwright/test").Page, id: string) {
    await page.goto(`/tasks/${id}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    const narration = page.getByTestId("mission-narration");
    await expect(narration).toBeVisible({ timeout: 15_000 });
    return narration;
  }

  test("narrates the ask, the work and the OUTCOME as prose (AC1/AC2/AC3)", async ({ page }) => {
    const task = await createTask(page, `mission-prose-${Date.now()}`);
    taskId = task.taskId;

    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        kickoff("--autonomous Make the New button match the others"),
        tool("r1", "Read", { file_path: "/repo/src/a.ts" }),
        tool("g1", "Grep", { pattern: "btn-primary" }),
        tool("e1", "Edit", { file_path: "/repo/src/Button.tsx" }),
        tool("e2", "Edit", { file_path: "/repo/src/Board.tsx" }),
        tool("b1", "Bash", { command: "npx vitest run" }),
        toolResult("b1", "Tests  2 failed | 40 passed", true),
        tool("e3", "Edit", { file_path: "/repo/src/Button.tsx" }),
        tool("b2", "Bash", { command: "npx vitest run" }),
        toolResult("b2", "Tests  42 passed (42)"),
        tool("b3", "Bash", { command: 'git commit -m "fix: button"' }),
        toolResult("b3", "[main 1234567] fix: button"),
      ],
    });

    const narration = await openMission(page, taskId);

    // The ask, with the CLI flag stripped — how it was asked is not what was asked.
    await expect(narration).toContainText("Make the New button match the others", {
      timeout: 15_000,
    });
    await expect(narration).not.toContainText("--autonomous");

    // The plot: an outcome, not just an action. This is the whole point.
    await expect(narration).toContainText("Three files were then changed.");
    await expect(narration).toContainText("two of them failed");
    await expect(narration).toContainText("came back green");
    await expect(narration).toContainText("The change was recorded");

    // It is PROSE: no rolling per-step line, no filenames, no durations.
    await expect(page.getByTestId("mission-narration-summary")).toHaveCount(0);
    await expect(narration).not.toContainText("Button.tsx");
    await expect(narration).not.toContainText(/\bminutes?\b|\bhours?\b/);

    // More than one beat: a card, not a six-line window.
    expect(await page.getByTestId("mission-narration-paragraph").count()).toBeGreaterThan(1);
  });

  test("a quoted tool name fakes no phase, and a pending run does not pass (AC3b/AC8)", async ({
    page,
  }) => {
    const task = await createTask(page, `mission-prose-honest-${Date.now()}`);
    taskId = task.taskId;

    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        kickoff("Check the ignore rules"),
        // Quote-blind splitting read `playwright` here as a command and claimed
        // the Test phase. Measured in 23% of real transcripts.
        tool("b1", "Bash", { command: 'grep -n "visual\\|screenshot\\|playwright" .gitignore' }),
        toolResult("b1", "3:screenshots/"),
        // A test that has STARTED but not reported: pending, never success.
        tool("b2", "Bash", { command: "npx vitest run" }),
      ],
    });

    const narration = await openMission(page, taskId);
    await expect(narration).toContainText("The tests are running now.", { timeout: 15_000 });
    await expect(narration).not.toContainText("passed");
    await expect(narration).not.toContainText("green");
  });

  test("an artifact link sits INSIDE the sentence and opens the panel (AC5)", async ({ page }) => {
    const task = await createTask(page, `mission-prose-link-${Date.now()}`);
    taskId = task.taskId;

    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        kickoff("Write the plan first"),
        tool("w1", "Write", { file_path: "/repo/.shipwright/planning/iterate/x.md" }),
        toolResult("w1", "ok"),
      ],
    });

    const narration = await openMission(page, taskId);
    await expect(narration).toContainText("The plan was written down", { timeout: 15_000 });

    // A real button INSIDE the paragraph, not a separate column.
    const inline = narration.getByRole("button", { name: "plan" });
    await expect(inline).toBeVisible();
    await expect(inline).toHaveAttribute("type", "button");
  });
});

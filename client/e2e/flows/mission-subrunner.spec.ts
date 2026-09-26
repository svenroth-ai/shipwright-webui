/*
 * iterate-2026-09-26-mission-tab-subrunner — real-browser proof that a
 * delegated subagent (Agent dispatch -> ack -> task-notification) renders as
 * its own subrunner card and that its resolved report opens in the
 * right-side panel, through the REAL JSONL -> reducer -> DOM chain. Follows
 * the seedProject/seedTask/seedClaudeJsonlEvents pattern established by
 * mission-feed-transcript-fidelity.spec.ts.
 *
 * @covers FR-01.66
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { writeFiles } from "../helpers/temp-dir";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";

const RUN_ID = "iterate-2026-09-26-mission-tab-subrunner-e2e";

const SPEC_DOC = `# Mission tab subrunner visibility — E2E fixture

This iterate touches FR-01.66 (the Mission view) and nothing else.

## Affected Boundaries

Reads only data already recorded in the session JSONL.
`;

function pointer(sessionUuid: string, mainRoot: string): string {
  return JSON.stringify({
    run_id: RUN_ID,
    slug: "mission-tab-subrunner-e2e",
    branch: "iterate/mission-tab-subrunner-e2e",
    main_root: mainRoot,
    session_id: sessionUuid,
    created_at: "2026-09-26T10:00:00Z",
  });
}

const bareTool = (id: string, name: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
});
const toolResult = (id: string, content: string, isError = false) => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});
const taskNotification = (taskId: string, status: string, summary: string, result: string) => ({
  type: "user",
  message: {
    role: "user",
    content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n<summary>${summary}</summary>\n<result>${result}</result>\n</task-notification>`,
  },
  origin: { kind: "task-notification" },
});

test.describe("Mission activity feed — subrunner visibility (Sven's 2026-09-26 report)", () => {
  test.describe.configure({ timeout: 120_000 });

  let project: SeededProject;
  let taskId: string;
  let projectSeeded = false;

  test.beforeEach(async ({ page, request }) => {
    taskId = "";
    projectSeeded = false;
    project = await seedProject(request, { name: "MissionSubrunnerE2E", adopted: true });
    projectSeeded = true;
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (projectSeeded) await cleanupProject(request, project);
  });

  // @covers FR-01.66
  test("an Agent dispatch renders running, then resolves to a report openable in the right-side panel", async ({
    page,
    request,
  }) => {
    const task = await seedTask(request, { title: "Delegate the migration", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(task.sessionUuid, project.path),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        bareTool("t1", "Agent", { description: "Run the migration script" }),
        toolResult("t1", "Async agent launched successfully. Tracking as agentId: agent-42.", false),
      ],
    });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    const feed = page.getByTestId("mission-activity-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });

    const subrunner = feed.locator('[data-kind="subrunner"]');
    await expect(subrunner).toBeVisible();
    await expect(subrunner).toContainText("Run the migration script");
    await expect(subrunner.locator(".mc-feed-subrunner-status")).toContainText("Running");

    // The completion notification arrives on a LATER poll — append it to the
    // same JSONL the running card was seeded from, then wait for the reducer
    // to pick it up on its next transcript poll.
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        bareTool("t1", "Agent", { description: "Run the migration script" }),
        toolResult("t1", "Async agent launched successfully. Tracking as agentId: agent-42.", false),
        taskNotification("agent-42", "completed", "Done", "PR #482 merged."),
      ],
    });

    const openReport = subrunner.getByRole("button", { name: "View subrunner report" });
    await expect(openReport).toBeVisible({ timeout: 15_000 });
    await openReport.click();

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("PR #482 merged.");
  });
});

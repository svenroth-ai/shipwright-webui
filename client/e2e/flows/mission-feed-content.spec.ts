/*
 * iterate-2026-08-20-mission-feed-content — the Activity feed narrates real
 * content on every card kind, through the REAL JSONL → reducer → DOM chain.
 *
 * `mission-narrative-prose.spec.ts` targets `mission-narration`
 * (`OperationLive`), a component `MissionBody.tsx` no longer mounts as of
 * `894efb22` ("MIS-2: replace Mission narrator with activity feed", #363,
 * predates this run) — so it exercises nothing reachable from the current
 * app. This file is the first real-browser coverage of the CURRENT
 * `mission-activity-feed` (`MissionActivityFeed.tsx`).
 *
 * Deliberately scoped to the transcript-driven cards (user-input, test) —
 * exactly where this run's real bug lived (an external code reviewer caught
 * that the question block rendered options/CTA/answer but never the actual
 * question text) and exactly the wiring a synthetic ActivityCard-fixture
 * unit test cannot exercise: real JSONL bytes through the real reducer. The
 * MissionContext-driven delivery/PR-link card was verified separately
 * against real production task data (screenshot evidence, not fixtures).
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

const RUN_ID = "iterate-2026-07-18-mission-e2e-feed";

const SPEC_DOC = `# Mission feed — E2E fixture

This iterate touches FR-01.66 (the Mission view) and nothing else.

## Affected Boundaries

The mission-context resolver response shape.
`;

function pointer(sessionUuid: string, mainRoot: string): string {
  return JSON.stringify({
    run_id: RUN_ID,
    slug: "mission-e2e-feed",
    branch: "iterate/mission-e2e-feed",
    main_root: mainRoot,
    session_id: sessionUuid,
    created_at: "2026-07-18T10:00:00Z",
  });
}

const tool = (id: string, name: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
});
const toolResult = (id: string, content: string, isError = false) => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});
const askQuestion = (id: string, question: string, options: string[]) => tool(id, "AskUserQuestion", {
  questions: [{ question, header: "Choice", options: options.map((label) => ({ label })), multiSelect: false }],
});

test.describe("Mission activity feed — real content through the real chain", () => {
  test.describe.configure({ timeout: 120_000 });

  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "MissionFeedE2E", adopted: true });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
  });

  async function openTaskMission(page: import("@playwright/test").Page, id: string) {
    await page.goto(`/tasks/${id}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    const feed = page.getByTestId("mission-activity-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });
    return feed;
  }

  test("an unresolved question shows the real question, its options, and the terminal CTA", async ({
    page,
    request,
  }) => {
    const task = await seedTask(request, { title: "Ask about the platform", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(task.sessionUuid, project.path),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [askQuestion("ask1", "Which platform should this ship to first?", ["Web App", "Mobile App"])],
    });

    const feed = await openTaskMission(page, taskId);

    // The real question — the bug this run's external review caught: the
    // block rendered options/CTA/answer but never the actual question text.
    await expect(feed).toContainText("Which platform should this ship to first?");
    await expect(feed).toContainText("Web App");
    await expect(feed).toContainText("Mobile App");
    await expect(feed.getByTestId("askuser-answer-in-terminal")).toBeVisible();
  });

  test("a resolved question marks the matched option picked and hides the CTA", async ({ page, request }) => {
    const task = await seedTask(request, { title: "Ask and answer", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(task.sessionUuid, project.path),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        askQuestion("ask1", "Which platform should this ship to first?", ["Web App", "Mobile App"]),
        toolResult("ask1", "Web App"),
      ],
    });

    const feed = await openTaskMission(page, taskId);
    await expect(feed).toContainText("Which platform should this ship to first?");
    await expect(feed.getByTestId("askuser-answer-in-terminal")).toHaveCount(0);
    const picked = feed.locator(".mc-feed-qa-opt", { hasText: "Web App" });
    await expect(picked).toHaveAttribute("data-picked", "true");
  });

  test("a failing test command shows a status pill and a bounded real-output excerpt", async ({
    page,
    request,
  }) => {
    const task = await seedTask(request, { title: "Run the suite", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(task.sessionUuid, project.path),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        tool("t1", "Bash", { command: "npx vitest run" }),
        toolResult("t1", "FAIL src/auth.test.ts\nexpect(received).toEqual(expected)\nextra line dropped by the bound", true),
      ],
    });

    const feed = await openTaskMission(page, taskId);
    const testCard = feed.locator('[data-kind="test"]');
    await expect(testCard).toContainText("needs attention");
    await expect(testCard).toContainText("FAIL src/auth.test.ts");
    await expect(testCard).toContainText("expect(received).toEqual(expected)");
    await expect(testCard.locator(".mc-feed-pill")).toBeVisible();
  });
});

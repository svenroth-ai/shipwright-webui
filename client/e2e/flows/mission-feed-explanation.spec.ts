/*
 * iterate-2026-08-25-mission-feed-progress-narration — real-browser proof
 * that `card.explanation` (a turn's own words beyond the headline) shows up
 * in the Mission Activity feed through the REAL JSONL -> reducer -> DOM
 * chain, not just the fixture-driven unit/component tests. Follows the same
 * seedProject/seedTask/seedClaudeJsonlEvents pattern as
 * `mission-feed-content.spec.ts` (which this file's scope note references).
 *
 * No Settings toggle, no launch flag — this iterate's whole scope is a
 * client-side derivation reading text Claude already wrote (see the iterate
 * spec's Goal and Architecture Review sections).
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

const RUN_ID = "iterate-2026-08-25-mission-feed-progress-narration-e2e";

const SPEC_DOC = `# Mission feed explanation — E2E fixture

This iterate touches FR-01.66 (the Mission view) and nothing else.

## Affected Boundaries

Reads only data already recorded in the session JSONL.
`;

function pointer(sessionUuid: string, mainRoot: string): string {
  return JSON.stringify({
    run_id: RUN_ID,
    slug: "mission-feed-explanation-e2e",
    branch: "iterate/mission-feed-explanation-e2e",
    main_root: mainRoot,
    session_id: sessionUuid,
    created_at: "2026-08-25T10:00:00Z",
  });
}

const turnWithText = (text: string, id: string, name: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { role: "assistant", content: [
    { type: "text", text },
    { type: "tool_use", id, name, input },
  ] },
});

test.describe("Mission activity feed — card.explanation through the real chain", () => {
  test.describe.configure({ timeout: 120_000 });

  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "MissionFeedExplanationE2E", adopted: true });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
  });

  test("a solo-turn card with multi-line prose shows both its headline and the rest of the explanation", async ({
    page,
    request,
  }) => {
    const task = await seedTask(request, { title: "Check the auth guard", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(task.sessionUuid, project.path),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        turnWithText(
          "Checking how the auth guard handles a stale token.\nIt reads the session cookie first, then falls back to the Authorization header.",
          "read1",
          "Read",
          { file_path: "src/auth/guard.ts" },
        ),
      ],
    });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    const feed = page.getByTestId("mission-activity-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });

    await expect(feed).toContainText("Checking how the auth guard handles a stale token.");
    const explanation = feed.locator(".mc-feed-explanation");
    await expect(explanation).toContainText("It reads the session cookie first, then falls back to the Authorization header.");

    // The rest of the card's usual chrome (icon/pill/chips) is untouched by
    // the new block's presence — same locator convention as
    // mission-feed-content.spec.ts's card-kind assertions.
    const card = feed.locator('[data-kind="investigate"]');
    await expect(card).toBeVisible();
    await expect(card.locator(".mc-feed-explanation")).toBeVisible();
  });
});

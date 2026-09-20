/*
 * iterate-2026-09-20-mission-feed-transcript-fidelity — real-browser proof
 * that the seven reported Mission activity-feed gaps are fixed through the
 * REAL JSONL -> reducer -> DOM chain, not just fixture-driven unit tests.
 * Follows the seedProject/seedTask/seedClaudeJsonlEvents pattern established
 * by mission-feed-content.spec.ts / mission-feed-explanation.spec.ts.
 *
 * Scope note (same convention as mission-feed-content.spec.ts): deliberately
 * limited to the transcript-derived behaviors a synthetic ActivityCard
 * fixture cannot exercise (the reducer reading real JSONL turns). The
 * Delivered-box CSS spacing fix (`.mc-feed-pr + .mc-story-link` in
 * mission-operation.css) is a static sibling-combinator rule with no
 * JSONL-derived behavior to seed — verified by direct inspection and the
 * existing CSS cascade, consistent with this codebase's convention of not
 * standing up a real-browser test for a presentation-only rule with no
 * seedable precondition.
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

const RUN_ID = "iterate-2026-09-20-mission-feed-transcript-fidelity-e2e";

const SPEC_DOC = `# Mission feed transcript fidelity — E2E fixture

This iterate touches FR-01.66 (the Mission view) and nothing else.

## Affected Boundaries

Reads only data already recorded in the session JSONL.
`;

function pointer(sessionUuid: string, mainRoot: string): string {
  return JSON.stringify({
    run_id: RUN_ID,
    slug: "mission-feed-transcript-fidelity-e2e",
    branch: "iterate/mission-feed-transcript-fidelity-e2e",
    main_root: mainRoot,
    session_id: sessionUuid,
    created_at: "2026-09-20T10:00:00Z",
  });
}

const bareTool = (id: string, name: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
});
const narratedTool = (text: string, id: string, name: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { role: "assistant", content: [
    { type: "text", text },
    { type: "tool_use", id, name, input },
  ] },
});
const narrationOnly = (text: string) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text }] },
});
const humanReply = (text: string) => ({
  type: "user",
  message: { role: "user", content: [{ type: "text", text }] },
});
const toolResult = (id: string, content: string, isError = false) => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});

test.describe("Mission activity feed — transcript fidelity (Sven's 2026-09-20 report)", () => {
  test.describe.configure({ timeout: 120_000 });

  let project: SeededProject;
  let taskId: string;
  // Tracks whether THIS test's own seedProject() call actually succeeded —
  // `project` itself can't be used for that check, because on a throw it
  // keeps holding the PREVIOUS test's (already-cleaned) value, not undefined
  // (round-5 external review catch, glm, low: the same class of bug the
  // `taskId = ""` reset below was already added for, just missed on this
  // sibling variable — a seedProject() throw in test N would otherwise leave
  // afterEach re-cleaning test N-1's project, masking test N's real failure).
  let projectSeeded = false;

  test.beforeEach(async ({ page, request }) => {
    // Reset so a test that throws before reaching its own `taskId = ...`
    // assignment doesn't leave afterEach re-cleaning up the PREVIOUS test's
    // already-deleted task id (code review catch, low).
    taskId = "";
    projectSeeded = false;
    project = await seedProject(request, { name: "MissionFeedTranscriptFidelityE2E", adopted: true });
    projectSeeded = true;
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (projectSeeded) await cleanupProject(request, project);
  });

  // @covers FR-01.66
  test("a wordless tool-only turn produces no card, but a narrated one shows both headline and command (issue #1)", async ({
    page,
    request,
  }) => {
    const task = await seedTask(request, { title: "Consolidate wordless cards", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(task.sessionUuid, project.path),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        // No narration at all — must produce no investigate/implement card.
        bareTool("r1", "Read", { file_path: "src/wordless.ts" }),
        // Real narration — must produce a card with both the headline and the chip.
        narratedTool("Fixing the login redirect.", "e1", "Edit", { file_path: "src/login.tsx" }),
      ],
    });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    const feed = page.getByTestId("mission-activity-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });

    // The wordless Read never coalesces with the narrated Edit (different
    // buckets: investigate vs. implement), so if the filter failed to drop
    // it a second, empty investigate card would render.
    await expect(feed.locator('[data-kind="investigate"]')).toHaveCount(0);
    const implement = feed.locator('[data-kind="implement"]');
    await expect(implement).toBeVisible();
    await expect(implement).toContainText("Fixing the login redirect.");

    // The narrated card must also carry its command chip/toggle (not just the
    // headline text) — expanding it must reveal the actual command
    // (openai external review catch, low: the prior assertion only checked
    // the headline, so a regression that dropped the commands entirely would
    // have gone unnoticed here).
    const commandToggle = implement.locator(".mc-feed-expand-btn");
    await expect(commandToggle).toBeVisible();
    await expect(commandToggle).toContainText("1 command");
    await commandToggle.click();
    await expect(implement.locator(".mc-feed-chip-row")).toContainText("src/login.tsx");
  });

  // @covers FR-01.66
  test("a human's own typed reply shows up as its own card (issue #1 — \"meine Antworten gehören auch da hinein\")", async ({
    page,
    request,
  }) => {
    const task = await seedTask(request, { title: "Surface my own replies", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(task.sessionUuid, project.path),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [humanReply("Please also fix the spacing under the Delivered box.")],
    });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    const feed = page.getByTestId("mission-activity-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });

    const userCard = feed.locator('[data-kind="user"]');
    await expect(userCard).toBeVisible();
    await expect(userCard).toContainText("Please also fix the spacing under the Delivered box.");
  });

  // @covers FR-01.66
  test("a reviewer Task spawn with no narration of its own gets a synthesized 'Spawned...' sentence (issue #6)", async ({
    page,
    request,
  }) => {
    const task = await seedTask(request, { title: "Announce the reviewer spawn", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(task.sessionUuid, project.path),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        bareTool("rev1", "Task", { subagent_type: "code-reviewer", description: "Review the auth diff" }),
        toolResult("rev1", "Verdict: approved.", false),
      ],
    });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    const feed = page.getByTestId("mission-activity-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });

    const review = feed.locator('[data-kind="review"]');
    await expect(review).toBeVisible();
    await expect(review).toContainText("Spawned the code reviewer to review the change.");
  });

  // @covers FR-01.66
  test("a blocker card explains what to do about it, not just a red pill (issue #4)", async ({ page, request }) => {
    const task = await seedTask(request, { title: "Explain the blocker", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(task.sessionUuid, project.path),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        narratedTool("Pushing the branch.", "p1", "Bash", { command: "git push" }),
        toolResult("p1", "! [rejected] main -> main (fetch first)", true),
      ],
    });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    const feed = page.getByTestId("mission-activity-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });

    const blocker = feed.locator('[data-kind="blocker"]');
    await expect(blocker).toBeVisible();
    // Either wording is correct depending on this seeded task's derived
    // runLive state (this E2E harness's fixture task has no attached live
    // pty, so it renders the "ended" variant) — the point under test is
    // that SOME interaction-status sentence renders, not a bare red pill.
    await expect(blocker).toContainText(
      /Claude may retry this automatically, or may be waiting for you to respond in the terminal\.|This run ended before the blocker was resolved — resume the task or check the terminal to continue\./,
    );
  });

  // @covers FR-01.66
  test("trailing narration with no further tool call is flushed as its own card instead of vanishing (issue #3)", async ({
    page,
    request,
  }) => {
    const task = await seedTask(request, { title: "Print the closing summary", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: pointer(task.sessionUuid, project.path),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        narratedTool("Fixing the last typo.", "e1", "Edit", { file_path: "src/last.ts" }),
        narrationOnly("All seven reported gaps are fixed. Wrapping up here."),
      ],
    });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    const feed = page.getByTestId("mission-activity-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });

    await expect(feed).toContainText("All seven reported gaps are fixed. Wrapping up here.");
    const closing = feed.locator('[data-kind="system"]', { hasText: "Wrapping up here." });
    await expect(closing).toBeVisible();
  });
});

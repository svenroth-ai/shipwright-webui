/*
 * campaign mission-desktop-style-v2, V2 - real-browser proof, through the REAL
 * JSONL -> parser -> reducer -> DOM chain (seeded transcript), that
 *   (a) a subagent hand-back (user-role record) is a LEFT .mc-handback card with
 *       the "Subagent report" tag, sender chip and notice - never a user bubble,
 *       and its English framing text is not on the page;
 *   (b) the evidence lines fold into ONE "Run result" card with a text pill and
 *       a button named after the target;
 *   (c) a delegated subagent is a distinct .mc-sub row with meta + "Report".
 * Read-only: no composer, no chat-* surface.
 *
 * @covers FR-01.66
 */
import { test, expect } from "@playwright/test";
import { cleanupProject, cleanupTask, seedProject, seedTask, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { writeFiles } from "../helpers/temp-dir";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";

const RUN_ID = "iterate-2026-10-31-v2-handback-e2e";
const SPEC_DOC = "# V2 hand-back fixture\n\nTouches FR-01.66 only.\n\n## Affected Boundaries\n\nReads the session JSONL.\n";
const AGENT = "a798d6e7922ba0bd9";

const dispatch = { type: "assistant", timestamp: "2026-10-31T10:00:00.000Z", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Agent", input: { description: "Review and merge M4 PR", subagent_type: "general-purpose" } }] } };
const ack = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: `Async agent launched successfully.\nagentId: ${AGENT}`, is_error: false }] } };
const notification = { type: "user", timestamp: "2026-10-31T10:44:00.000Z", message: { role: "user", content: `<task-notification>\n<task-id>${AGENT}</task-id>\n<status>completed</status>\n<summary>Done</summary>\n<result>Merged.</result>\n</task-notification>` }, origin: { kind: "task-notification" } };
const handback = {
  type: "user",
  timestamp: "2026-10-31T10:44:01.000Z",
  message: {
    role: "user",
    content: `Another Claude session sent a message:\n<agent-message from="${AGENT}">\n[Subagent hand-back] FRAMING-MARKER The text below is the final report. The report follows:\n  I opened PR 548 and merged it.\n  \n  - all checks green\n</agent-message>\n\nThat "other Claude session" is an agent working inside this same session.`,
  },
};

test.describe("V2 - hand-back card, Run result card, subrunner row", () => {
  test.describe.configure({ timeout: 120_000 });
  let project: SeededProject;
  let taskId = "";
  let projectSeeded = false;

  test.beforeEach(async ({ page, request }) => {
    taskId = "";
    projectSeeded = false;
    project = await seedProject(request, { name: "V2HandbackE2E", adopted: true });
    projectSeeded = true;
    await setActiveProject(page, project.projectId);
  });
  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (projectSeeded) await cleanupProject(request, project);
  });

  // @covers FR-01.66
  test("hand-back is a left card (not 'me'), evidence folds into one Run result, subagent is its own row", async ({ page, request }) => {
    const task = await seedTask(request, { title: "Handback", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: JSON.stringify({ run_id: RUN_ID, slug: "v2-handback-e2e", branch: "iterate/v2-handback-e2e", main_root: project.path, session_id: task.sessionUuid, created_at: "2026-10-31T09:00:00Z" }),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        { type: "user", message: { role: "user", content: [{ type: "text", text: "Please delegate the merge." }] } },
        dispatch, ack, notification, handback,
      ],
    });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    const feed = page.getByTestId("mission-activity-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });
    await expect(feed.locator("textarea, input")).toHaveCount(0);
    await expect(page.locator("[data-testid^='chat-']")).toHaveCount(0);

    // (a) hand-back: left card, warn left border, tag + chip + notice; framing hidden; exactly one human bubble.
    const card = feed.getByTestId("handback-card");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Subagent report");
    await expect(card).toContainText("Review and merge M4 PR");
    await expect(card).toContainText("a798d6e7");
    await expect(card).toContainText("I opened PR 548 and merged it.");
    await expect(card).toContainText("Reply from a subagent, not a message from you.");
    await expect(feed).not.toContainText("FRAMING-MARKER");
    await expect(feed).not.toContainText("Another Claude session");
    await expect(feed.locator('.mc-feed-entry[data-entry-kind="user"] .mc-feed-card')).toHaveCount(1);
    const style = await card.evaluate((el) => { const s = getComputedStyle(el); return { left: parseFloat(s.borderLeftWidth), color: s.borderLeftColor, edge: el.getBoundingClientRect().x }; });
    expect(style.left).toBeGreaterThanOrEqual(3);
    const fb = await feed.boundingBox();
    expect(style.edge).toBeLessThan(fb!.x + 40);

    // (b) one Run result card; Requirement row has a text pill and a button named after the target.
    const result = feed.getByTestId("run-result-card");
    await expect(result).toHaveCount(1);
    const row = result.locator('[data-testid="run-result-row"][data-artifact="requirement"]');
    await expect(row).toBeVisible();
    await expect(row.locator(".mc-pill")).toHaveText(/Recorded/);
    await expect(row.getByRole("button")).toHaveText("Requirement");
    await expect(feed.locator(".mc-story-link", { hasText: /^Open / })).toHaveCount(0);

    // (c) subrunner row: distinct from the card list, meta in words, Report action.
    const sub = feed.getByTestId("subrunner-row");
    await expect(sub).toHaveCount(1);
    await expect(sub).toContainText("Review and merge M4 PR");
    await expect(sub).toContainText("Subagent · general-purpose · finished in 44 min");
    await expect(sub.getByRole("button")).toHaveText("Report");
    const box = await sub.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
  });
});

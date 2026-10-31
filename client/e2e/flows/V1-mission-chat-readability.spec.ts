/*
 * campaign mission-desktop-style-v2, V1 — real-browser proof of the readable
 * Mission chat: full long messages (no "Show more"), 15px chat text, 28/36px
 * turn gaps, dark GFM table header, teal underlined links. Read-only.
 *
 * @covers FR-01.66
 */
import { test, expect } from "@playwright/test";
import { cleanupProject, cleanupTask, seedProject, seedTask, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { writeFiles } from "../helpers/temp-dir";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";

const RUN_ID = "iterate-2026-10-31-v1-chat-readability-e2e";
const SPEC_DOC = "# V1 chat readability fixture\n\nTouches FR-01.66 only.\n\n## Affected Boundaries\n\nReads the session JSONL.\n";
const TAIL = "THE-VERY-END-OF-A-LONG-MESSAGE";
const LONG = `${"This is a long paragraph of agent narration that used to be cut. ".repeat(40)}\n\n| Name | Value |\n|---|---|\n| alpha | 1 |\n| beta | 2 |\n\nSee [the docs](https://example.com/docs). ${TAIL}`;

const human = (t: string) => ({ type: "user", message: { role: "user", content: [{ type: "text", text: t }] } });
const agent = (t: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }, { type: "tool_use", id: "r1", name: "Edit", input: { file_path: "src/app.tsx" } }] } });

test.describe("V1 — Mission chat readability", () => {
  test.describe.configure({ timeout: 120_000 });
  let project: SeededProject;
  let taskId = "";
  let projectSeeded = false;

  test.beforeEach(async ({ page, request }) => {
    taskId = "";
    projectSeeded = false;
    project = await seedProject(request, { name: "V1ReadabilityE2E", adopted: true });
    projectSeeded = true;
    await setActiveProject(page, project.projectId);
  });
  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (projectSeeded) await cleanupProject(request, project);
  });

  // @covers FR-01.66
  test("long message in full, type scale, spacing, dark table, teal links", async ({ page, request }) => {
    const task = await seedTask(request, { title: "Readable chat", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: JSON.stringify({ run_id: RUN_ID, slug: "v1-readability-e2e", branch: "iterate/v1-readability-e2e", main_root: project.path, session_id: task.sessionUuid, created_at: "2026-10-31T10:00:00Z" }),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({ sessionUuid: task.sessionUuid, cwd: task.cwd, events: [human("Explain it."), agent(LONG), human("Thanks.")] });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    const feed = page.getByTestId("mission-activity-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });

    // Full message, no Show more on agent text.
    await expect(feed).toContainText(TAIL);
    await expect(feed.getByRole("button", { name: "Show more" })).toHaveCount(0);

    // Chat type scale: 15px.
    const agentCard = feed.locator(".mc-feed-entry:not([data-entry-kind='user']) .mc-feed-card", { hasText: "long paragraph" }).first();
    expect(await agentCard.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(15);

    // Spacing: 28px between turns, 36px total on a speaker change.
    const entries = feed.locator(".mc-feed-entry");
    const switched = feed.locator('.mc-feed-entry[data-switch="true"]');
    expect(await switched.count()).toBeGreaterThanOrEqual(2);
    const pad = await entries.first().evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    expect(pad).toBe(28);
    expect(await switched.first().evaluate((el) => parseFloat(getComputedStyle(el).marginTop))).toBe(8);

    // GFM table: wrapped, dark header (not white), 2px rule under it.
    const th = feed.locator(".mc-table-wrap th").first();
    await expect(th).toBeVisible();
    const thStyle = await th.evaluate((el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, rule: parseFloat(s.borderBottomWidth) }; });
    expect(thStyle.bg).toBe("rgb(45, 42, 40)");
    expect(thStyle.rule).toBe(2);

    // Links: light teal, underlined.
    const link = feed.getByRole("link", { name: "the docs" });
    const linkStyle = await link.evaluate((el) => { const s = getComputedStyle(el); return { color: s.color, deco: s.textDecorationLine }; });
    expect(linkStyle.color).toBe("rgb(127, 220, 202)");
    expect(linkStyle.deco).toContain("underline");
  });
});

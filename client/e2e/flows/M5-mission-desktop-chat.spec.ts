/*
 * campaign mission-desktop-style, M5 — real-browser proof of the desktop-app
 * style Mission chat and the clean AskUserQuestion rendering, driven through
 * the REAL JSONL -> reducer -> DOM chain (seeded transcript, incl. top-level
 * `toolUseResult.answers`). Read-only: no composer, no chat-* surface.
 *
 * @covers FR-01.66
 */
import { test, expect, type Page } from "@playwright/test";
import { cleanupProject, cleanupTask, seedProject, seedTask, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { writeFiles } from "../helpers/temp-dir";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";

const RUN_ID = "iterate-2026-10-30-m5-desktop-chat-e2e";
const SPEC_DOC = "# M5 desktop chat fixture\n\nTouches FR-01.66 only.\n\n## Affected Boundaries\n\nReads the session JSONL.\n";

const text = (t: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }] } });
const narratedRead = (t: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }, { type: "tool_use", id: "r1", name: "Edit", input: { file_path: "src/app.tsx" } }] } });
const human = (t: string) => ({ type: "user", message: { role: "user", content: [{ type: "text", text: t }] } });
const ask = (id: string, questions: unknown[]) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "AskUserQuestion", input: { questions } }] } });
const answered = (id: string, answers: Record<string, string>) => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "User has answered your questions.", is_error: false }] },
  toolUseResult: { questions: [], answers },
});
const rejected = (id: string) => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "The user declined this tool use.", is_error: true }] },
  toolUseResult: "User rejected tool use",
});

const PLATFORM = { question: "Which platform should the app target?", header: "Platform", multiSelect: false, options: [{ label: "Web App", description: "Runs in the browser" }, { label: "Mobile App", description: "Native iOS and Android" }] };
const STACK = { question: "Which stack do you prefer?", header: "Stack", multiSelect: false, options: [{ label: "React", description: "Component library" }, { label: "Vue", description: "Progressive framework" }] };
const REJECTED = { question: "Rejected question that must never show?", header: "Nope", multiSelect: false, options: [{ label: "Yes" }, { label: "No" }] };
const PENDING = { question: "Still waiting for the terminal answer?", header: "Pending", multiSelect: false, options: [{ label: "Go" }, { label: "Stop" }] };

/** WCAG contrast ratio of an element's text colour against its first opaque ancestor background. */
async function contrast(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fg = parse(getComputedStyle(el).color);
    let node: Element | null = el;
    let bg = [255, 255, 255];
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.length >= 3 && (c.length === 3 || c[3] > 0.9)) { bg = c; break; }
      node = node.parentElement;
    }
    const [a, b] = [lum(fg), lum(bg)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

test.describe("M5 — desktop-app style Mission chat", () => {
  test.describe.configure({ timeout: 120_000 });
  let project: SeededProject;
  let taskId = "";
  let projectSeeded = false;

  test.beforeEach(async ({ page, request }) => {
    taskId = "";
    projectSeeded = false;
    project = await seedProject(request, { name: "M5DesktopChatE2E", adopted: true });
    projectSeeded = true;
    await setActiveProject(page, project.projectId);
  });
  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (projectSeeded) await cleanupProject(request, project);
  });

  // @covers FR-01.66
  test("chat layout + answered / Other / rejected / pending AskUserQuestion rendering", async ({ page, request }) => {
    const task = await seedTask(request, { title: "Desktop style chat", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: JSON.stringify({ run_id: RUN_ID, slug: "m5-desktop-chat-e2e", branch: "iterate/m5-desktop-chat-e2e", main_root: project.path, session_id: task.sessionUuid, created_at: "2026-10-30T10:00:00Z" }),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        human("Please build me a todo app."),
        narratedRead("Sure. I need two decisions first."),
        ask("a1", [PLATFORM, STACK]),
        answered("a1", { [PLATFORM.question]: "Web App", [STACK.question]: "Svelte, please" }),
        ask("a2", [REJECTED]),
        rejected("a2"),
        ask("a3", [PENDING]),
      ],
    });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    const feed = page.getByTestId("mission-activity-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });

    // No avatar / timeline-node icons, and no composer surface.
    await expect(feed.locator(".mc-feed-node")).toHaveCount(0);
    await expect(feed.locator("textarea, input")).toHaveCount(0);
    await expect(page.locator("[data-testid^='chat-']")).toHaveCount(0);

    // Human message: right-aligned bubble. Agent text: left, no bubble.
    const userCard = feed.locator('.mc-feed-entry[data-entry-kind="user"] .mc-feed-card');
    // Exactly one human bubble: tool_result lines (which are user-role JSONL lines too) never become bubbles.
    await expect(userCard).toHaveCount(1);
    await expect(userCard).toContainText("Please build me a todo app.");
    const agentCard = feed.locator(".mc-feed-entry:not([data-entry-kind='user']):not([data-entry-kind='user-input']) .mc-feed-card", { hasText: "Sure. I need two decisions first." }).first();
    await expect(agentCard).toBeVisible();
    const [ub, ab, fb] = await Promise.all([userCard.boundingBox(), agentCard.boundingBox(), feed.boundingBox()]);
    expect(ub!.x + ub!.width).toBeGreaterThan(fb!.x + fb!.width - 40); // hugs the right edge
    expect(ab!.x).toBeLessThan(fb!.x + 40); // hugs the left edge
    const userStyle = await userCard.evaluate((el) => { const s = getComputedStyle(el); return { radius: parseFloat(s.borderTopLeftRadius), bg: s.backgroundColor }; });
    expect(userStyle.radius).toBeGreaterThanOrEqual(12);
    expect(userStyle.bg).not.toBe("rgba(0, 0, 0, 0)");
    const agentStyle = await agentCard.evaluate((el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, border: parseFloat(s.borderTopWidth) }; });
    expect(agentStyle).toEqual({ bg: "rgba(0, 0, 0, 0)", border: 0 });

    // Answered question: one card per answered question, options listed, chosen highlighted.
    const cards = feed.getByTestId("mission-ask-card");
    await expect(cards).toHaveCount(2);
    const platform = cards.nth(0);
    await expect(platform).toContainText(PLATFORM.question);
    await expect(platform).toContainText("Runs in the browser");
    await expect(platform.getByTestId("mission-ask-option")).toHaveCount(2);
    await expect(platform.locator('[data-testid="mission-ask-option"][data-chosen="true"]')).toHaveCount(1);
    await expect(platform.locator('[data-chosen="true"]')).toContainText("Web App");
    // 'Other' free text: shown as the selected answer, no option highlighted.
    const stack = cards.nth(1);
    await expect(stack.getByTestId("mission-ask-other")).toContainText("Svelte, please");
    await expect(stack.locator('[data-testid="mission-ask-option"][data-chosen="true"]')).toHaveCount(0);

    // Legibility: card text must keep AA contrast against its real ground (white-on-white guard).
    expect(await contrast(page, '[data-testid="mission-ask-card"] .mc-ask-question')).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(page, '[data-testid="mission-ask-option"][data-chosen="true"] .mc-ask-opt-label')).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(page, '[data-testid="mission-ask-option"]:not([data-chosen]) .mc-ask-opt-desc')).toBeGreaterThanOrEqual(3);

    // Rejected question is not shown; the genuinely pending one keeps its terminal CTA.
    await expect(feed).not.toContainText("Rejected question that must never show?");
    await expect(feed).toContainText(PENDING.question);
    await expect(feed.getByRole("button", { name: /answer/i })).toBeVisible();
    await expect(feed.getByTestId("mission-ask-card")).toHaveCount(2);
  });
});

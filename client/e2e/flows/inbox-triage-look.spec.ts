/*
 * Spec — inbox-triage-look (iterate-2026-11-13-inbox-triage-look).
 * Real-browser proof that the Inbox wears the Triage look and keeps its
 * behaviour: dark-glass cards with the project colour as a bar, a header pill
 * per project that folds the group, projects the user can put in their own
 * order (remembered across a reload), and the SAME left edge as the Triage page
 * so the content does not jump when the operator switches pages. jsdom has no
 * layout engine, real computed colours or real pointer drag.
 *
 * Route-mocks the inbox API so the content is controlled exactly; the Triage
 * page is mocked with zero projects (its body box is what is measured).
 */
import { test, expect, type Page } from "@playwright/test";

const SESSION_A = "3f9a1c42-1111-4111-8111-111111111111";
const SESSION_B = "71a2dab6-2222-4222-8222-222222222222";

const PROJECTS = [
  { id: "proj-a", name: "Shipwright", path: "C:/tmp/a", profile: "generic", status: "active", lastActive: "2026-11-13T00:00:00Z", createdAt: "2026-11-13T00:00:00Z" },
  { id: "proj-b", name: "Content Marketing", path: "C:/tmp/b", profile: "generic", status: "active", lastActive: "2026-11-13T00:00:00Z", createdAt: "2026-11-13T00:00:00Z" },
];

function task(taskId: string, sessionUuid: string, projectId: string, title: string) {
  return {
    taskId,
    sessionUuid,
    cwd: "C:/tmp",
    pluginDirs: [],
    title,
    projectId,
    state: "idle",
    createdAt: "2026-11-12T00:00:00Z",
    launchedAt: "2026-11-12T00:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
  };
}

async function mockInbox(page: Page, opts: { withProjects: boolean }) {
  await page.route("**/api/projects", (r) => r.fulfill({ json: { data: opts.withProjects ? PROJECTS : [] } }));
  await page.route("**/api/external/tasks*", (r) =>
    r.fulfill({
      json: {
        tasks: [
          task("task-a", SESSION_A, "proj-a", "build / Inbox restyle"),
          task("task-b", SESSION_B, "proj-b", "plan / Handles"),
        ],
      },
    }),
  );
  await page.route("**/api/external/inbox", (r) =>
    r.fulfill({
      json: {
        items: [
          {
            kind: "text_question",
            taskId: "task-a",
            sessionUuid: SESSION_A,
            taskTitle: "build / Inbox restyle",
            questionId: "q-a",
            questionText: "**Zu Schnitt 2:** soll ich ihn `jetzt` machen?",
            bestEffort: true,
          },
          {
            kind: "text_question",
            taskId: "task-b",
            sessionUuid: SESSION_B,
            taskTitle: "plan / Handles",
            questionId: "q-b",
            questionText: "Soll ich beide auf skipped setzen?",
            bestEffort: true,
          },
        ],
      },
    }),
  );
  await page.route("**/api/triage/counts", (r) => r.fulfill({ json: { counts: {}, total: 0 } }));
}

async function groupOrder(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="inbox-project-group-proj-"]:not([data-testid*="toggle"])')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("inbox-project-group-", "")));
}

// @covers FR-01.30
test.describe("Inbox in the Triage look", () => {
  test.beforeEach(async ({ page }) => {
    await mockInbox(page, { withProjects: true });
  });

  test("cards are dark glass with a project-colour bar, text is light, markdown survives", async ({ page }) => {
    await page.goto("/inbox");
    const card = page.getByTestId("inbox-card-q-a");
    await expect(card).toBeVisible();

    const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = bg.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
    expect(Math.max(r!, g!, b!), `card background ${bg} must be dark`).toBeLessThan(90);

    const bodyColor = await page
      .getByTestId("inbox-question-text-q-a")
      .locator("p")
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    const [tr] = bodyColor.match(/\d+(\.\d+)?/g)!.map(Number);
    expect(tr!, `body text ${bodyColor} must be light`).toBeGreaterThan(200);

    // markdown is still rendered (bold + inline code), inline code is not a light chip with white text
    await expect(page.getByTestId("inbox-question-text-q-a").locator("strong").first()).toBeVisible();
    const codeBg = await page
      .getByTestId("inbox-question-text-q-a")
      .locator("code")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    // translucent white over the dark card is fine (a faint chip); an OPAQUE light chip is the bug
    const codeParts = codeBg.match(/\d+(\.\d+)?/g)!.map(Number);
    const codeAlpha = codeParts.length > 3 ? codeParts[3]! : 1;
    expect(codeAlpha, `inline code background ${codeBg} must not be an opaque light chip`).toBeLessThanOrEqual(0.3);

    // a SHORT text must not get the "long text" fade (an inline-code border once switched it on)
    await expect(page.getByTestId("inbox-question-fade-q-a")).toHaveCount(0);
    await expect(page.getByTestId("inbox-question-fade-q-b")).toHaveCount(0);

    // the old white panel around the list is gone
    await expect(page.getByTestId("inbox-list-panel")).toHaveCount(0);

    // the session chip sits on the card, the whole row is the 720px reading width at most
    await expect(page.getByTestId(`inbox-group-project-label-${SESSION_A}-q-a`)).toHaveText("3f9a1c42");
    const width = await card.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeLessThanOrEqual(721);

    await page.screenshot({ path: "test-results/inbox-triage-look.png", fullPage: true });
  });

  test("the project pill folds its group and the fold is remembered across a reload", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-card-q-a")).toBeVisible();
    await page.getByTestId("inbox-project-group-toggle-proj-a").click();
    await expect(page.getByTestId("inbox-card-q-a")).toHaveCount(0);
    await expect(page.getByTestId("inbox-card-q-b")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("inbox-card-q-b")).toBeVisible();
    await expect(page.getByTestId("inbox-card-q-a")).toHaveCount(0);
    await expect(page.getByTestId("inbox-project-group-toggle-proj-a")).toHaveAttribute("aria-expanded", "false");
  });

  test("projects can be put in their own order with the keyboard", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-card-q-a")).toBeVisible();
    expect(await groupOrder(page)).toEqual(["proj-a", "proj-b"]);
    await page.getByTestId("inbox-group-handle-proj-a").focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => groupOrder(page)).toEqual(["proj-b", "proj-a"]);
    // the handle kept focus so a second press keeps moving it
    await expect(page.getByTestId("inbox-group-handle-proj-a")).toBeFocused();
  });

  test("a click on a card still opens the task; the answer button does not double-navigate", async ({ page }) => {
    await page.route("**/api/external/tasks/task-a*", (r) =>
      r.fulfill({ json: { task: task("task-a", SESSION_A, "proj-a", "build / Inbox restyle") } }),
    );
    await page.goto("/inbox");
    await page.getByTestId("inbox-card-q-a").click({ position: { x: 40, y: 30 } });
    await expect(page).toHaveURL(/\/tasks\/task-a/);
  });
});

// @covers FR-01.30
test("the Inbox content starts at the same left edge as the Triage page (no jump when switching)", async ({ page }) => {
  await mockInbox(page, { withProjects: false });
  await page.goto("/inbox");
  await expect(page.getByTestId("inbox-page")).toBeVisible();
  await expect(page.getByTestId("inbox-card-q-a")).toBeVisible();
  const inboxLeft = await page
    .locator('[data-testid="inbox-page"] .page-container')
    .evaluate((el) => el.getBoundingClientRect().left);
  const inboxFirst = await page
    .getByTestId("inbox-list")
    .evaluate((el) => el.getBoundingClientRect().left);

  await page.goto("/triage");
  await expect(page.getByTestId("triage-page")).toBeVisible();
  const triageLeft = await page
    .locator('[data-testid="triage-page"] .page-container')
    .evaluate((el) => el.getBoundingClientRect().left);

  expect(inboxLeft).toBe(triageLeft);
  // and the Inbox list begins at the container's padding edge, not further right
  expect(inboxFirst).toBe(triageLeft + 32);
});

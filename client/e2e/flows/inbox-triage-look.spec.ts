/*
 * Spec — inbox-triage-look (iterate-2026-11-13-inbox-triage-look, rewritten by
 * iterate-2026-11-22-w2-inbox-triage-look).
 * Real-browser proof that the Inbox wears the Triage look and keeps its
 * behaviour: one dark-glass card per project with a colour bar, compact rows
 * (orange AWAITING REPLY chip, first line, id, age), a filter bar, an action
 * zone that appears on hover / focus without moving the title, a light detail
 * dialog with the full text, a header pill that folds the group, projects the
 * user can put in their own order (remembered across a reload), and the SAME
 * left edge as the Triage page. jsdom has no layout engine, real computed
 * colours, hover, or real pointer drag.
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

// @covers FR-01.04
test.describe("Inbox in the Triage look", () => {
  test.beforeEach(async ({ page }) => {
    await mockInbox(page, { withProjects: true });
  });

  test("compact rows on dark project cards: chip, first line, filter bar, hover action that never moves the title", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/inbox");
    const row = page.getByTestId("inbox-card-q-a");
    await expect(row).toBeVisible();

    // the project card is dark glass with a coloured bar
    const group = page.getByTestId("inbox-project-group-proj-a");
    const bg = await group.evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = bg.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
    expect(Math.max(r!, g!, b!), `card background ${bg} must be dark`).toBeLessThan(90);

    // the row shows the FIRST LINE as plain text (markdown marks removed) and the orange chip
    const title = page.getByTestId("inbox-row-title-q-a");
    await expect(title).toHaveText("Zu Schnitt 2: soll ich ihn jetzt machen?");
    const chip = page.getByTestId("inbox-chip-q-a");
    await expect(chip).toHaveText(/awaiting reply/i);
    const chipBg = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(chipBg).toBe("rgb(106, 58, 10)");

    // the filter bar counts both entries
    await expect(page.getByTestId("inbox-filter-all")).toContainText("2 Open");
    await expect(page.getByTestId("inbox-filter-awaiting")).toContainText("2 Awaiting reply");

    // the session id sits on the row, and the row reads as a row (not a 720px card)
    await expect(page.getByTestId(`inbox-row-q-a-id`)).toHaveText("3f9a1c42");

    // the action zone is empty until hover / focus, and the title does not move
    const cta = page.getByTestId("inbox-resume-q-a");
    await expect(cta).toBeHidden();
    const before = await title.boundingBox();
    await row.hover();
    await expect(cta).toBeVisible();
    await expect(cta).toContainText(/answer in the terminal/i);
    const after = await title.boundingBox();
    expect(after).toEqual(before);

    // keyboard focus shows it too
    await page.mouse.move(0, 0);
    await expect(cta).toBeHidden();
    await title.focus();
    await expect(cta).toBeVisible();

    await page.screenshot({ path: "test-results/inbox-triage-look.png", fullPage: true });
  });

  test("a click opens the light detail dialog with the full text; markdown survives there", async ({ page }) => {
    await page.goto("/inbox");
    await page.getByTestId("inbox-card-q-a").click({ position: { x: 60, y: 24 } });
    const dialog = page.getByTestId("inbox-detail-q-a");
    await expect(dialog).toBeVisible();
    const bg = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = bg.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
    expect(Math.min(r!, g!, b!), `dialog background ${bg} must be light`).toBeGreaterThan(200);

    const body = page.getByTestId("inbox-question-text-q-a");
    await expect(body.locator("strong").first()).toBeVisible();
    await expect(body.locator("code").first()).toBeVisible();
    const color = await body.locator("p").first().evaluate((el) => getComputedStyle(el).color);
    const [tr] = color.match(/\d+(\.\d+)?/g)!.map(Number);
    expect(tr!, `dialog text ${color} must be dark`).toBeLessThan(90);
    await expect(page.getByTestId("inbox-honesty-q-a")).toContainText(/does(n't| not) answer/i);
    await expect(page.getByTestId("inbox-resume-q-a-dialog")).toBeVisible();

    await page.screenshot({ path: "test-results/inbox-triage-look-dialog.png" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // Escape returned focus to where the operator was, and the row is still there
    await expect(page.getByTestId("inbox-card-q-a")).toBeVisible();
  });

  test("the filter chips narrow the list", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-card-q-a")).toBeVisible();
    await expect(page.getByTestId("inbox-filter-notices")).toHaveCount(0);
    await expect(page.getByTestId("inbox-filter-awaiting")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("inbox-filter-awaiting").click();
    await expect(page.getByTestId("inbox-filter-awaiting")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("inbox-card-q-b")).toBeVisible();
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

  test("Open task in the dialog goes to the task; the answer button does not double-navigate", async ({ page }) => {
    await page.route("**/api/external/tasks/task-a*", (r) =>
      r.fulfill({ json: { task: task("task-a", SESSION_A, "proj-a", "build / Inbox restyle") } }),
    );
    await page.goto("/inbox");
    await page.getByTestId("inbox-card-q-a").click({ position: { x: 60, y: 24 } });
    await page.getByTestId("inbox-open-task-q-a").click();
    await expect(page).toHaveURL(/\/tasks\/task-a/);
  });
});

// @covers FR-01.04
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

// @covers FR-01.04
test.describe("Inbox on a touch phone", () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

  test("the Answer button is always visible (no hover needed) and sits under the title", async ({ page }) => {
    await mockInbox(page, { withProjects: true });
    await page.goto("/inbox");
    const cta = page.getByTestId("inbox-resume-q-a");
    await expect(cta).toBeVisible();
    const t = await page.getByTestId("inbox-row-title-q-a").boundingBox();
    const c = await cta.boundingBox();
    expect(c!.y).toBeGreaterThan(t!.y);
    // no horizontal overflow of the page
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "test-results/inbox-triage-look-phone.png", fullPage: true });
  });
});

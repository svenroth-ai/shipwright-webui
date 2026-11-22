/*
 * Spec - inbox-reminders (campaign reminders-webui, W3; FR-01.76).
 * Real-browser proof of reminders in the Inbox: green REMINDER / grey PARKED
 * TRIAGE rows, the sidebar count, create (project picker + More options),
 * hover actions (Snooze with Tomorrow, Done, Start task), the detail dialog
 * with hostile text, and an error state that never reads as "nothing due".
 *
 * The project is REAL (seeded through the API, so Start task resolves its real
 * action catalog and the New Task dialog is the real one); only the reminder
 * routes are answered here by a small stateful stand-in for the Shipwright
 * reminder tool (the server bridge has its own unit + integration tests). The
 * isolated stack has no plugin cache, so the real tool cannot be assumed.
 *
 * Set E2E_SHOTS=<dir> to also write screenshots of each step (manual review).
 */
import { test, expect, type Page } from "@playwright/test";
import { cleanupProject, cleanupTask, seedProject, type SeededProject } from "../helpers/fixtures";
import { apiUrl } from "../helpers/env";

const TODAY = new Date().toISOString().slice(0, 10);

interface Item {
  kind: "reminder" | "triage";
  id: string;
  title: string;
  due: string;
  why: string | null;
  decided: string | null;
  open: string | null;
  command: string | null;
  links: { label: string | null; kind: string | null; ref: string | null }[];
  severity: string | null;
}

function item(over: Partial<Item> & Pick<Item, "id" | "title">): Item {
  return { kind: "reminder", due: TODAY, why: "Because it matters.", decided: null, open: null, command: null, links: [], severity: null, ...over };
}

async function mockReminders(page: Page, projectId: string, state: { items: Item[]; mode: "ok" | "unavailable" }) {
  const calls: { verb: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/reminders/**", async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split("/").filter(Boolean); // api, reminders, due | <projectId>, <verb>
    if (route.request().method() === "GET") {
      if (state.mode === "unavailable") {
        return route.fulfill({ json: { projects: [{ projectId, state: "unsupported-version", contractVersion: "9" }] } });
      }
      const items = state.items.filter((i) => i.due <= TODAY);
      return route.fulfill({
        json: { projects: [{ projectId, state: "ok", contractVersion: 1, on: TODAY, reminderCorruptLines: 0, triageError: null, items }] },
      });
    }
    const verb = parts[parts.length - 1];
    const body = route.request().postDataJSON() as Record<string, unknown>;
    calls.push({ verb, body });
    if (verb === "add") {
      state.items.push(item({ id: `rem-${state.items.length + 100}`, title: String(body.title), due: String(body.due), why: String(body.why), command: (body.command as string) ?? null }));
      return route.fulfill({ status: 201, json: { ok: true } });
    }
    const target = state.items.find((i) => i.id === body.id);
    if (!target) return route.fulfill({ status: 404, json: { error: "not_found", message: "No such reminder." } });
    if (verb === "done") state.items = state.items.filter((i) => i !== target);
    if (verb === "snooze") target.due = String(body.until);
    return route.fulfill({ json: { ok: true } });
  });
  return calls;
}

async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

const sidebarCount = (page: Page) => page.locator('nav a[href="/inbox"]').first();

// @covers FR-01.76
test.describe("Inbox reminders", () => {
  let project: SeededProject;
  const createdTasks: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of createdTasks.splice(0)) await cleanupTask(request, id);
    await cleanupProject(request, project);
  });

  test("create, snooze, done, start task - and hostile text stays text", async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-e2e-reminders", adopted: true });
    page.on("dialog", (d) => {
      throw new Error(`a script ran: ${d.message()}`);
    });
    const state = {
      mode: "ok" as const,
      items: [
        item({ id: "rem-a41c09", title: "Renew the code-signing certificate", command: "/shipwright-iterate renew signing cert", open: "Who pays? ".repeat(300) }),
        item({ id: "rem-3be7f2", title: "<b>bold</b> <script>alert(1)</script> in title", why: "<img src=x onerror=alert(2)>" }),
        item({ kind: "triage", id: "trg-1a2b3c4d", title: "Revisit: flaky Windows runner", due: "2026-11-18", command: "/shipwright-triage fix-now trg-1a2b3c4d" }),
      ],
    };
    const calls = await mockReminders(page, project.projectId, state);
    await page.goto("/inbox");

    // Rows, chips, counts.
    const rem = page.getByTestId("inbox-card-reminder-" + project.projectId + "-rem-a41c09");
    const hostile = page.getByTestId("inbox-card-reminder-" + project.projectId + "-rem-3be7f2");
    const park = page.getByTestId("inbox-card-triage-" + project.projectId + "-trg-1a2b3c4d");
    await expect(rem).toBeVisible();
    await expect(page.getByTestId("inbox-chip-reminder-" + project.projectId + "-rem-a41c09")).toHaveText(/reminder/i);
    await expect(page.getByTestId("inbox-chip-triage-" + project.projectId + "-trg-1a2b3c4d")).toHaveText(/parked triage/i);
    await expect(page.getByTestId("inbox-header-count")).toHaveText("(3 open)");
    await expect(sidebarCount(page)).toContainText("3");
    await expect(hostile.getByRole("button", { name: /<b>bold<\/b> <script>/ })).toBeVisible();
    // The green and the grey chip are different colours (reminder = green, parked = grey).
    const bg = (loc: ReturnType<Page["getByTestId"]>) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg(page.getByTestId("inbox-chip-reminder-" + project.projectId + "-rem-a41c09"))).toBe("rgb(19, 78, 72)");
    expect(await bg(page.getByTestId("inbox-chip-triage-" + project.projectId + "-trg-1a2b3c4d"))).toBe("rgb(87, 83, 78)");
    await shot(page, "01-rows");

    // Hover shows the actions without moving the title.
    const titleBox = await rem.getByTestId(/inbox-row-title-/).boundingBox();
    await rem.hover();
    await expect(rem.getByTestId(/reminder-start-/)).toBeVisible();
    await expect(rem.getByTestId(/reminder-done-/)).toBeVisible();
    expect((await rem.getByTestId(/inbox-row-title-/).boundingBox())?.x).toBe(titleBox?.x);
    await shot(page, "02-hover");
    // A parked entry offers only Open in Triage; a reminder without a command has no Start task.
    await park.hover();
    await expect(park.getByTestId(/reminder-open-triage-/)).toBeVisible();
    await expect(park.getByTestId(/reminder-done-/)).toHaveCount(0);
    await hostile.hover();
    await expect(hostile.getByTestId(/reminder-start-/)).toHaveCount(0);

    // Detail dialog: hostile text is plain text, a very long open text scrolls in its own box.
    await hostile.getByRole("button", { name: /<b>bold/ }).click();
    const dlg = page.getByTestId("inbox-detail-reminder-" + project.projectId + "-rem-3be7f2");
    await expect(dlg).toContainText("<img src=x onerror=alert(2)>");
    await expect(dlg.locator("script, img")).toHaveCount(0);
    await shot(page, "03-dialog-hostile");
    await page.keyboard.press("Escape");
    await rem.getByTestId(/inbox-row-title-/).click();
    const longBox = page.getByTestId("reminder-open-reminder-" + project.projectId + "-rem-a41c09").locator(".inbox-open-box");
    expect(await longBox.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(page.getByTestId("reminder-command-reminder-" + project.projectId + "-rem-a41c09")).toContainText("/shipwright-iterate renew signing cert");
    await shot(page, "04-dialog-long");
    await page.keyboard.press("Escape");

    // Create: with All projects the dialog asks for the project.
    await page.getByTestId("inbox-new-reminder").click();
    await expect(page.getByTestId("new-reminder-project")).toBeVisible();
    await shot(page, "05-create-picker");
    await page.getByTestId("new-reminder-project").selectOption(project.projectId);
    await page.getByTestId("new-reminder-title").fill("Check the newsletter sender address");
    await page.getByTestId("new-reminder-due").fill(TODAY);
    await page.getByTestId("new-reminder-why").fill("The provider announced new sender rules.");
    await page.getByTestId("new-issue-more-options-toggle").click();
    await page.getByTestId("new-reminder-decided").fill("Keep the current relay.");
    await shot(page, "06-create-more");
    await page.getByTestId("new-reminder-submit").click();
    await expect(page.getByTestId("inbox-reminder-created")).toContainText(`Reminder created for ${TODAY}`);
    expect(calls.find((c) => c.verb === "add")?.body).toMatchObject({ title: "Check the newsletter sender address", due: TODAY, decided: "Keep the current relay." });
    const created = page.getByRole("button", { name: "Check the newsletter sender address" });
    await expect(created).toBeVisible();
    await expect(page.getByTestId("inbox-header-count")).toHaveText("(4 open)");

    // Snooze with Tomorrow: the row leaves the Inbox and the count drops.
    await created.hover();
    const row = page.locator('[data-testid^="inbox-card-"]', { has: created });
    await row.getByTestId(/reminder-snooze-/).click();
    await shot(page, "07-snooze-popover");
    await page.getByTestId(/-snooze-tomorrow$/).click();
    await page.getByTestId(/-snooze-go$/).click();
    await expect(created).toHaveCount(0);
    expect(calls.find((c) => c.verb === "snooze")?.body.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByTestId("inbox-header-count")).toHaveText("(3 open)");

    // Done on the hostile one.
    await hostile.hover();
    await hostile.getByTestId(/reminder-done-/).click();
    await expect(hostile).toHaveCount(0);
    expect(calls.find((c) => c.verb === "done")?.body.id).toBe("rem-3be7f2");
    await expect(sidebarCount(page)).toContainText("2");

    // Start task: the real New Task dialog opens pre-filled; nothing launches by itself.
    await rem.hover();
    await rem.getByTestId(/reminder-start-/).click();
    await expect(page.getByTestId("new-issue-title-input")).toHaveValue("Renew the code-signing certificate");
    await expect(page.getByTestId("new-issue-description-input")).toHaveValue(/Because it matters\./);
    expect(await page.getByTestId("new-issue-description-input").inputValue()).not.toContain("/shipwright-iterate renew signing cert");
    await shot(page, "08-start-task");
    await page.getByTestId("new-issue-save-btn").click();
    await expect(page.getByTestId("new-issue-title-input")).toHaveCount(0);
    const tasks = (await (await request.get(apiUrl("/api/external/tasks"))).json()) as { tasks: { taskId: string; title: string; state: string; projectId: string }[] };
    const made = tasks.tasks.filter((t) => t.title === "Renew the code-signing certificate" && t.projectId === project.projectId);
    createdTasks.push(...made.map((t) => t.taskId));
    expect(made).toHaveLength(1);
    expect(made[0].state).toBe("draft");
  });

  test("an unreadable reminder tool is a banner, never an empty 'inbox is clear'", async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-e2e-reminders-err", adopted: true });
    await mockReminders(page, project.projectId, { items: [], mode: "unavailable" });
    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-reminders-unavailable")).toContainText("Reminders are unavailable.");
    await expect(page.getByTestId("inbox-empty")).toHaveCount(0);
    await shot(page, "09-unavailable");
  });
  test("on a narrow screen the actions sit under the title and need no hover", async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-e2e-reminders-narrow", adopted: true });
    await mockReminders(page, project.projectId, {
      mode: "ok",
      items: [item({ id: "rem-a41c09", title: "Renew the code-signing certificate", command: "/shipwright-iterate renew" })],
    });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/inbox");
    const row = page.getByTestId("inbox-card-reminder-" + project.projectId + "-rem-a41c09");
    await expect(row.getByTestId(/reminder-start-/)).toBeVisible();
    await expect(row.getByTestId(/reminder-done-/)).toBeVisible();
    await expect(row.getByTestId(/reminder-snooze-/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, "10-narrow");
  });
});

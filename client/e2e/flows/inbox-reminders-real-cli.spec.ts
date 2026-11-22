/*
 * Spec - inbox-reminders-real-cli (campaign reminders-webui, W3; FR-01.76).
 * The same Inbox, but answered by the REAL Shipwright reminder tool through the
 * W1 server bridge: create through the dialog, see the row, snooze it, mark
 * another done, and see the tool's own refusal of a secret. Runs only when
 * SHIPWRIGHT_REMINDER_CLI_PATH points at a reminder_cli.py (the isolated stack
 * has no plugin cache); otherwise it is skipped, never silently green.
 */
import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cleanupProject, seedProject, type SeededProject } from "../helpers/fixtures";

const CLI = process.env.SHIPWRIGHT_REMINDER_CLI_PATH ?? "";
const TODAY = new Date().toISOString().slice(0, 10);
// The well-known documentation example key, assembled at run time so no key-shaped literal sits in the source.
const FAKE_KEY = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");

// @covers FR-01.76
test.describe("Inbox reminders - real reminder tool", () => {
  test.skip(!CLI || !existsSync(CLI), "SHIPWRIGHT_REMINDER_CLI_PATH is not set to a reminder_cli.py");
  let project: SeededProject;

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("create, snooze, done and a refused secret, end to end", async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-e2e-reminders-real", adopted: true });
    await page.goto(`/inbox?projectId=${project.projectId}`);

    const create = async (title: string, why: string) => {
      await page.getByTestId("inbox-new-reminder").click();
      await expect(page.getByTestId("project-context-name")).toHaveText("Atlas");
      await page.getByTestId("new-reminder-title").fill(title);
      await page.getByTestId("new-reminder-due").fill(TODAY);
      await page.getByTestId("new-reminder-why").fill(why);
      await page.getByTestId("new-reminder-submit").click();
    };

    await create("Real reminder one", "First reason.");
    await expect(page.getByTestId("inbox-reminder-created")).toBeVisible();
    const one = page.getByRole("button", { name: "Real reminder one" });
    await expect(one).toBeVisible();
    await expect(page.getByTestId("inbox-header-count")).toHaveText("(1 open)");
    const store = path.join(project.path, ".shipwright", "reminders.jsonl");
    expect(existsSync(store)).toBe(true);
    expect(readFileSync(store, "utf8")).toContain("Real reminder one");

    await create("Real reminder two", "Second reason.");
    const two = page.getByRole("button", { name: "Real reminder two" });
    await expect(two).toBeVisible();

    // Snooze one to tomorrow: it leaves the Inbox.
    const rowOf = (title: string) => page.locator('[data-testid^="inbox-card-"]', { has: page.getByRole("button", { name: title }) });
    await rowOf("Real reminder one").hover();
    await rowOf("Real reminder one").getByTestId(/^reminder-snooze-/).click();
    await page.getByTestId(/-snooze-tomorrow$/).click();
    await page.getByTestId(/-snooze-go$/).click();
    await expect(one).toHaveCount(0);
    await expect(page.getByTestId("inbox-header-count")).toHaveText("(1 open)");

    // Done on the other one.
    await rowOf("Real reminder two").hover();
    await rowOf("Real reminder two").getByTestId(/^reminder-done-/).click();
    await expect(two).toHaveCount(0);

    // The tool's own refusal of a secret is shown unchanged and nothing is stored.
    await create("Has a secret", `key ${FAKE_KEY} and password=hunter2hunter2`);
    await expect(page.getByTestId("new-reminder-error")).toContainText("Not saved.");
    await expect(page.getByTestId("new-reminder-why")).toHaveValue(new RegExp(FAKE_KEY));
    expect(readFileSync(store, "utf8")).not.toContain(FAKE_KEY);
  });
});

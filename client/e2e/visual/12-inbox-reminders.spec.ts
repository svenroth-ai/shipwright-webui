/*
 * Visual: Inbox with reminders (campaign reminders-webui, W3; FR-01.76). One
 * dark project card: a green REMINDER row, a grey PARKED TRIAGE row, the filter
 * bar and the "+ New reminder" button. The reminder tool's answer is pinned (and
 * the page clock frozen) so the baseline never depends on the day it runs.
 */
import { test, expect } from "@playwright/test";
import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { settle } from "./stabilize";

const DAY = "2026-03-10";

test.describe("visual: inbox reminders", () => {
  let project: SeededProject;

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  // @covers FR-01.76
  test("inbox-reminders", async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-visual-inbox-reminders" });
    await page.clock.setFixedTime(new Date(`${DAY}T09:00:00Z`));
    await page.route("**/api/reminders/**", (route) =>
      route.fulfill({
        json: {
          projects: [
            {
              projectId: project.projectId,
              state: "ok",
              contractVersion: 1,
              on: DAY,
              reminderCorruptLines: 0,
              triageError: null,
              items: [
                { kind: "reminder", id: "rem-a41c09", title: "Renew the code-signing certificate", due: DAY, why: "It expires on the 15th.", decided: null, open: null, command: "/shipwright-iterate renew", links: [], severity: null },
                { kind: "triage", id: "trg-1a2b3c4d", title: "Revisit: flaky Windows runner", due: "2026-03-06", why: null, decided: null, open: null, command: null, links: [], severity: null },
              ],
            },
          ],
        },
      }),
    );
    await setActiveProject(page, project.projectId);
    await page.goto("/inbox");
    await expect(page.getByRole("button", { name: "Renew the code-signing certificate" })).toBeVisible({ timeout: 15_000 });
    await settle(page);
    await expect(page).toHaveScreenshot("inbox-reminders.png", { fullPage: true });
  });
});

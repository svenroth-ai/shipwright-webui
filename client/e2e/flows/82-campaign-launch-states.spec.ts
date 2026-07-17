/*
 * A17 (FR-01.61) — the board launch state machine, end to end.
 *
 * Seeds a project + a DRAFT campaign, starts it from the board (badge flips),
 * opens the launch confirmation dialog and cancels (nothing created), then
 * forces a failing launch and asserts the persistent failure notice + the
 * retry affordance. This is the flow that was SILENT before A17: a launch that
 * the server refuses used to leave the board looking exactly as it did a second
 * earlier.
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { seedCampaign } from "../helpers/campaign-fixture";

test.describe("A17: campaign launch states", () => {
  let project: SeededProject;

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("AC1: a draft campaign shows its status badge + Start CTA, and Start flips it to active", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "Launch States", dirName: "sw-e2e-a17-draft", adopted: true });
    const slug = "2026-07-10-a17-demo";
    seedCampaign(project.path, {
      slug,
      status: "draft",
      subIterates: [
        { id: "S1", slug: "one", status: "pending", title: "First" },
        { id: "S2", slug: "two", status: "pending", title: "Second" },
      ],
    });
    await setActiveProject(page, project.projectId);
    await page.goto("/");

    // The draft campaign is on the BOARD now (was Triage-only before A17).
    const badge = page.getByTestId(`campaign-status-${slug}`);
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await expect(badge).toHaveAttribute("data-status", "draft");

    // Start it from the board → the SAME useStartCampaign hook the triage modal uses.
    await page.getByTestId(`campaign-toggle-${slug}`).click();
    await page.getByTestId(`campaign-start-${slug}`).click();

    // The badge flips to active (the 3s poll picks up the status.json write).
    await expect(badge).toHaveAttribute("data-status", "active", { timeout: 15_000 });
    // Launch CTAs are now offered.
    await expect(page.getByTestId(`campaign-step-launch-${slug}`)).toBeVisible();
  });

  test("AC2: opening the launch dialog shows the verbatim command; Cancel creates nothing", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "Launch States", dirName: "sw-e2e-a17-active", adopted: true });
    const slug = "2026-07-10-a17-active";
    seedCampaign(project.path, {
      slug,
      status: "active",
      subIterates: [{ id: "S1", slug: "one", status: "pending", title: "First" }],
    });
    await setActiveProject(page, project.projectId);
    await page.goto("/");

    await page.getByTestId(`campaign-toggle-${slug}`).click();
    await page.getByTestId(`campaign-step-launch-${slug}`).click();

    // The dialog names the verbatim command (not a paraphrase).
    const command = page.getByTestId(`campaign-step-command-${slug}`);
    await expect(command).toBeVisible();
    await expect(command).toContainText("/shipwright-iterate");

    // Cancel creates nothing — no navigation to a task.
    await page.getByTestId(`campaign-step-cancel-${slug}`).click();
    await expect(page.getByTestId(`campaign-step-dialog-${slug}`)).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  });

  test("AC3: a refused launch surfaces a persistent failure notice with a Retry", async ({
    page,
    request,
  }) => {
    project = await seedProject(request, { name: "Launch States", dirName: "sw-e2e-a17-fail", adopted: true });
    const slug = "2026-07-10-a17-fail";
    seedCampaign(project.path, {
      slug,
      status: "active",
      subIterates: [{ id: "S1", slug: "one", status: "pending", title: "First" }],
    });
    await setActiveProject(page, project.projectId);

    // Stub the launch to a transient lock (503) — the campaign task is created,
    // but the launch is refused. This is the state that used to be invisible.
    await page.route("**/api/external/tasks/*/launch", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "lock_unavailable", message: "busy" }),
      }),
    );

    await page.goto("/");
    await page.getByTestId(`campaign-toggle-${slug}`).click();
    await page.getByTestId(`campaign-step-launch-${slug}`).click();
    await page.getByTestId(`campaign-step-confirm-${slug}`).click();

    // A persistent, code-specific notice — with a Retry (503 is transient).
    const notice = page.getByTestId(`campaign-step-failure-${slug}`);
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice).toHaveAttribute("data-launch-failure-code", "lock_unavailable");
    await expect(page.getByTestId(`campaign-step-failure-${slug}-retry`)).toBeVisible();
    // It did NOT navigate away — the failure is visible where the operator is.
    await expect(page).toHaveURL(/\/$/);
  });
});

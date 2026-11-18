/*
 * Spec — triage-project-filter-independent
 * (iterate-2026-11-18-triage-project-filter-independent, FR-01.30).
 *
 * The Triage project dropdown is independent of the Task Board's project
 * selection: it starts on "All projects" even when the Board has a project
 * picked, and choosing a project on Triage does not change the Board's pick.
 */

import { test, expect } from "@playwright/test";

import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";

// @covers FR-01.30
test.describe("Triage project filter is independent of the Board", () => {
  let a: SeededProject;
  let b: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    a = await seedProject(request, { name: `triage-indep-a-${Date.now()}` });
    b = await seedProject(request, { name: `triage-indep-b-${Date.now()}` });
    await setActiveProject(page, a.projectId); // the Board has project A selected
  });

  test.afterEach(async ({ request }) => {
    for (const p of [a, b]) if (p) await cleanupProject(request, p);
  });

  // @covers FR-01.30
  test("starts on All projects and leaves the Board selection alone", async ({ page }) => {
    await page.goto("/triage");
    const trigger = page.getByTestId("project-filter-dropdown");
    await expect(trigger).toContainText("All projects", { timeout: 35_000 });

    await trigger.click();
    await page.getByTestId(`project-filter-dropdown-item-${b.projectId}`).click();
    await expect(trigger).toContainText(b.name);

    const boardPick = await page.evaluate(() => localStorage.getItem("webui.activeProjectId"));
    expect(boardPick).toBe(a.projectId);
  });
});

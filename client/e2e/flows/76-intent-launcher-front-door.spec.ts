/*
 * Intent launcher — the guided Intent Wizard is the front door of every create
 * surface (iterate-2026-07-23-intent-launcher-front-door, FR-01.51). Real-browser
 * smoke: the click→navigate wiring the unit tests exercise in jsdom, proven end to
 * end in a running stack. Data-light — the Guided + register-manually rows are
 * project-independent, so a single seeded project is enough.
 */
import {
  cleanupProject,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { test, expect } from "@playwright/test";

test.describe("Intent launcher — guided wizard front door", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "76-intent-launcher" });
    await setActiveProject(page, project.projectId);
  });
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("Board single-project New menu → Guided opens the wizard", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("create-menu-caret").click();
    await page.getByTestId("create-menu-guided").click();
    await expect(page).toHaveURL(/\/wizard$/);
    await expect(page.getByTestId("intent-wizard")).toBeVisible();
  });

  test("Board New menu → Register manually deep-links to the registration dialog", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("create-menu-caret").click();
    await page.getByTestId("create-menu-register-manually").click();
    await expect(page).toHaveURL(/\/projects\?new=1$/);
    await expect(page.getByTestId("wizard-modal")).toBeVisible();
  });

  test('Projects "Create Project" is the guided front door', async ({ page }) => {
    await page.goto("/projects");
    await page.getByTestId("projects-create-button").click();
    await expect(page).toHaveURL(/\/wizard$/);
    await expect(page.getByTestId("intent-wizard")).toBeVisible();
  });

  test("the wizard DoorPicker carries the permanent register-manually escape hatch", async ({ page }) => {
    await page.goto("/wizard");
    const line = page.getByTestId("wizard-add-existing");
    await expect(line).toBeVisible();
    await expect(line).toHaveText(/Register a project manually/);
    await line.click();
    await expect(page).toHaveURL(/\/projects\?new=1$/);
    await expect(page.getByTestId("wizard-modal")).toBeVisible();
  });

  test("Ship's Log header launcher → Guided opens the wizard", async ({ page }) => {
    await page.goto(`/projects/${project.projectId}/log`);
    await page.getByTestId("shipslog-create-trigger").click();
    await page.getByTestId("create-menu-guided").click();
    await expect(page).toHaveURL(/\/wizard$/);
  });
});

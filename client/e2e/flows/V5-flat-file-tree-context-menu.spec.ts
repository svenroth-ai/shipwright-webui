/*
 * V5 — flat file tree + row context menu (campaign mission-desktop-style-v2).
 * Real browser + real server: flat tree in the Mission Folders segment, 15px /
 * 28px rows, right-click menu (Open in Viewer / Copy Path / Copy Relative Path,
 * no shortcut hints), clipboard contents, click-to-open, Esc, touch "..." sheet.
 * @covers FR-01.66
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

const side = (page: import("@playwright/test").Page) => page.getByTestId("mission-side-body-folders");

test.describe("V5 — flat file tree + context menu", () => {
  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    project = await seedProject(request, {
      name: "Tree",
      dirName: "sw-v5-tree",
      files: { "client/package.json": "{}\n", "README.md": "# hi\n" },
    });
    taskId = (await seedTask(request, { title: "Tree", projectId: project.projectId })).taskId;
    await setActiveProject(page, project.projectId);
    await page.route("**/api/external/tasks/*/session-info", (route) =>
      route.fulfill({ json: { status: "missing" } }),
    );
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  async function openFolders(page: import("@playwright/test").Page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await page.getByTestId("mission-side-seg-folders").click();
    await expect(page.getByTestId("mission-side-body-folders").getByTestId("folder-tree")).toBeVisible();
  }

  // @covers FR-01.66
  test("flat tree, 28px rows, right-click menu copies paths", async ({ page }) => {
    await openFolders(page);
    const tree = page.getByTestId("mission-side-body-folders").getByTestId("folder-tree");
    await expect(tree).not.toHaveClass(/ft-card/);
    await expect(tree.getByTestId("folder-tree-header")).toContainText("Files");

    const readme = side(page).getByTestId("folder-tree-row-README.md");
    const box = (await readme.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(28);
    expect(await readme.evaluate((el) => getComputedStyle(el).fontSize)).toBe("15px");

    await side(page).getByTestId("folder-tree-row-client").click();
    const pkg = side(page).getByTestId("folder-tree-row-client/package.json");
    await expect(pkg).toBeVisible();

    await pkg.click({ button: "right" });
    const menu = page.getByTestId("folder-tree-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText(["Open in Viewer", "Copy Path", "Copy Relative Path"]);
    await expect(menu).not.toContainText(/Ctrl|Cmd|⌘/);

    await menu.getByText("Copy Relative Path").click();
    await expect(side(page).getByTestId("folder-tree-toast")).toHaveText("Path copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("client/package.json");

    await pkg.click({ button: "right" });
    await page.getByTestId("folder-tree-menu").getByText("Copy Path", { exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/sw-v5-tree[\\/]client[\\/]package\.json$/);

    // Esc closes the menu.
    await pkg.click({ button: "right" });
    await expect(page.getByTestId("folder-tree-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("folder-tree-menu")).toHaveCount(0);

    // Esc returns focus to the row; a second right-click keeps its own menu open.
    await pkg.click({ button: "right" });
    await page.keyboard.press("Escape");
    await expect(pkg).toBeFocused();
    await pkg.click({ button: "right" });
    await side(page).getByTestId("folder-tree-row-client").click({ button: "right" });
    await expect(page.getByTestId("folder-tree-menu")).toBeVisible();
    await page.keyboard.press("Escape");

    // Click on a file opens it directly in the Viewer segment.
    await pkg.click();
    await expect(page.getByTestId("mission-side-body-viewer")).toBeVisible();
  });

  // @covers FR-01.66
  test("touch: ... button opens a bottom sheet with 48px items", async ({ page }) => {
    await openFolders(page);
    await side(page).getByTestId("folder-tree-more-README.md").evaluate((el) => {
      // A touch-originated click (pointerType "touch") on the row-actions button.
      el.dispatchEvent(new PointerEvent("click", { bubbles: true, pointerType: "touch" }));
    });
    const sheet = page.getByTestId("folder-tree-sheet");
    await expect(sheet).toBeVisible();
    const items = sheet.locator(".ft-sheet-item");
    await expect(items).toHaveText(["Open in Viewer", "Copy Path", "Copy Relative Path"]);
    expect((await items.first().boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });
});

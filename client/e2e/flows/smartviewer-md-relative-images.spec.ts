/*
 * Spec — smartviewer-md-relative-images
 * (iterate-2026-11-18-smartviewer-md-relative-images, FR-01.02).
 *
 * A markdown file rendered in the SmartViewer that embeds an image from its
 * own folder (`![](diagram.svg)`, `![](pic.png)`) must actually show the image,
 * not the browser's broken placeholder. Real files on disk, real file route.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { test, expect } from "@playwright/test";

import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";

const DIR = ".shipwright/planning/01-adopted";
const DOC = `${DIR}/spec.md`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#4f46e5"/></svg>';
// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// @covers FR-01.02
test.describe("SmartViewer markdown — relative images", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, {
      name: `md-images-${Date.now()}`,
      files: {
        [DOC]: "# Images\n\n![vector](diagram.svg)\n\n![raster](pic.png)\n",
        [`${DIR}/diagram.svg`]: SVG,
      },
    });
    await writeFile(path.join(project.path, DIR, "pic.png"), PNG);
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  // @covers FR-01.02
  test("sibling svg and png render as real images", async ({ page }) => {
    await page.goto(`/projects/${project.projectId}/log`);
    await page.getByTestId(`shipslog-doc-${DOC}`).click();
    const md = page.getByTestId("smart-viewer-markdown");
    await expect(md).toContainText("Images", { timeout: 15_000 });

    for (const alt of ["vector", "raster"]) {
      const img = md.getByRole("img", { name: alt });
      await expect(img).toBeVisible();
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
        .toBe(true);
    }
  });
});

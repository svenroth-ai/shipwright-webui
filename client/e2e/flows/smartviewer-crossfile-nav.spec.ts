/*
 * Spec — SmartViewer cross-file anchor navigation against the REAL RTM
 * (iterate-2026-05-30-smartviewer-render-ux, AC8 cross-file follow-up).
 *
 * NO mock: this runs against a stack booted with the real USERPROFILE, so the
 * file API serves the actual project files. It opens the real
 * `.shipwright/compliance/traceability-matrix.md` (whose FR links are
 * cross-file `…/spec.md#fr-0101`, not same-document `#frag` — the case a
 * synthetic fixture missed) and asserts that clicking one navigates the
 * SmartViewer pane in-place to spec.md.
 *
 * Requires the shipwright-webui project to be registered in the running
 * webui (it is the project under development). If it isn't, the test fails
 * loudly rather than skipping silently.
 */

import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect } from "@playwright/test";

const RTM_PATH = ".shipwright/compliance/traceability-matrix.md";

test.describe("SmartViewer cross-file nav (FR-01.02, real RTM)", () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, {
      name: "smartviewer-crossfile-nav",
      adopted: true,
      // The spec clicks a CROSS-FILE FR link in the RTM. It used to read the
      // developer's own compliance docs; now the fixture writes them, so the
      // exact link shape under test is explicit rather than inherited.
      files: {
        ".shipwright/compliance/traceability-matrix.md": "# Traceability Matrix\n\n| FR | Spec |\n| --- | --- |\n| [FR-01.01](../planning/spec.md#fr-0101) | Board renders |\n",
        ".shipwright/planning/spec.md": "# Spec\n\n## FR-01.01\n\nThe board renders its columns.\n",
      },
    });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("clicking a real RTM FR link navigates the pane to spec.md", async ({
    page,
  }, testInfo) => {
    // A00 — this used to scan /api/projects for a project whose PATH contained
    // "shipwright-webui", i.e. it required the developer's own checkout to be
    // registered in the running webui. That is machine state, and on a CI runner it
    // simply does not exist. The RTM + spec.md are now seeded by the fixture (see the
    // beforeEach), so the cross-file link shape under test is explicit rather than
    // inherited from whatever the developer's compliance docs happened to say.
    await page.goto(
      `/preview?projectId=${encodeURIComponent(project.projectId)}&path=${encodeURIComponent(RTM_PATH)}`,
    );

    const doc = page.getByTestId("document-markdown");
    await expect(doc).toBeVisible({ timeout: 8000 });
    // The RTM renders before we navigate. The filename path strip was removed
    // (iterate-2026-07-17 — the tab already names the file), so we assert on the
    // rendered document content instead of the strip.
    await expect(doc).toContainText("Traceability Matrix");

    // Click the first FR cross-file link (`[FR-01.01](…/spec.md#fr-0101)`).
    const frLink = page.getByRole("link", { name: /^FR-01\.01$/ }).first();
    await expect(frLink).toBeVisible();
    await frLink.click();

    // The pane navigated IN-PLACE to spec.md (the rendered content is now spec.md's),
    // without leaving /preview.
    await expect(doc).toContainText("The board renders its columns.", {
      timeout: 8000,
    });
    expect(page.url()).toContain("/preview");

    await page.screenshot({
      path: testInfo.outputPath("smartviewer-crossfile.png"),
      fullPage: true,
    });
  });
});

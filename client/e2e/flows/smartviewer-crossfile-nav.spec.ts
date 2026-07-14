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
    project = await seedProject(request, { name: "smartviewer-crossfile-nav", adopted: true });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("clicking a real RTM FR link navigates the pane to spec.md", async ({
    page,
    request,
  }, testInfo) => {
    const res = await request.get("/api/projects");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      data: Array<{ id: string; name: string; path: string }>;
    };
    const proj = body.data.find(
      (p) => /shipwright-webui/i.test(p.path ?? "") || /shipwright-webui/i.test(p.name ?? ""),
    );
    expect(
      proj,
      "shipwright-webui project must be registered in the running webui",
    ).toBeTruthy();

    await page.goto(
      `/preview?projectId=${encodeURIComponent(proj!.id)}&path=${encodeURIComponent(RTM_PATH)}`,
    );

    const doc = page.getByTestId("document-markdown");
    await expect(doc).toBeVisible({ timeout: 8000 });
    // The RTM renders before we navigate.
    await expect(page.getByTestId("smart-viewer-path-strip")).toContainText(
      "traceability-matrix.md",
    );

    // Click the first FR cross-file link (`[FR-01.01](…/spec.md#fr-0101)`).
    const frLink = page.getByRole("link", { name: /^FR-01\.01$/ }).first();
    await expect(frLink).toBeVisible();
    await frLink.click();

    // The pane navigated IN-PLACE to spec.md (PathStrip reflects the override),
    // without leaving /preview.
    await expect(page.getByTestId("smart-viewer-path-strip")).toContainText("spec.md", {
      timeout: 8000,
    });
    expect(page.url()).toContain("/preview");

    await page.screenshot({
      path: testInfo.outputPath("smartviewer-crossfile.png"),
      fullPage: true,
    });
  });
});

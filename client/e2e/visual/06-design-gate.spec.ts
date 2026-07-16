/*
 * Visual baseline — the design gate AS the Mission view (A14, FR-01.58; A00 AC4).
 *
 * Flips A00's `design-gate` route out of the `pending` manifest into `baselined`
 * (client/e2e/visual/routes.ts, same PR). The gate renders in A13's three-card
 * Mission shell: the Record rail (Design node `now`), the gallery of pending
 * screens in the middle `.mc-op` card, and the Approve / Request-changes decision
 * bar at its foot.
 *
 * DETERMINISTIC: the design-gate signal, the manifest, and each hosted screen are
 * INTERCEPTED with fixed content so the screenshot is stable (no on-disk gate, no
 * live Claude). The seeded task stays `draft` (non-terminal) so the gate poll is
 * enabled; the intercepted `active:true` puts Mission into `designgate` mode.
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
import { apiUrl } from "../helpers/env";
import { freezeClock, nonDeterministicRegions, settle } from "./stabilize";

const MANIFEST = [
  "# Design Manifest", "", "## Screens", "",
  "| # | Screen | File | Status | Linked FRs |",
  "|---|--------|------|--------|-----------|",
  "| 01 | dashboard | screens/01-dashboard.html | complete | FR-01.09 |",
  "| 02 | settings | screens/02-settings.html | complete | FR-01.10 |",
  "| 03 | booking | screens/03-booking.html | complete | FR-01.11 |",
  "",
].join("\n");

function screenHtml(title: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{margin:0;font-family:system-ui,sans-serif;background:#fff;color:#1c1917}
  header{background:#0E7A6B;color:#fff;padding:22px 26px;font-size:26px;font-weight:700}
  .row{padding:18px 26px;border-bottom:1px solid #e7e5e4;font-size:18px}</style></head>
  <body><header>${title}</header><div class="row">Section one</div>
  <div class="row">Section two</div><div class="row">Section three</div></body></html>`;
}

test.describe("visual: design gate", () => {
  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-visual-gate" });
    const task = await seedTask(request, { title: "Approve the mockups", projectId: project.projectId });
    taskId = task.taskId;

    const created = await request
      .get(apiUrl(`/api/external/tasks/${taskId}`))
      .then((r) => r.json() as Promise<{ task: { createdAt: string } }>);
    await freezeClock(page, created.task.createdAt);
    await setActiveProject(page, project.projectId);

    // Deterministic gate signal + screens (no on-disk gate, no live Claude).
    await page.route((u) => u.pathname.endsWith("/design-gate"), (route) =>
      route.fulfill({ json: { active: true, phaseTaskId: "ptk-bbbb", phase: "design" } }),
    );
    await page.route((u) => u.pathname.endsWith("/file") && u.search.includes("design-manifest.md"), (route) =>
      route.fulfill({ contentType: "text/markdown; charset=utf-8", body: MANIFEST }),
    );
    await page.route((u) => /\/designs\/screens\/.+\.html$/.test(u.pathname), (route) => {
      const name = decodeURIComponent(route.request().url().split("/").pop() ?? "").replace(/^\d+-|\.html$/g, "");
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: screenHtml(name || "screen") });
    });
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  test("design-gate", async ({ page }) => {
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    await expect(page.getByTestId("design-gate-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("record-rail")).toBeVisible();
    await expect(page.getByTestId("design-gate-grid")).toBeVisible();
    await expect(page.getByTestId("design-gate-screen")).toHaveCount(3);
    await expect(page.getByTestId("design-gate-approve")).toBeVisible();
    // Let the sandboxed screen iframes paint before the capture.
    await settle(page);
    await page.waitForTimeout(400);

    await expect(page).toHaveScreenshot("design-gate.png", {
      fullPage: true,
      mask: nonDeterministicRegions(page),
    });
  });
});

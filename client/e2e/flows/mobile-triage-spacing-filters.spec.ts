/*
 * Spec — mobile-triage-form-layout (iterate-2026-09-12-mobile-triage-form-layout),
 * AC2-AC4 half: the Triage detail panel, card/section spacing, and
 * filter/sort bar collapse, all on phone viewports.
 *
 * Bug report (translated): on phone viewports the task-creation form's
 * Launch button is pushed almost entirely off-screen (AC1, in
 * mobile-triage-form-layout.spec.ts — split out purely to stay under the
 * 300-line file limit, no behavioral change); the Triage detail panel's
 * action row overflows past the left edge ("Fix now" barely clickable,
 * AC2 below); the Triage card list needs excessive scrolling due to
 * accumulated section spacing (AC3 below); and the filter/sort bar cannot
 * be collapsed to save space (AC4 below).
 *
 * WHY THIS IS AN E2E AND NOT ONLY A UNIT TEST: jsdom has no layout engine,
 * so it cannot measure real bounding boxes, real flex-height allocation, or
 * a real `max-md:` media-query breakpoint taking effect. The unit-level
 * class-fence tests in TriageDetailModal.test.tsx / PerProjectTriageSection.test.tsx /
 * DeferredTriageSection.test.tsx / TriageFilterSortBar.test.tsx pin the
 * classes exist; this spec is what proves the actual rendered geometry.
 */

import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  cleanupProject,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

const PHONE_VIEWPORT = { width: 375, height: 667 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

function triageLine(fields: Record<string, unknown>): string {
  return JSON.stringify({
    ts: "2026-09-12T08:00:00Z",
    originalTs: "2026-09-12T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    detail: "Detail body",
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: null,
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
    statusBy: null,
    statusReason: null,
    promotedTaskId: null,
    revisitAt: null,
    revisitDue: false,
    amendedBy: null,
    amendedAt: null,
    ...fields,
  });
}

function writeTriageItems(projectPath: string, items: Record<string, unknown>[]): void {
  const dir = path.join(projectPath, ".shipwright");
  mkdirSync(dir, { recursive: true });
  const header = JSON.stringify({ v: 1, schema: "triage", created: "2026-09-12T08:00:00Z" });
  writeFileSync(
    path.join(dir, "triage.jsonl"),
    [header, ...items.map((it) => triageLine({ event: "append", ...it }))].join("\n") + "\n",
    "utf-8",
  );
}

test.describe("Mobile Triage / detail panel & spacing", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: `mobile-triage-layout-${Date.now()}` });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  // --- AC2 — Triage detail panel action row --------------------------------
  test.describe("AC2 — Triage detail action buttons", () => {
    test.beforeEach(async () => {
      writeTriageItems(project.path, [
        { id: "trg-mtfl0001", title: "Action row overflow repro", dedupKey: "e2e:mtfl:1" },
      ]);
    });

    test("all four action buttons are fully within the dialog/viewport at 375px", async ({ page }) => {
      await page.setViewportSize(PHONE_VIEWPORT);
      await page.goto("/triage");
      const card = page.getByTestId("triage-item-trg-mtfl0001");
      await expect(card).toBeVisible({ timeout: 35_000 });
      await card.click();

      const dialog = page.getByTestId("triage-detail-modal");
      await expect(dialog).toBeVisible();
      const dialogBox = await dialog.boundingBox();
      expect(dialogBox).not.toBeNull();

      for (const testId of ["triage-fix-now", "triage-dismiss", "triage-snooze", "triage-promote"]) {
        const btn = page.getByTestId(testId);
        // The dialog body is independently vertically scrollable
        // (overflow-y-auto) and was never part of this bug report — only
        // horizontal clipping was. Scroll each button into view before
        // measuring, same as AC1's "More options expanded" reachability
        // check, rather than asserting all four sit on-screen at once.
        await btn.scrollIntoViewIfNeeded();
        await expect(btn).toBeVisible();
        const box = await btn.boundingBox();
        expect(box, `${testId} must have a bounding box`).not.toBeNull();
        // Fully inside the dialog's own box — the original bug clipped
        // "Fix now" past the dialog's LEFT edge (negative offset relative
        // to the dialog), not just the page viewport.
        expect(box!.x, `${testId} left edge must be inside the dialog`).toBeGreaterThanOrEqual(dialogBox!.x - 1);
        expect(
          box!.x + box!.width,
          `${testId} right edge must be inside the dialog`,
        ).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);
        // And inside the actual page viewport (both edges — external
        // code-review finding: the dialog-relative check alone would still
        // pass if the whole dialog were shifted past the right edge).
        expect(box!.x, `${testId} left edge must be within the page viewport`).toBeGreaterThanOrEqual(0);
        expect(
          box!.x + box!.width,
          `${testId} right edge must be within the page viewport`,
        ).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
        await expect(btn).toBeInViewport();
        // AC2 says each button must be CLICKABLE, not merely visible —
        // `{ trial: true }` runs Playwright's actionability pipeline
        // (visible, stable, receives pointer events, not obscured) without
        // dispatching the click (PR-review preflight finding).
        await btn.click({ trial: true });
      }
    });
  });

  // --- AC3 — Triage card/section spacing on phone --------------------------
  test.describe("AC3 — Triage section spacing", () => {
    test.beforeEach(async () => {
      writeTriageItems(project.path, [
        { id: "trg-mtfl0010", title: "Item one", dedupKey: "e2e:mtfl:10" },
        { id: "trg-mtfl0011", title: "Item two", dedupKey: "e2e:mtfl:11" },
        { id: "trg-mtfl0012", title: "Item three", dedupKey: "e2e:mtfl:12" },
      ]);
    });

    test("phone (<768px): section/heading/list margins resolve to the tightened max-md values", async ({ page }) => {
      await page.setViewportSize(PHONE_VIEWPORT);
      await page.goto("/triage");
      const section = page.getByTestId(`triage-project-${project.projectId}`);
      const openItems = page.getByTestId(`triage-open-items-${project.projectId}`);
      // Wait for the OPEN-ITEMS list, not just the section shell — the
      // section's own isLoading branch renders the same data-testid with a
      // bare "mb-8" (no max-md:mb-4), so asserting on the section alone can
      // race a transient loading skeleton and read the wrong className.
      await expect(openItems).toBeVisible({ timeout: 35_000 });

      const marginBottom = await section.evaluate((el) => parseFloat(getComputedStyle(el).marginBottom));
      // mb-8 max-md:mb-4 → 16px at <768px (not 32px, the desktop value).
      expect(marginBottom).toBeCloseTo(16, 0);

      const openItemsMargin = await openItems.evaluate((el) => parseFloat(getComputedStyle(el).marginBottom));
      // mb-4 max-md:mb-2 → 8px at <768px.
      expect(openItemsMargin).toBeCloseTo(8, 0);

      // External code-review finding (medium): AC3 is about reducing
      // *scrolling*, so the card-to-card gap itself (not just the section
      // boundaries) must also tighten. space-y-2 max-md:space-y-1 → 4px
      // between adjacent cards at <768px (real geometry, not the class
      // fence — measured via the second card's top-edge minus the first
      // card's bottom-edge).
      // The default sort (modified desc, then name asc) orders these three
      // fixture items alphabetically by title ("Item one" < "Item three" <
      // "Item two"), not by id — so take the list's direct-child buttons in
      // actual DOM order rather than assuming an id-based order.
      const openItemButtons = openItems.locator("> button");
      const firstBox = await openItemButtons.nth(0).boundingBox();
      const secondBox = await openItemButtons.nth(1).boundingBox();
      expect(firstBox).not.toBeNull();
      expect(secondBox).not.toBeNull();
      expect(secondBox!.y - (firstBox!.y + firstBox!.height)).toBeCloseTo(4, 0);
    });

    test("desktop (>=768px): section margin stays at the original 32px value", async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto("/triage");
      const section = page.getByTestId(`triage-project-${project.projectId}`);
      await expect(page.getByTestId(`triage-open-items-${project.projectId}`)).toBeVisible({ timeout: 35_000 });
      const marginBottom = await section.evaluate((el) => parseFloat(getComputedStyle(el).marginBottom));
      expect(marginBottom).toBeCloseTo(32, 0);
    });
  });

  // --- AC4 — Filter/sort bar collapse on phone -----------------------------
  test.describe("AC4 — Filter bar collapse", () => {
    test("phone (<768px): collapsed on first paint, expands on tap", async ({ page }) => {
      await page.setViewportSize(PHONE_VIEWPORT);
      await page.goto("/triage");
      const bar = page.getByTestId("triage-filter-sort-bar");
      await expect(bar).toBeVisible();

      const toggle = page.getByTestId("triage-filter-sort-toggle");
      await expect(toggle).toBeVisible();
      // No flash-of-expanded-content: collapsed on the FIRST paint.
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByTestId("triage-filter-priority-group")).not.toBeVisible();

      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByTestId("triage-filter-priority-group")).toBeVisible();
    });

    test("desktop (>=768px): no toggle, filters always visible", async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto("/triage");
      await expect(page.getByTestId("triage-filter-sort-bar")).toBeVisible();
      await expect(page.getByTestId("triage-filter-sort-toggle")).toHaveCount(0);
      await expect(page.getByTestId("triage-filter-priority-group")).toBeVisible();
    });
  });
});

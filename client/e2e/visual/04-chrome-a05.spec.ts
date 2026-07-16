/*
 * A05 chrome — functional gate for the uniform anthracite frame (NOT a
 * screenshot; the pixel proof is the regenerated baselines). jsdom is blind to
 * layout + computed colour, so these live in the visual project (real Chromium,
 * pinned container, 1280×800):
 *
 *   AC1  every page's title bar is a 92px box, and the bar-inner left edge sits
 *        on the SAME 32px gutter as the body content.
 *   AC2  sidebar + title bars compute to #23262c; the active nav item shows the
 *        teal rail; the "COMMAND" brand-tag is absent; the real logo renders.
 *   AC4  ZERO fonts.googleapis/gstatic requests on load; --mono / --font-mono
 *        resolve to Geist Mono inside the container.
 *
 * Mutation drill (AC1 "prove it bites"): set one PageHead's height to h-16 →
 * the `=== 92` assertion goes RED → revert. Recorded in the iterate ADR.
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
import { settle } from "./stabilize";

const TAUPE = "rgb(35, 38, 44)"; // #23262C — the anthracite ground

/** Pages that render <PageHead> (Mission's `.mc-top` is asserted separately). */
const PAGEHEAD_ROUTES = [
  { id: "board", path: "/", header: "task-board-header", ready: "task-board-page" },
  { id: "projects", path: "/projects", header: "projects-header", ready: "projects-page" },
  { id: "inbox", path: "/inbox", header: "inbox-header", ready: "inbox-page" },
  { id: "triage", path: "/triage", header: "triage-header", ready: "triage-page" },
  { id: "settings", path: "/settings", header: "settings-header", ready: "settings-page" },
  { id: "diagnostics", path: "/diagnostics", header: "diagnostics-header", ready: "diagnostics-page" },
] as const;

test.describe("A05 chrome: geometry + anthracite + fonts", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-visual-atlas" });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  // ── AC1: 92px bar + 32px gutter equality, uniform across every page ──
  for (const route of PAGEHEAD_ROUTES) {
    test(`AC1 ${route.id}: 92px title bar on the shared 32px gutter`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.getByTestId(route.ready)).toBeVisible({ timeout: 15_000 });
      await settle(page);

      const bar = page.getByTestId(route.header);
      const barBox = await bar.boundingBox();
      expect(barBox, `${route.id} PageHead must render`).not.toBeNull();
      // 92px BY CONSTRUCTION (`.page-head { min-height: 92px }`).
      expect(Math.round(barBox!.height)).toBe(92);

      // Gutter equality: the bar's inner box and the first body `.page-container`
      // share the same left edge (both 1360/32 — or board 1600/32). ±1px slack
      // for sub-pixel rounding only.
      const innerX = await bar.locator(".inner").evaluate((el) => el.getBoundingClientRect().x);
      const bodyX = await page
        .locator(".page-container")
        .first()
        .evaluate((el) => el.getBoundingClientRect().x);
      expect(Math.abs(innerX - bodyX)).toBeLessThanOrEqual(1);
    });
  }

  // ── AC2: anthracite chrome ──
  test("AC2: sidebar + title bar compute to #23262c, active rail, logo, no brand-tag", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible({ timeout: 15_000 });
    await settle(page);

    const barBg = await page
      .getByTestId("settings-header")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(barBg).toBe(TAUPE);

    const sidebarBg = await page
      .getByTestId("sidebar-inline")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(sidebarBg).toBe(TAUPE);

    // Active nav item (react-router NavLink → aria-current="page") has the 3px
    // teal `::before` rail.
    const rail = await page
      .locator('a[aria-current="page"]')
      .first()
      .evaluate((el) => {
        const b = getComputedStyle(el, "::before");
        return { width: b.width, bg: b.backgroundColor };
      });
    expect(rail.width).toBe("3px");
    expect(rail.bg).toBe("rgb(65, 201, 176)"); // #41c9b0

    // Real logo present at 25px AND actually decoded (naturalWidth>0 proves the
    // PNG resolved, not just that an <img> exists); no "COMMAND" brand-tag.
    const logo = page.getByTestId("sidebar-brand-logo");
    await expect(logo).toBeVisible();
    const logoDims = await logo.evaluate((el) => {
      const img = el as HTMLImageElement;
      return { h: Math.round(img.getBoundingClientRect().height), nat: img.naturalWidth };
    });
    expect(logoDims.h).toBe(25);
    expect(logoDims.nat, "logo PNG must actually decode (not 404)").toBeGreaterThan(0);
    await expect(page.getByTestId("brand-tag")).toHaveCount(0);
  });

  test("AC2: Mission Control `.mc-top` is anthracite too", async ({ page, request }) => {
    // A task detail page renders TaskDetailHeader (.mc-top). Seed one, open it.
    const task = await seedTask(request, {
      title: "Rig the mainsail",
      projectId: project.projectId,
    });
    await page.goto(`/tasks/${task.taskId}`);
    const header = page.getByTestId("task-detail-header");
    await expect(header).toBeVisible({ timeout: 15_000 });
    await settle(page);
    const geom = await header.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, left: s.paddingLeft, right: s.paddingRight };
    });
    expect(geom.bg).toBe(TAUPE);
    // Desktop (1280) asymmetric padding — left 22 (back-arrow glyph gutter), right
    // 28. AC1: .mc-top asserted at its OWN spec'd geometry, not <PageHead>'s 92px.
    expect(geom.left).toBe("22px");
    expect(geom.right).toBe("28px");
    await cleanupTask(request, task.taskId);
  });

  // ── AC4: fonts self-hosted + container-stable ──
  test("AC4: zero CDN font requests; --mono / --font-mono resolve to Geist Mono", async ({
    page,
  }) => {
    const cdnFontRequests: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (/fonts\.(googleapis|gstatic)\.com/.test(u)) cdnFontRequests.push(u);
    });

    await page.goto("/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible({ timeout: 15_000 });
    await settle(page);
    expect(cdnFontRequests, cdnFontRequests.join("\n")).toEqual([]);

    // The faces must ACTUALLY load in the container, not merely resolve in the CSS
    // cascade — getComputedStyle returns the requested family even when the woff2
    // 404s. document.fonts.check proves the glyphs are available.
    const faces = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        mono: document.fonts.check('400 14px "Geist Mono Variable"'),
        sans: document.fonts.check('400 14px "Inter Variable"'),
      };
    });
    expect(faces.mono, "Geist Mono Variable must actually load in the container").toBe(true);
    expect(faces.sans, "Inter Variable must actually load in the container").toBe(true);

    // Both the data token (--mono) and the previously-orphan --font-mono resolve
    // to the self-hosted Geist Mono face inside the container.
    const fams = await page.evaluate(() => {
      function fam(value: string): string {
        const el = document.createElement("span");
        el.style.fontFamily = value;
        el.textContent = "x";
        document.body.appendChild(el);
        const f = getComputedStyle(el).fontFamily;
        el.remove();
        return f;
      }
      return { mono: fam("var(--mono)"), fontMono: fam("var(--font-mono)"), sans: fam("var(--sans)") };
    });
    expect(fams.mono).toContain("Geist Mono");
    expect(fams.fontMono).toContain("Geist Mono");
    expect(fams.sans).toContain("Inter");
  });
});

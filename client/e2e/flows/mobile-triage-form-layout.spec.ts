/*
 * Spec — mobile-triage-form-layout (iterate-2026-09-12-mobile-triage-form-layout),
 * AC1 half: the task-creation form's Launch button on phone viewports.
 *
 * Split out of this same file (AC2-AC4, the Triage-side ACs, moved to
 * mobile-triage-spacing-filters.spec.ts) purely to stay under the 300-line
 * file limit — no behavioral change. See that file's header for the shared
 * bug-report context and the "why E2E, not just unit" rationale, which
 * applies equally here.
 *
 * Runs under the default desktop `chromium` project with an explicit
 * `setViewportSize` (375×667) — same pattern as
 * triage-fix-now-more-options-clip.spec.ts — rather than the dedicated
 * `mobile-chromium` project, since this AC is about layout/overflow at a
 * narrow width, not about touch/coarse-pointer behavior specifically.
 */

import { test, expect } from "@playwright/test";

import {
  cleanupProject,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

const PHONE_VIEWPORT = { width: 375, height: 667 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

test.describe("Mobile Triage / task-form layout", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: `mobile-triage-layout-${Date.now()}` });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  // --- AC1 — task-creation form: Launch button stays on-screen ------------
  //
  // Code-review finding (high): headless Chromium with a fixed
  // `setViewportSize` has NO distinction between `100vh` and `100dvh` — both
  // resolve to the exact viewport height, since there is no real browser
  // chrome (URL bar) to hide/show. The reported bug's actual mechanism is
  // that on a real mobile browser `100vh` is the LARGE viewport while a
  // fixed-position box's containing block is the SMALL (chrome-visible) one,
  // so a `calc(100vh-Npx)` budget sizes ~50-100px too tall. That specific
  // mechanism is structurally unreproducible in this harness — verified
  // empirically: reverting ModalShell.tsx's fix locally and re-running these
  // two cases left them GREEN, proving they do not (and cannot) falsify that
  // one failure mode. What they DO prove, and are non-vacuous for: the body
  // actually overflows (asserted below via scrollHeight > clientHeight, so
  // an empty/short form can't pass by having nothing to clip), and the
  // fixed flex-column structure keeps Launch on-screen regardless of WHERE
  // the overflow comes from — a real regression in the flex chain (the
  // `min-h-0`/`flex-1`/`max-h-full` links covered by
  // ModalShell.layout.test.tsx) would still turn these red, just not the
  // one historical vh-vs-dvh mechanism. The dvh-vs-vh mechanism itself
  // requires a real mobile browser or device-emulation with actual
  // dynamic-toolbar behavior, which Playwright does not model — recorded as
  // a manual-verification gap in the iterate spec's Confidence Calibration
  // rather than silently claimed as covered.
  //
  // External code-review finding (medium): AC1's literal wording is "at
  // 375×667, filling enough fields that the form body scrolls" — the two
  // cases below don't fill any fields, only expand More Options. Tried:
  // (1) typing a long value into `new-issue-description-input` — its
  // textarea is `resize-y` (user-draggable), not auto-growing, so content
  // length alone never changes its box height; (2) the seeded fixture's
  // minimal/unregistered action catalog renders only a handful of advanced
  // fields even fully expanded. Measured empirically: at literal 375×667,
  // `scrollHeight === clientHeight` for BOTH the plain form and the
  // More-Options-expanded form — there is no field-filling recipe that
  // produces genuine overflow at that exact viewport height with this
  // fixture. The AC's literal precondition is therefore unreachable here,
  // not merely untested; case 3 below (a deliberately shorter 375×480
  // viewport) is the closest non-vacuous substitute this harness can
  // produce, and is what actually caught the real flex-allocation bug.
  // Disclosed rather than silently left unaddressed.
  test.describe("AC1 — task form Launch button", () => {
    // `hasTouch`/`isMobile` (not the full Pixel 5 preset — its
    // `defaultBrowserType` field cannot be set at describe scope, only
    // top-level or in playwright.config.ts) so `pointer: coarse` resolves
    // true and the footer's `pointer-coarse:min-h-[44px]` buttons wrap the
    // way the mini-plan's rejected alternative (raise the magic number) was
    // specifically weighed against (code-review finding, medium) — the
    // two-line footer is the tallest-body case this fix exists for.
    test.use({ hasTouch: true, isMobile: true });

    test("plain New Task form: Launch button is fully within the phone viewport", async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto("/");
      await page.getByTestId("create-menu-primary").click();
      const modal = page.getByTestId("new-issue-modal-new-task");
      await expect(modal).toBeVisible();

      // Now shrink to phone width — the same mounted dialog, CSS media
      // queries react to the current viewport regardless of how it opened.
      await page.setViewportSize(PHONE_VIEWPORT);

      const launchBtn = page.getByTestId("new-issue-launch-btn");
      await expect(launchBtn).toBeVisible();
      const box = await launchBtn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height, "Launch button bottom edge must be within the viewport").toBeLessThanOrEqual(
        PHONE_VIEWPORT.height,
      );
      expect(box!.y, "Launch button top edge must be within the viewport").toBeGreaterThanOrEqual(0);
    });

    test("New Task form with More options expanded (the historically fragile path): Launch button stays visible", async ({
      page,
    }) => {
      // Internal Plan Review finding #5 — MoreOptionsDisclosure is the exact
      // nested overflow-hidden fragment that broke once before
      // (iterate-2026-07-14-more-options-flex-clip). Prove the restructure
      // doesn't regress it, at phone width, where the body is tallest.
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto("/");
      await page.getByTestId("create-menu-primary").click();
      await expect(page.getByTestId("new-issue-modal-new-task")).toBeVisible();
      // Launch is disabled until a title is entered (useNewIssueFormDerived's
      // canSubmit requires title.trim().length > 0) — fill one in so the
      // trial-click below exercises a genuinely enabled button, the same
      // precondition a real user hits before Launch is clickable at all.
      await page.getByTestId("new-issue-title-input").fill("Mobile layout repro task");
      await page.getByTestId("new-issue-more-options-toggle").click();
      await expect(page.getByTestId("new-issue-more-options-content")).toBeVisible();

      await page.setViewportSize(PHONE_VIEWPORT);

      const launchBtn = page.getByTestId("new-issue-launch-btn");
      await expect(launchBtn).toBeVisible();
      const box = await launchBtn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(PHONE_VIEWPORT.height);

      // Launch is actually clickable, not just geometrically present —
      // `{ trial: true }` runs Playwright's full actionability pipeline
      // (visible, stable, receives pointer events, not obscured by another
      // element) without dispatching the click or submitting the form
      // (PR-review preflight finding: the prior version only checked
      // visibility/viewport containment, never attempted a click).
      await launchBtn.scrollIntoViewIfNeeded();
      await expect(launchBtn).toBeInViewport();
      await launchBtn.click({ trial: true });
    });

    // Code-review finding (high, follow-up): at the literal 375×667 viewport
    // neither case above actually overflows the form body in headless
    // Chromium — measured empirically (scrollHeight === clientHeight for
    // both), so they cannot exercise the flex-allocation chain at all, let
    // alone falsify a regression in it. This case forces genuine overflow
    // with a deliberately shorter viewport (same 375 width — only height
    // differs from the AC's stated 375×667) so the assertion below is
    // non-vacuous: it fails if `min-h-0`/`flex-1`/`max-h-full` anywhere in
    // the chain (ModalShell.tsx, also fenced by ModalShell.layout.test.tsx)
    // stops constraining real overflow content, independent of the
    // unreproducible vh-vs-dvh mechanism the other two cases document.
    test("flex allocation holds when the form body genuinely overflows (forced-overflow stress case)", async ({
      page,
    }) => {
      const SHORT_VIEWPORT = { width: 375, height: 480 };
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto("/");
      await page.getByTestId("create-menu-primary").click();
      await expect(page.getByTestId("new-issue-modal-new-task")).toBeVisible();
      await page.getByTestId("new-issue-more-options-toggle").click();
      await expect(page.getByTestId("new-issue-more-options-content")).toBeVisible();

      await page.setViewportSize(SHORT_VIEWPORT);

      // Non-vacuous precondition: the body must actually overflow its
      // bounded container. This caught a real bug during development — the
      // body-slot wrapper needs `flex flex-col` on itself, not just
      // `min-h-0 flex-1`, or `max-h-full` silently fails to resolve against
      // it and the body grows to its full, unbounded content height instead
      // (see ModalShell.tsx and ModalShell.layout.test.tsx).
      const body = page.getByTestId("new-issue-modal-body");
      const overflows = await body.evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(overflows, "the form body must actually overflow for this test to mean anything").toBe(true);

      const launchBtn = page.getByTestId("new-issue-launch-btn");
      await launchBtn.scrollIntoViewIfNeeded();
      await expect(launchBtn).toBeInViewport();
      const box = await launchBtn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(SHORT_VIEWPORT.height);
    });
  });
});

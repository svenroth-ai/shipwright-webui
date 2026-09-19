/*
 * wizard-plan-card-legibility.spec.ts — F0.5 web-surface functional check
 * (iterate-2026-09-19-fix-wizard-plan-card-white-text).
 *
 * Sven reported (screenshot) that the New-Project wizard's "Here's what I
 * understood." plan card renders its per-phase description text (under
 * Project / Design / Plan / Build / Test / Changelog / Deploy) invisible —
 * white text on a white card. Root cause: the phase-list container
 * (`data-testid="wizard-plan-phases"`) was a bare inline-styled `<div>`, not
 * in `on-photo.css`'s `.on-photo` solid-surface reset class whitelist, so
 * `--ink` stayed flipped white from the bare-photo rule while the
 * container's own background stayed opaque white. Fix: `className="iw-card"`.
 *
 * This is a FUNCTIONAL check (real computed styles in a real Chromium, WCAG
 * contrast math) — same pattern as the sibling `grade-pill-legibility.spec.ts`
 * (iterate-2026-08-26-grade-pill-contrast), NOT a screenshot: the pixel-diff
 * visual baseline is Linux-only and font-rendering noise on Windows would
 * drown the signal. No visual baseline in `e2e/visual/05-wizard.spec.ts`
 * reaches this wizard step (it stops at step 1), so this functional check is
 * the only real-browser coverage of this screen.
 *
 * NOTE (internal-plan-review finding, iterate-2026-09-19): unlike the
 * band-pill fix, the description text and its opaque background live on
 * DIFFERENT elements here (the description `<div>` sets no background of its
 * own — it inherits the container's). Reading `backgroundColor` off the
 * description element itself would return a transparent color and the
 * contrast math would silently always pass, even with the bug fully present.
 * This check therefore reads `color` from the description element and
 * `backgroundColor` from its ancestor `wizard-plan-phases` container.
 */
import { test, expect } from "@playwright/test";
import { contrastRatio } from "../helpers/contrast";

test.describe("New-Project wizard: the plan-card phase descriptions are legible on the photo backdrop", () => {
  test("wizard-phase-Build description renders text with >= 4.5:1 contrast against the plan-card container background (AC1)", async ({
    page,
  }) => {
    await page.goto("/wizard");
    await expect(page.getByTestId("intent-wizard")).toBeVisible();
    await page.getByTestId("wizard-door-new").click();
    await page.getByTestId("wizard-brief-input").fill("Legibility check project");
    await page.getByTestId("wizard-next").click();
    await page.getByTestId("wizard-opt-who").getByText("Just me").click();
    await page.getByTestId("wizard-next").click();
    await page.getByRole("button", { name: "No", exact: true }).click();
    await page.getByTestId("wizard-next").click();
    await page.getByTestId("wizard-opt-where").getByText("Just on my machine").click();
    await page.getByTestId("wizard-next").click();

    const plan = page.getByTestId("wizard-plan-card");
    await expect(plan).toBeVisible();
    const container = page.getByTestId("wizard-plan-phases");
    await expect(container).toBeVisible();

    const description = page.getByTestId("wizard-phase-desc-Build");
    await expect(description).toBeVisible();

    const color = await description.evaluate((el) => getComputedStyle(el).color);
    const backgroundColor = await container.evaluate((el) => getComputedStyle(el).backgroundColor);

    const ratio = contrastRatio(color, backgroundColor);
    expect(
      ratio,
      `wizard-phase-Build description text ${color} on wizard-plan-phases background ${backgroundColor} must clear WCAG AA (4.5:1), got ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });
});

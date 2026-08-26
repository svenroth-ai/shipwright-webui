/*
 * grade-pill-legibility.spec.ts — F0.5 web-surface functional check
 * (iterate-2026-08-26-grade-pill-contrast).
 *
 * Sven reported the band pill next to "Control grade: …" (the
 * `data-testid="wizard-grade-band"` element rendering `band_label`, e.g.
 * "Partial control") rendered WHITE text on a WHITE/light pill on the photo
 * backdrop — unreadable. Root cause: that head sits bare on the scene photo
 * (not wrapped in `.iw-card`), and drew `background: var(--inset)` /
 * `color: var(--body)` inline. `.on-photo` flips `--body` to near-white for
 * bare-chrome text but never flips `--inset` (it stays its light default),
 * so the pairing went white-on-white unless the element carries a class
 * `.on-photo`'s solid-surface reset targets. The fix adds `className="pill"`
 * (on-photo.css already reserves it — see the "grade pills" comment in
 * type-scale.css).
 *
 * This is a FUNCTIONAL check (real computed styles in a real Chromium, WCAG
 * contrast math), not a screenshot: the pixel-diff visual baseline is
 * Linux-only and font-rendering noise on Windows would drown the signal this
 * fix cares about. See e2e/visual/05-wizard.spec.ts `wizard-grade` for the
 * full-page baseline (unaffected by this file).
 */
import { test, expect } from "@playwright/test";
import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";

const READY = {
  ready: true,
  repairCommand: "npx @svenroth-ai/shipwright@latest",
  checks: [{ key: "claude", label: "Claude CLI", ok: true, detail: "2.1.9", why: "", critical: true }],
};

// Same shape as the visual fixture's band_label path — only what this check needs.
const GRADE_FIXTURE = {
  status: "report-ready",
  model: {
    target_display: "github.com/acme/checkout",
    grade: "C",
    score: 61,
    gradeable: true,
    verdict: "Real code, thin evidence.",
    band_label: "Partial control",
    mode: "cold repo (never adopted)",
    routing_state: "heuristic",
    routing_reason: "no Shipwright records found — graded from history + structure",
    verified_from: "shallow clone",
    measurable_count: 1,
    na_count: 1,
    static_test_inventory: "84 test files (Vitest)",
    honest_ceiling_note: "A cold repo can only be graded on what it can prove.",
    dimensions: [
      {
        key: "test_health",
        label: "Test health",
        weight: 1.0,
        score: 0.71,
        status: "gap",
        anchor: "tests",
        detail: "84 real tests run and pass.",
        provenance: {
          source: "Read: package.json scripts.",
          mode: "heuristic",
          freshness: "a1b2c3d4e5f6",
          sampled: false,
          truncated: false,
          disabled_enrichments: [],
        },
        would_light_up: false,
      },
      {
        key: "requirement_traceability",
        label: "Requirement traceability",
        weight: 0.0,
        score: null,
        status: "n/a",
        anchor: "trace",
        detail: "There is no spec.",
        provenance: {
          source: "Looked for: spec.md. None found.",
          mode: "unavailable",
          freshness: "n/a",
          sampled: false,
          truncated: false,
          disabled_enrichments: [],
        },
        would_light_up: true,
      },
    ],
    reasons: [],
    controls_shipwright_would_light: [],
    network_enabled: false,
    network_note: "",
    network_enrichments: [],
    schema_version: "1.0",
  },
};

/** WCAG 2.1 relative luminance + contrast — same math as
 *  client/src/styles/tokens.contrast.test.ts, applied to the REAL rendered
 *  `getComputedStyle` colors instead of parsed CSS tokens. */
function contrastRatio(fg: string, bg: string): number {
  const toRgb = (css: string): [number, number, number] => {
    const m = css.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
    if (!m) throw new Error(`unparseable color: ${css}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const srgbToLin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const relLum = ([r, g, b]: [number, number, number]) =>
    0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
  const [hi, lo] = [relLum(toRgb(fg)), relLum(toRgb(bg))].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

test.describe("grade wizard: the band pill is legible on the photo backdrop", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-band-pill-atlas" });
    await setActiveProject(page, project.projectId);
    await page.route("**/api/readiness", (route) => route.fulfill({ json: READY }));
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("wizard-grade-band renders text with >= 4.5:1 contrast against its own background (AC1)", async ({
    page,
  }) => {
    await page.route("**/api/wizard/grade", (route) => route.fulfill({ json: GRADE_FIXTURE }));
    await page.goto("/wizard/grade");
    await expect(page.getByRole("heading", { name: /Which repo should I grade\?/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("wizard-repo-chip").nth(2).click();

    const band = page.getByTestId("wizard-grade-band");
    await expect(band).toBeVisible({ timeout: 15_000 });
    await expect(band).toHaveText(/Partial control/);

    const { color, backgroundColor } = await band.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, backgroundColor: cs.backgroundColor };
    });

    const ratio = contrastRatio(color, backgroundColor);
    expect(
      ratio,
      `wizard-grade-band text ${color} on background ${backgroundColor} must clear WCAG AA (4.5:1), got ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });
});

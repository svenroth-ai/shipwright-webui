/*
 * contrast.ts — WCAG 2.1 relative luminance + contrast ratio, applied to
 * real rendered `getComputedStyle` colors in a Playwright browser context.
 * Same math as `client/src/styles/tokens.contrast.test.ts` (applied there to
 * parsed CSS tokens instead).
 *
 * Extracted (code-review finding, iterate-2026-09-19-fix-wizard-plan-card-white-text)
 * from a third verbatim copy of this function — `client/e2e/flows/wizard-plan-card-legibility.spec.ts`
 * duplicated it from `client/e2e/flows/grade-pill-legibility.spec.ts`
 * (iterate-2026-08-26-grade-pill-contrast). Only the new consumer was
 * migrated; the existing grade-pill copy was left as-is to keep this bug
 * fix's diff scoped to what it touches.
 */

/** Parses an `rgb()`/`rgba()` CSS color string into `[r, g, b]` (0-255 each). */
function toRgb(css: string): [number, number, number] {
  const m = css.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (!m) throw new Error(`unparseable color: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function srgbToLin(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relLum([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}

/** WCAG 2.1 contrast ratio between two rendered CSS colors (1:1 .. 21:1). */
export function contrastRatio(fg: string, bg: string): number {
  const [hi, lo] = [relLum(toRgb(fg)), relLum(toRgb(bg))].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

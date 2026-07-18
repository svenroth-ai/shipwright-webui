/*
 * motion.ts — the token contract (A20, FR-01.64).
 *
 * RED-first (AC6): these assertions fail until lib/motion.ts + styles/motion.css
 * exist. They pin (a) the four-step duration ladder, (b) the named easings, (c)
 * the CAPPED stagger utility (a 30-item list must not take 1.2s), and (d) that
 * the TS constants MIRROR the CSS custom properties — the single source that
 * lets AC2 assert "a component uses a token, not a magic number".
 */

import { describe, it, expect } from "vitest";
import {
  MOTION_DURATION,
  MOTION_EASING,
  MOTION_PULSE_MS,
  STAGGER_STEP_MS,
  STAGGER_MAX_STEPS,
  staggerDelayMs,
  staggerStyle,
} from "./motion";

describe("motion tokens — the duration ladder", () => {
  // @covers FR-01.64
  it("is a four-step ladder you can hold in your head (fast/base/slow/slower)", () => {
    expect(Object.keys(MOTION_DURATION)).toEqual(["fast", "base", "slow", "slower"]);
    expect(MOTION_DURATION.fast).toBe(120);
    expect(MOTION_DURATION.base).toBe(200);
    expect(MOTION_DURATION.slow).toBe(320);
    expect(MOTION_DURATION.slower).toBe(600);
  });

  // @covers FR-01.64
  it("keeps the ambient LOOP pulse separate from the transition ladder", () => {
    expect(MOTION_PULSE_MS).toBe(1600);
  });
});

describe("motion tokens — named easings (no bespoke per-component cubic-beziers)", () => {
  // @covers FR-01.64
  it("exposes standard / entrance(decel) / exit(accel) / emphasis", () => {
    expect(Object.keys(MOTION_EASING)).toEqual([
      "standard",
      "entrance",
      "exit",
      "emphasis",
    ]);
    for (const v of Object.values(MOTION_EASING)) {
      expect(v).toMatch(/^cubic-bezier\(/);
    }
  });
});

describe("motion stagger — capped index → delay", () => {
  // @covers FR-01.64
  it("steps 40ms per item", () => {
    expect(STAGGER_STEP_MS).toBe(40);
    expect(staggerDelayMs(0)).toBe(0);
    expect(staggerDelayMs(1)).toBe(40);
    expect(staggerDelayMs(3)).toBe(120);
  });

  // @covers FR-01.64
  it("CAPS the delay so a 30-item list does not take 1.2s to appear", () => {
    const capMs = STAGGER_MAX_STEPS * STAGGER_STEP_MS;
    expect(staggerDelayMs(30)).toBe(capMs);
    expect(staggerDelayMs(1000)).toBe(capMs);
    expect(capMs).toBeLessThanOrEqual(320); // <= --motion-slow, never 1200ms
  });

  // @covers FR-01.64
  it("is defensive against negative / non-finite indices", () => {
    expect(staggerDelayMs(-5)).toBe(0);
    expect(staggerDelayMs(Number.NaN)).toBe(0);
  });

  // @covers FR-01.64
  it("staggerStyle() carries the capped delay as a CSS custom property", () => {
    expect(staggerStyle(2)).toEqual({ "--stagger-delay": "80ms" });
    expect(staggerStyle(50)).toEqual({ "--stagger-delay": "320ms" });
  });
});

describe("motion tokens — TS constants MIRROR the CSS custom properties (AC2)", () => {
  // Read the CSS token layer at test time and prove the two sources agree.
  let css = "";
  // @covers FR-01.64
  it("styles/motion.css declares each --motion-* / --ease-* / --stagger-step token", async () => {
    const fs = await import("node:fs" as string);
    const path = await import("node:path" as string);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = (await import("node:url" as string)) as any;
    const here = path.dirname(url.fileURLToPath((import.meta as any).url));
    css = fs.readFileSync(path.resolve(here, "../styles/motion.css"), "utf8");

    expect(css).toContain(`--motion-fast: ${MOTION_DURATION.fast}ms`);
    expect(css).toContain(`--motion-base: ${MOTION_DURATION.base}ms`);
    expect(css).toContain(`--motion-slow: ${MOTION_DURATION.slow}ms`);
    expect(css).toContain(`--motion-slower: ${MOTION_DURATION.slower}ms`);
    expect(css).toContain(`--motion-pulse: ${MOTION_PULSE_MS}ms`);
    expect(css).toContain(`--stagger-step: ${STAGGER_STEP_MS}ms`);
    expect(css).toContain(`--ease-standard: ${MOTION_EASING.standard}`);
    expect(css).toContain(`--ease-entrance: ${MOTION_EASING.entrance}`);
    expect(css).toContain(`--ease-exit: ${MOTION_EASING.exit}`);
    expect(css).toContain(`--ease-emphasis: ${MOTION_EASING.emphasis}`);
  });

  // @covers FR-01.64
  it("declares the GLOBAL reduced-motion FLOOR (stops motion app-wide)", () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toContain("animation-duration: 0.01ms !important");
    expect(css).toContain("transition-duration: 0.01ms !important");
    expect(css).toContain("animation-iteration-count: 1 !important");
  });
});

describe("AC2 — the earned moments use TOKENS, not magic numbers", () => {
  async function readCss(rel: string): Promise<string> {
    const fs = await import("node:fs" as string);
    const path = await import("node:path" as string);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = (await import("node:url" as string)) as any;
    const here = path.dirname(url.fileURLToPath((import.meta as any).url));
    return fs.readFileSync(path.resolve(here, rel), "utf8");
  }

  // @covers FR-01.64
  it("the artifact slide-over animates with the token ladder, not a bespoke .18s ease", async () => {
    const css = await readCss("../styles/mission-record.css");
    // The earned slide-in references the shared keyframe + the duration/easing
    // tokens — never a raw ms literal.
    expect(css).toMatch(/animation:\s*motion-slide-in\s+var\(--motion-base\)\s+var\(--ease-entrance\)/);
    expect(css).not.toContain("slidein .18s");
  });

  // @covers FR-01.64
  it("motion.css keeps the terminal fence — no filter/will-change in the motion layer", async () => {
    // AC3-adjacent: the motion layer never introduces a compositing property that
    // could ride over the xterm canvas. Our keyframes move opacity + translate
    // only; a filter/will-change here would be the regression.
    const motionCss = await readCss("../styles/motion.css");
    expect(motionCss).not.toContain("filter:");
    expect(motionCss).not.toContain("will-change");
  });
});

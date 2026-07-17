/*
 * MOTION PRIMITIVES (A20, FR-01.64) — the ONE duration / easing / stagger scale
 * for the Command Center, exported as TS constants that MIRROR the CSS custom
 * properties in `styles/motion.css` (single source of truth: change both
 * together; `motion.test.ts` pins the mirror). Import the CSS vars for styling;
 * import these constants when a test must assert a token, not a magic number.
 *
 * ── THE AUTHORING RULE (read this before you animate anything) ───────────────
 * Sven runs Windows with animations OFF. `prefers-reduced-motion: reduce` is the
 * PRIMARY user's everyday state, not an accessibility edge case. Therefore:
 *
 *     Content is NEVER hidden by default and revealed by an animation.
 *
 * Animate FROM a visible-safe resting state — the element's base CSS is its
 * FINAL state; the keyframe / transition is an enhancement layered under
 * `@media (prefers-reduced-motion: no-preference)` (or neutralised by the global
 * reduced-motion floor). The naive `opacity: 0 -> 1` entrance whose BASE style is
 * `opacity: 0` leaves the content invisible when motion is off — that is the bug
 * this rule forbids. Counters / rings / sparklines render their FINAL value/path
 * immediately under reduced motion (see `useReducedMotion` / `useCountUp`).
 *
 * Motion only where it MEANS something (arrived / running / decided / counting).
 * Decorative motion is out of scope by design.
 */

import type { CSSProperties } from "react";

/** Duration ladder — four steps you can hold in your head (ms). */
export const MOTION_DURATION = {
  fast: 120,
  base: 200,
  slow: 320,
  slower: 600, // draws / count-ups
} as const;

/** Ambient LOOPING state pulse (live-dot / active Record node), ms. Deliberately
 *  OUTSIDE the transition ladder: a loop is a different kind from an entrance. */
export const MOTION_PULSE_MS = 1600;

/** Named easings — no per-component bespoke cubic-beziers. */
export const MOTION_EASING = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  entrance: "cubic-bezier(0, 0, 0, 1)", // decelerate (things arriving)
  exit: "cubic-bezier(0.4, 0, 1, 1)", // accelerate (things leaving)
  emphasis: "cubic-bezier(0.2, 0, 0, 1.4)", // a subtle overshoot for a landed decision
} as const;

/** Stagger step per list item (ms). */
export const STAGGER_STEP_MS = 40;
/** Cap so a 30-item list does not take 1.2s to appear (8 * 40ms = 320ms). */
export const STAGGER_MAX_STEPS = 8;

/**
 * Capped index -> entrance delay (ms). Non-finite / negative indices resolve to
 * 0; anything past the cap resolves to the same ceiling, so a long list settles
 * in <= --motion-slow rather than crawling in over a second.
 */
export function staggerDelayMs(
  index: number,
  stepMs: number = STAGGER_STEP_MS,
  maxSteps: number = STAGGER_MAX_STEPS,
): number {
  const i = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  return Math.min(i, maxSteps) * stepMs;
}

/**
 * Inline style carrying the capped per-item entrance delay as the
 * `--stagger-delay` custom property the `.motion-stagger-item` rule consumes.
 * The item's CONTENT is unaffected — it rests visible; only the (media-gated)
 * entrance animation is delayed.
 */
export function staggerStyle(index: number): CSSProperties {
  return { "--stagger-delay": `${staggerDelayMs(index)}ms` } as CSSProperties;
}

/** CSS `var(--token)` references — use in inline styles / template classes so a
 *  component reaches for a token, never a literal ms / cubic-bezier. */
export const MOTION_VAR = {
  fast: "var(--motion-fast)",
  base: "var(--motion-base)",
  slow: "var(--motion-slow)",
  slower: "var(--motion-slower)",
  pulse: "var(--motion-pulse)",
  easeStandard: "var(--ease-standard)",
  easeEntrance: "var(--ease-entrance)",
  easeExit: "var(--ease-exit)",
  easeEmphasis: "var(--ease-emphasis)",
} as const;

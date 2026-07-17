import { useEffect, useRef, useState } from "react";

import { MOTION_DURATION } from "../lib/motion";
import { useReducedMotion } from "./useReducedMotion";

/**
 * useCountUp (A20, FR-01.64) — interpolate a number from `from` (default 0) to
 * `value` over a token duration via requestAnimationFrame, decelerating.
 *
 * THE CONTRACT: under reduced motion (or when rAF is unavailable, or duration
 * <= 0) it returns `value` IMMEDIATELY on the first render — the final number is
 * NEVER gated behind the animation. Under no-preference it counts up.
 *
 * HONESTY (AC8): the caller must pass a REAL value it could produce. A
 * null/absent datum has no count-up — render the honest empty state, do not
 * count up over a fabricated number.
 */
export function useCountUp(
  value: number,
  opts: { durationMs?: number; from?: number } = {},
): number {
  const reduced = useReducedMotion();
  const durationMs = opts.durationMs ?? MOTION_DURATION.slower;
  const from = opts.from ?? 0;
  const animatable =
    !reduced && durationMs > 0 && typeof requestAnimationFrame === "function";

  const [display, setDisplay] = useState<number>(animatable ? from : value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!animatable) return; // the non-animating path renders `value` directly (below)
    const start = performance.now();
    setDisplay(from);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic (mirrors --ease-entrance)
      if (t < 1) {
        setDisplay(from + (value - from) * eased);
        frame.current = requestAnimationFrame(tick);
      } else {
        setDisplay(value);
      }
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [value, from, durationMs, animatable]);

  // Return `value` SYNCHRONOUSLY whenever motion is not allowed — so a live flip
  // to reduced motion, or an async-loaded value under reduced motion, shows the
  // final number on THIS render, never a stale partial from `display`. Only the
  // animating path reads the interpolated state.
  return animatable ? display : value;
}

/*
 * GradeRing — the .gring letter+score ring (A08). A null score (ungradeable)
 * renders a dashed track and no arc, never a fabricated 0.
 *
 * Motion (A20, FR-01.64): the arc DRAWS up to its score via `useCountUp` — the
 * earned "grade ring counts up" moment. Under reduced motion (Sven's everyday
 * machine, or jsdom/SSR) the count-up returns the FINAL value on the first
 * render, so the ring shows its complete arc immediately — never an empty ring
 * revealed by an animation. HONESTY (AC8): a null score has no arc and no
 * count-up — there is no number to count, so none is invented.
 */

import { useCountUp } from "../../../hooks/useCountUp";

export function GradeRing({ letter, score }: { letter: string; score: number | null }) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const hasScore = typeof score === "number";
  // Count up ONLY a real score; an ungradeable dimension never animates a value.
  const drawn = useCountUp(hasScore ? (score as number) : 0);
  const off = hasScore ? C * (1 - drawn / 100) : C;
  return (
    <div className="gring" style={{ width: 80, height: 80 }} data-testid="wizard-grade-ring">
      <svg width={80} height={80} viewBox="0 0 80 80">
        <circle cx={40} cy={40} r={R} fill="none" stroke="var(--line-strong)" strokeWidth={6} />
        {hasScore ? (
          <circle
            cx={40}
            cy={40}
            r={R}
            fill="none"
            stroke="var(--warn)"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={C.toFixed(1)}
            strokeDashoffset={off.toFixed(1)}
          />
        ) : null}
      </svg>
      <div className="g">{letter}</div>
    </div>
  );
}

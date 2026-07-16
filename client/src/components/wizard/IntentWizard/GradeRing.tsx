/*
 * GradeRing — the .gring letter+score ring (A08). A null score (ungradeable)
 * renders a dashed track and no arc, never a fabricated 0.
 */

export function GradeRing({ letter, score }: { letter: string; score: number | null }) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const hasScore = typeof score === "number";
  const off = hasScore ? C * (1 - (score as number) / 100) : C;
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

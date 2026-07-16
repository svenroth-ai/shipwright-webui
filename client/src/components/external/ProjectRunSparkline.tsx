/*
 * ProjectRunSparkline — a runs sparkline as a row of plain <i> bars (A15,
 * FR-01.59). No chart library: bars are flex children whose height is a % of
 * the tallest value. Styling (`.lc-spark`, `.lc-spark i`) lives in
 * projects-gallery.css, ported from the prototype.
 *
 * Renders NOTHING for an empty series — an absent logbook is the card's
 * `.lc-empty` sentence, never a flat/zeroed chart (spec AC2).
 */

export function ProjectRunSparkline({
  values,
  label,
}: {
  values: number[];
  label: string;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  return (
    <div
      className="lc-spark"
      role="img"
      aria-label={label}
      data-testid="lc-spark"
    >
      {values.map((v, i) => {
        // Floor at 6% so a real-but-tiny value still shows a stub; a zero-run
        // project never reaches here, so this never fabricates a bar.
        const pct = Math.max(6, Math.round((Math.max(0, v) / max) * 100));
        return <i key={i} style={{ height: `${pct}%` }} />;
      })}
    </div>
  );
}

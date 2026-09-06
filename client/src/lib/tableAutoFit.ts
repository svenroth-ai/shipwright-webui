/*
 * tableAutoFit — column-width heuristic for markdown tables rendered in
 * SmartViewer (iterate-2026-09-06-smartviewer-table-a11y).
 *
 * The browser's own `table-layout: auto` already sizes short, enum-like
 * columns (id/priority/status) tightly to their content — that part needs
 * no help. The gap is a table that ALSO has one or more free-text columns
 * (a "Description"/"Notes" column running to several sentences): `auto`
 * layout is free to shrink that column down to the width of its longest
 * unbreakable WORD, so in a narrow pane it gets crushed into a column that
 * is many lines tall before the table ever needs to overflow — the pane's
 * horizontal scroll (already wired at the CSS layer for exactly this case)
 * never engages, because nothing ever forces the table wider than the pane.
 *
 * This computes explicit per-column pixel widths so that: short columns
 * keep their natural (measured) width, unchanged from today; and any
 * column whose natural (unwrapped) content exceeds MAX_COMFORTABLE_PX is
 * treated as free text and guaranteed at least MIN_FLEX_PX — even if that
 * pushes the table wider than the container, which is the intended trigger
 * for the pane-level horizontal scroll rather than unreadable over-wrapping.
 *
 * A table with NO free-text column (every column's natural width already
 * fits under MAX_COMFORTABLE_PX — e.g. a 3-column stack/tech table) is left
 * untouched (`null`): the browser's default distribution is already the
 * comfortable, well-proportioned layout in that case, and forcing explicit
 * widths there would only waste space.
 */

/** Above this natural (single-line) width, a column is treated as free text. */
export const MAX_COMFORTABLE_PX = 320;
/** Minimum width guaranteed to a free-text column, even under pane pressure. */
export const MIN_FLEX_PX = 200;

/**
 * `naturalWidths[i]` = column i's natural (unwrapped, single-line) content
 * width in px, header included. Returns `null` when no column needs
 * intervention (nothing exceeds MAX_COMFORTABLE_PX) — callers should leave
 * the table's own `table-layout: auto` in charge. Otherwise returns one
 * width per column to apply via `<col style={{ width }}>`.
 */
export function computeAutoFitColumnWidths(
  naturalWidths: number[],
  containerWidth: number,
): number[] | null {
  if (naturalWidths.length === 0) return null;

  const flexIndexes = naturalWidths
    .map((w, i) => (w > MAX_COMFORTABLE_PX ? i : -1))
    .filter((i) => i >= 0);

  if (flexIndexes.length === 0) return null;

  const fixedWidths = naturalWidths.map((w, i) =>
    flexIndexes.includes(i) ? 0 : Math.max(0, w),
  );
  const sumFixed = fixedWidths.reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, containerWidth - sumFixed);
  const perFlex = Math.max(MIN_FLEX_PX, remaining / flexIndexes.length);

  return naturalWidths.map((w, i) => (flexIndexes.includes(i) ? perFlex : w));
}

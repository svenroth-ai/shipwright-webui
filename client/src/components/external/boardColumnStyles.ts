/*
 * Static lane metadata + colored-glass palette for TaskBoardColumns.
 * Extracted from TaskBoardColumns.tsx (bloat H1, iterate-2026-10-09) — pure
 * data, no behavior; the palette rationale below is unchanged.
 */
import type { BoardColumn } from "../../lib/boardColumnApi";

export type ColumnTone = "draft" | "inprogress" | "done";

export interface ColumnMeta {
  col: BoardColumn;
  title: string;
  testId: string;
  tone: ColumnTone;
}

export const COLUMN_META: readonly ColumnMeta[] = [
  { col: "backlog", title: "Backlog", testId: "column-draft", tone: "draft" },
  { col: "in_progress", title: "In Progress", testId: "column-in-progress", tone: "inprogress" },
  { col: "done", title: "Done", testId: "column-done", tone: "done" },
];

export interface ColumnStyle {
  /** 3px top-accent bar colour — the per-column hue identity (unchanged). */
  border: string;
  /** Lane header text colour — WHITE on the dark colored glass (see panel). */
  header: string;
  count: { bg: string; fg: string };
  /** The colored-glass PANEL ground (Sven feedback 2026-07-17): a translucent
   *  dark tint in the column's own colour + a translucent accent edge. Paired
   *  with a backdrop blur in DroppableColumn. */
  panel: { bg: string; border: string };
}

/** Per-column palette. The PANEL is now a dark translucent GLASS tinted in each
 *  column's own colour (draft=neutral grey, in-progress=amber, done=blue) — the
 *  mockup (Spec/prototype/_shots/board.png) treatment — replacing the shared
 *  opaque `--g50` ground. White cards inside pop on the dark glass.
 *
 *  Colour engineering (calibrated, see the iterate ADR): a dark glass keeps the
 *  header AA over the deck-golden photo — white on the dark tint clears 5.7:1
 *  even over the photo's brightest region, whereas a DARK header on a light tint
 *  is AA-IMPOSSIBLE over the photo's dark mast/sail (the `--color-muted` draft
 *  header is barely AA even on opaque `--g50`). So the header goes WHITE.
 *
 *  Stable tokens only: `--g500` / `--color-warning` / `--color-info` do NOT flip
 *  under `.on-photo` (unlike `--color-muted`/`--color-text`), so the tint is
 *  deterministic inside the scene. The 3px top accent (`border`) keeps the
 *  current hue — mockup blue/green is a deliberate follow-up, not this iterate. */
const DARK_GLASS = "rgba(35, 31, 24, 0.58)"; // warm near-black glass base
const GLASS_EDGE = "rgba(255, 255, 255, 0.18)"; // light rim the accent tints
const WHITE_HEADER = "rgba(255, 255, 255, 0.96)";
export const COLUMN_STYLES: Record<ColumnTone, ColumnStyle> = {
  draft: {
    border: "var(--color-muted)",
    header: WHITE_HEADER,
    count: { bg: "rgba(255, 255, 255, 0.9)", fg: "var(--g700)" },
    panel: {
      bg: `color-mix(in srgb, var(--g500) 16%, ${DARK_GLASS})`,
      border: `color-mix(in srgb, var(--g500) 28%, ${GLASS_EDGE})`,
    },
  },
  inprogress: {
    border: "var(--color-warning)",
    header: WHITE_HEADER,
    count: { bg: "var(--color-warning-bg)", fg: "var(--color-warning-text)" },
    panel: {
      bg: `color-mix(in srgb, var(--color-warning) 20%, ${DARK_GLASS})`,
      border: `color-mix(in srgb, var(--color-warning) 34%, ${GLASS_EDGE})`,
    },
  },
  done: {
    border: "var(--color-info)",
    header: WHITE_HEADER,
    count: { bg: "var(--color-info-bg)", fg: "#2563eb" },
    panel: {
      bg: `color-mix(in srgb, var(--color-info) 20%, ${DARK_GLASS})`,
      border: `color-mix(in srgb, var(--color-info) 34%, ${GLASS_EDGE})`,
    },
  },
};

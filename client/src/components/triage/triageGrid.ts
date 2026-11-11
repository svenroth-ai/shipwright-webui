/*
 * triageGrid.ts — the column layout of a Triage card list
 * (iterate-2026-11-09-triage-polish-r3): one column on a narrow window, two
 * from 1100px, three from 1700px (the sidebar takes part of the viewport, so
 * the thresholds are higher than the content width a card needs). Tracks are
 * minmax(0,1fr) so a long unbroken word can never widen a column;
 * `auto-rows-fr` + `items-stretch` make every card the same height (the tallest card sets the row height, all rows alike), and the 12px gap keeps cards clearly apart.
 */
export const TRIAGE_GRID =
  "grid grid-cols-[minmax(0,1fr)] auto-rows-fr items-stretch gap-3 min-[1100px]:grid-cols-[repeat(2,minmax(0,1fr))] min-[1700px]:grid-cols-[repeat(3,minmax(0,1fr))] max-md:gap-2.5";

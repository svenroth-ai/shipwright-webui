/*
 * triageGrid.ts — the column layout of a Triage card list
 * (iterate-2026-11-09-triage-polish-r3): one column on a narrow window, two
 * from 900px, three from 1500px. `items-start` keeps a short card from
 * stretching to the height of its taller neighbour.
 */
export const TRIAGE_GRID =
  "grid grid-cols-1 items-start gap-1.5 min-[900px]:grid-cols-2 min-[1500px]:grid-cols-3 max-md:gap-1";

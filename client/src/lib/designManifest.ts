/*
 * designManifest.ts — parse the design phase's emitted `design-manifest.md`
 * into the list of pending screens for the design-gate gallery (FR-01.58, A14).
 *
 * The design phase (shipwright-design `screen_registry.py`) writes
 * `.shipwright/designs/design-manifest.md` with a "## Screens" markdown table:
 *
 *   | # | Screen | File | Status | Linked FRs |
 *   |---|--------|------|--------|-----------|
 *   | 01 | dashboard | screens/01-dashboard.html | complete | FR-01.09 |
 *
 * We READ that file through the existing generic `/file` route (served as
 * text/markdown) — no new server surface, and nothing is written. Pure +
 * deterministic so it unit-tests without the filesystem.
 *
 * HONESTY (AC5): a real screen row is admitted (a numbered row, or one whose
 * `file` is a `screens/*.html` path). A row whose file cell is NOT a servable
 * `screens/*.html` path keeps its metadata but carries `file: ""`, so the gallery
 * renders an honest per-card "no preview file" placeholder rather than a dead
 * iframe — never a fabricated thumbnail. A manifest with no screen rows (or the
 * literal "No screens generated yet." placeholder) yields an EMPTY list, so the
 * gallery renders its honest empty state. The `linked_frs` cell is frequently
 * empty; an absent FR is dropped (never invented).
 */

/** One pending screen, as parsed from the manifest's Screens table. */
export interface DesignScreen {
  /** Two-digit ordinal from the filename (01, 02, …); null if unparseable. */
  number: number | null;
  /** Human screen name (the manifest's "Screen" cell). */
  name: string;
  /** Project-relative-to-designs POSIX path, e.g. `screens/01-dashboard.html`. */
  file: string;
  /** The manifest's "Status" cell (e.g. "complete"); null when absent. */
  status: string | null;
  /** Linked FR ids, in order; empty when the manifest cell was blank. */
  frs: string[];
}

/** Split a markdown table row into trimmed cells (drops the leading/trailing
 *  empty cells produced by the outer pipes). */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

/** A `|---|:--:|` separator row — never a data row. */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

/** Extract FR ids from a manifest cell (comma / whitespace separated). */
function parseFrs(cell: string): string[] {
  const matches = cell.match(/FR-\d+\.\d+/gi);
  return matches ? matches.map((m) => m.toUpperCase()) : [];
}

/**
 * Parse the manifest markdown into the ordered list of screens. Tolerant of
 * heading level, column count and blank FR cells; returns [] for any manifest
 * that carries no real `screens/*.html` row.
 */
export function parseDesignManifest(markdown: string): DesignScreen[] {
  if (typeof markdown !== "string" || markdown.length === 0) return [];
  const lines = markdown.split(/\r?\n/);

  // Locate the "## Screens" section (any heading depth; case-insensitive).
  let i = lines.findIndex((l) => /^#{1,6}\s+screens\s*$/i.test(l.trim()));
  if (i === -1) return [];
  i += 1;

  const screens: DesignScreen[] = [];
  let sawHeaderRow = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    // Stop at the next heading (end of the Screens section).
    if (/^#{1,6}\s+/.test(line.trim())) break;
    if (line.trim().length === 0) continue;
    if (!line.includes("|")) continue; // e.g. "No screens generated yet."

    const cells = splitRow(line);
    if (isSeparatorRow(cells)) continue;
    // The first pipe-row is the header (| # | Screen | File | … |).
    if (!sawHeaderRow) {
      sawHeaderRow = true;
      continue;
    }
    if (cells.length < 3) continue;

    const [numCell, nameCell, fileCell, statusCell, frsCell] = cells;
    const rawFile = (fileCell ?? "").trim();
    const isServable = /^screens\/.+\.html$/i.test(rawFile);
    const numText = (numCell ?? "").trim();
    const num = Number.parseInt(numText, 10);
    // Admit a real screen row: a numbered row OR one with a servable file. A row
    // that is neither (a stray line) is dropped. A row that IS a screen but has
    // no servable file keeps its metadata with `file: ""` → honest placeholder.
    if (!isServable && !/^\d{1,3}$/.test(numText)) continue;

    const file = isServable ? rawFile : "";
    screens.push({
      number: Number.isFinite(num) ? num : null,
      name: (nameCell ?? "").trim() || file || (Number.isFinite(num) ? `Screen ${num}` : "Screen"),
      file,
      status: (statusCell ?? "").trim() || null,
      frs: parseFrs(frsCell ?? ""),
    });
  }

  return screens;
}

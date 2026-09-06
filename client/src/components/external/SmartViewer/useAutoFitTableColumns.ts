/*
 * useAutoFitTableColumns — applies tableAutoFit's column-width heuristic to
 * every <table> rendered inside a container (SmartViewer's DocumentMarkdown
 * pane, iterate-2026-09-06-smartviewer-table-a11y).
 *
 * Measurement is done off-DOM: each table is deep-cloned, forced to
 * `white-space: nowrap` so every cell reports its true unwrapped width, laid
 * out invisibly (`visibility: hidden`, taken out of flow), measured, then
 * discarded — the live table is never mutated except for the final
 * <colgroup> it gets tagged with.
 *
 * The clone is appended INSIDE `container` (hidden, out of flow), not to
 * `document.body` — `.markdown-body table th`'s padding + bold weight are
 * descendant-selector rules that only match with that ancestor present.
 * Measuring from `document.body` silently dropped both, under-measuring
 * every column; combined with `table-layout: fixed` (needed so the applied
 * widths are authoritative rather than a hint `auto` layout can override),
 * that under-measurement forced short header text ("Priority", "Basis") to
 * wrap character-by-character — verified live before this fix landed.
 *
 * Scoped to `.smart-viewer-markdown`: `DocumentMarkdown` (where this hook is
 * wired) is ALSO rendered, without that wrapper, by OrgDocViewerModal,
 * ComplianceDetailModal, MissionArtifactBody and MissionSlice2Details. Those
 * surfaces keep the base `.markdown-body table` rule (`display: block`, not
 * `table`), where `table-layout` and `<col>` widths are inert — the fix
 * would do nothing there while still cloning tables and installing a
 * ResizeObserver on every render. Bail out before any of that on a container
 * that isn't inside the one pane the heuristic actually helps.
 */
import { useEffect } from "react";

import { computeAutoFitColumnWidths } from "../../../lib/tableAutoFit";

function measureNaturalColumnWidths(table: HTMLTableElement, container: HTMLElement): number[] {
  const clone = table.cloneNode(true) as HTMLTableElement;
  clone.style.position = "absolute";
  clone.style.top = "-99999px";
  clone.style.left = "-99999px";
  clone.style.visibility = "hidden";
  clone.style.tableLayout = "auto";
  clone.style.width = "auto";
  // Existing colgroup (from a prior run) would pin widths and defeat the
  // whole point of re-measuring — strip it before the clone is measured.
  clone.querySelectorAll("colgroup").forEach((cg) => cg.remove());
  clone.querySelectorAll("th, td").forEach((cell) => {
    (cell as HTMLElement).style.whiteSpace = "nowrap";
  });
  container.appendChild(clone);

  const widths: number[] = [];
  for (const row of Array.from(clone.rows)) {
    let colIndex = 0;
    for (const cell of Array.from(row.cells)) {
      // colSpan > 1 cells don't map to a single column — skip rather than
      // mis-attribute width to one column.
      if (cell.colSpan === 1) {
        // +1px safety margin: fixed layout makes this width authoritative,
        // so a sub-pixel shortfall from font rounding would force an
        // otherwise-avoidable wrap.
        const w = Math.ceil(cell.getBoundingClientRect().width) + 1;
        widths[colIndex] = Math.max(widths[colIndex] ?? 0, w);
      }
      colIndex += cell.colSpan;
    }
  }

  clone.remove();
  // A column touched only by colSpan>1 cells is never assigned above, leaving
  // a sparse hole; `for...of` over a sparse array yields `undefined` at that
  // index, which would otherwise reach applyColumnWidths as `"undefinedpx"`.
  // remark-gfm tables never emit colspan today, so this is unreachable in
  // practice — normalized defensively for any future non-GFM caller.
  for (let i = 0; i < widths.length; i++) {
    widths[i] = widths[i] ?? 0;
  }
  return widths;
}

// `table-layout: auto` treats an explicit <col width> as a mere HINT that
// the content-driven algorithm is free to override — verified live: with
// `auto` still in effect, a computed colgroup made no visible difference at
// all, because the browser kept re-deriving column widths from cell content
// exactly as before. `fixed` layout is what makes column widths authoritative
// (columns are governed by the <col>s and the table's own width, not
// content), so it's required for this heuristic to do anything.
function applyColumnWidths(table: HTMLTableElement, widths: number[]): void {
  table.querySelectorAll(":scope > colgroup").forEach((cg) => cg.remove());
  const colgroup = document.createElement("colgroup");
  for (const w of widths) {
    const col = document.createElement("col");
    col.style.width = `${w}px`;
    colgroup.appendChild(col);
  }
  table.insertBefore(colgroup, table.firstChild);
  table.style.tableLayout = "fixed";
  table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
}

function clearColumnWidths(table: HTMLTableElement): void {
  table.querySelector(":scope > colgroup")?.remove();
  table.style.tableLayout = "";
  table.style.width = "";
}

function autoFitAllTables(container: HTMLElement): void {
  // DocumentMarkdown (where this hook is wired) is also rendered without the
  // `.smart-viewer-markdown` wrapper by OrgDocViewerModal, ComplianceDetailModal,
  // MissionArtifactBody and MissionSlice2Details — the base `.markdown-body
  // table` rule there is `display: block`, where table-layout/<col> widths
  // are inert. Bail out before cloning/mutating anything on those surfaces.
  if (!container.closest(".smart-viewer-markdown")) return;
  const tables = container.querySelectorAll<HTMLTableElement>("table");
  const containerWidth = container.clientWidth;
  if (containerWidth <= 0) return;
  for (const table of Array.from(tables)) {
    const natural = measureNaturalColumnWidths(table, container);
    const widths = computeAutoFitColumnWidths(natural, containerWidth);
    if (widths) applyColumnWidths(table, widths);
    else clearColumnWidths(table);
  }
}

/**
 * Runs the auto-fit pass whenever `deps` changes (new markdown rendered) and
 * again whenever the container is resized (sidebar toggle, window resize).
 *
 * The initial pass runs synchronously at mount with no `document.fonts.ready`
 * gate — a still-loading web font would measure fallback-font metrics until
 * the next resize-triggered re-fit. Not addressed: this surface uses only
 * system/fallback fonts today, so the two are close enough in practice.
 */
export function useAutoFitTableColumns(
  containerRef: React.RefObject<HTMLElement | null>,
  deps: readonly unknown[],
): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's explicit trigger list
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!container.closest(".smart-viewer-markdown")) return;
    autoFitAllTables(container);

    if (typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => autoFitAllTables(container));
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

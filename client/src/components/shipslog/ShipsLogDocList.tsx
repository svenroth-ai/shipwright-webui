/*
 * ShipsLogDocList — a group of doc rows inside the Ship's-Log Documents
 * panel (iterate-2026-08-31-shipslog-documents-panel). Reuses `.logentry`
 * (already reset for on-photo.css legibility) so a doc row looks like a
 * logbook entry: date + title + chevron, click opens SmartViewerModal.
 */

import { ChevronRight } from "lucide-react";

import type { ShipsLogDocRow } from "../../lib/shipsLogDocsApi";

/** ISO ts → "Jul 12"; "—" when absent/unparseable (mirrors LogEntryList's fmtDate). */
export function fmtDocDate(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface Props {
  rows: ShipsLogDocRow[];
  emptyLabel: string;
  onOpen: (path: string) => void;
}

export function ShipsLogDocList({ rows, emptyLabel, onOpen }: Props) {
  if (rows.length === 0) {
    return <div className="doc-empty">{emptyLabel}</div>;
  }
  return (
    <>
      {rows.map((row) => (
        <button
          key={row.path}
          type="button"
          className="logentry"
          data-testid={`shipslog-doc-${row.path}`}
          onClick={() => onOpen(row.path)}
        >
          <span className="le-date">{fmtDocDate(row.when)}</span>
          <span className="le-title">{row.label}</span>
          <ChevronRight className="le-chev" size={15} />
        </button>
      ))}
    </>
  );
}

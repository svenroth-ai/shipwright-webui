/*
 * TriageTiles — the summary pills above the list: Open, Critical + High,
 * In progress (items with a Fix-now task, iterate-2026-11-09-triage-fixnow-task)
 * and Parked (iterate-2026-11-08-triage-page-redesign; compact pills since
 * iterate-2026-11-13-triage-rows-round3, they used to be wide tiles). They act
 * as quick filters: "Critical + High" and "In progress" narrow the list (a
 * removable chip says so), "Parked" flips the Show-parked switch. The pills,
 * the status notices (children) and the severity legend share ONE row.
 */

import type { ReactNode } from "react";

import { SeverityLegend } from "./TriageSeverityNumber";

export type TriageTile = "open" | "attn" | "prog" | "parked";

interface Props {
  open: number;
  attention: number;
  inProgress: number;
  parked: number;
  selected: TriageTile | null;
  showParked: boolean;
  onSelect: (tile: TriageTile) => void;
  /** Status notices that sit in the same row, between the pills and the legend. */
  children?: ReactNode;
}

export function TriageTiles({ open, attention, inProgress, parked, selected, showParked, onSelect, children }: Props) {
  const tiles: { id: TriageTile; label: string; n: number; pressed: boolean }[] = [
    { id: "open", label: "Open", n: open, pressed: selected === null },
    { id: "attn", label: "Critical + High", n: attention, pressed: selected === "attn" },
    { id: "prog", label: "In progress", n: inProgress, pressed: selected === "prog" },
    { id: "parked", label: "Parked", n: parked, pressed: showParked },
  ];
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2" data-testid="triage-summary">
      <div className="contents" data-testid="triage-tiles">
        {tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={t.pressed}
            onClick={() => onSelect(t.id)}
            data-testid={`triage-tile-${t.id}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/20 bg-[var(--triage-lane-solid)] px-3.5 text-[13px] text-white/85 shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-colors hover:bg-white/[0.14] aria-pressed:border-[var(--nav-active-rail)] aria-pressed:bg-[var(--nav-active-bg)] aria-pressed:text-white"
          >
            <b className="font-semibold tabular-nums text-white">{t.n}</b>
            {t.label}
          </button>
        ))}
      </div>
      {children}
      <div className="ml-auto">
        <SeverityLegend />
      </div>
    </div>
  );
}

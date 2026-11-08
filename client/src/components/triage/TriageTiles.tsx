/*
 * TriageTiles — the three summary tiles above the list: Open, Critical +
 * High, Parked (iterate-2026-11-08-triage-page-redesign). They act as quick
 * filters: "Critical + High" narrows the list (a removable chip says so),
 * "Parked" flips the Show-parked switch. The old "Needs attention" label is
 * gone — it meant Critical + High and now says so.
 */

export type TriageTile = "open" | "attn" | "parked";

interface Props {
  open: number;
  attention: number;
  parked: number;
  selected: TriageTile | null;
  showParked: boolean;
  onSelect: (tile: TriageTile) => void;
}

export function TriageTiles({ open, attention, parked, selected, showParked, onSelect }: Props) {
  const tiles: { id: TriageTile; label: string; n: number; pressed: boolean }[] = [
    { id: "open", label: "Open", n: open, pressed: selected === null },
    { id: "attn", label: "Critical + High", n: attention, pressed: selected === "attn" },
    { id: "parked", label: "Parked", n: parked, pressed: showParked },
  ];
  return (
    <div className="mb-4 grid grid-cols-3 gap-3 max-md:gap-2" data-testid="triage-tiles">
      {tiles.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={t.pressed}
          onClick={() => onSelect(t.id)}
          data-testid={`triage-tile-${t.id}`}
          className="flex flex-col items-start rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-card-hover)] aria-pressed:border-[var(--color-primary)]"
        >
          <span className="text-2xl font-semibold leading-none text-[var(--color-text)]">{t.n}</span>
          <span className="mt-1 text-xs text-[var(--color-muted)]">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/*
 * DensityToggle — the per-surface header control for comfortable ⇄ compact
 * density (A21, FR-01.65, AC5). Reads the ONE shared density cell (useDensity)
 * so it stays in sync with the palette command and every other surface. The
 * clickable equivalent of the palette's density command (AC7).
 */

import { Rows2, Rows3 } from "lucide-react";
import { useDensity } from "../../hooks/useDensity";

interface Props {
  className?: string;
}

export function DensityToggle({ className }: Props) {
  const { density, toggleDensity } = useDensity();
  const compact = density === "compact";
  const label = compact ? "Comfortable rows" : "Compact rows";
  return (
    <button
      type="button"
      onClick={toggleDensity}
      className={
        "inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-button,8px)] " +
        "text-[var(--color-muted)] hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)] " +
        (className ?? "")
      }
      aria-pressed={compact}
      aria-label={label}
      title={label}
      data-testid="density-toggle"
    >
      {compact ? (
        <Rows3 size={16} aria-hidden="true" />
      ) : (
        <Rows2 size={16} aria-hidden="true" />
      )}
    </button>
  );
}

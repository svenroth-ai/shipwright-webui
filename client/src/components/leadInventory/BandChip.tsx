/*
 * BandChip — the one authority-band label component shared by StepRow (no
 * `variant`, always the neutral step-chip look) and AuthorityPanel
 * (`variant` set) — iterate-2026-09-08-lead-inventory-page's Design Notes:
 * "same bands, same words" is structural because both call sites render
 * THIS component, never a copied string.
 *
 * Full-radius pill (`Avatars / pills: full`), neutral muted-bg by default —
 * band is a category, not a state, so it deliberately does NOT reuse the
 * phase-chip palette (that palette is reserved for pipeline-phase
 * semantics). `declared` uses `--color-success`; `missing` uses
 * `--color-muted-bg` (Design Check, visual-guidelines.md tokens).
 */

import type { BeatStepBand } from "../../lib/leadInventoryApi";

const BAND_LABELS: Record<BeatStepBand, string> = {
  bugfix: "Bugfix",
  maintenance: "Maintenance",
  feature: "Feature",
  architecture: "Architecture",
};

export interface BandChipProps {
  band: BeatStepBand;
  variant?: "declared" | "missing";
}

export function BandChip({ band, variant }: BandChipProps) {
  const variantClass =
    variant === "declared"
      ? "bg-[var(--color-success-bg)] text-[var(--color-success)] border border-[var(--color-success)]"
      : variant === "missing"
        ? "bg-[var(--color-muted-bg)] text-[var(--color-muted)] border border-transparent"
        : "bg-[var(--color-muted-bg)] text-[var(--color-text)] border border-transparent";

  return (
    <span
      data-testid={`band-chip-${band}`}
      className={`inline-flex items-center rounded-full px-2 py-[2px] text-[11px] font-medium ${variantClass}`}
    >
      {BAND_LABELS[band]}
    </span>
  );
}

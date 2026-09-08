/*
 * AuthorityPanel — a lead's declared authority ladder, read from its
 * charter (iterate-2026-09-08-lead-inventory-page, AC-4).
 *
 * NOT a per-band "may act alone" flag — no field in leadwright's schemas or
 * store carries that (Internal Plan Review finding #1: `checkBeatStart`
 * denies a beat outright when ANY band is missing, so a lead with beats to
 * show already has all 4 declared — the flag would be vacuous exactly
 * where it would be seen). Instead: each band's own charter PROSE plus a
 * `N/4 declared` completeness line — real, disclosed information using the
 * SAME `BandChip` vocabulary the step chips use (Design Notes, "same
 * bands, same words").
 */

import type { AuthorityPanelView } from "../../lib/leadInventoryApi";
import { BandChip } from "./BandChip";

export interface AuthorityPanelProps {
  authority: AuthorityPanelView;
}

export function AuthorityPanel({ authority }: AuthorityPanelProps) {
  if (!authority.measured) {
    return (
      <p data-testid="authority-panel-not-measured" className="text-[13px] text-[var(--color-muted)]">
        Authority ladder unavailable — {authority.reason}
      </p>
    );
  }

  return (
    <div data-testid="authority-panel" className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1.5">
        {authority.bands.map((band) => (
          <li key={band.id} className="flex items-start gap-2 text-[12px]">
            <BandChip band={band.id} variant={band.declared ? "declared" : "missing"} />
            <span className="text-[var(--color-text)]">
              {band.declared ? band.text ?? <em className="text-[var(--color-muted)]">(no prose in this section)</em> : "Not declared in this lead's charter"}
            </span>
          </li>
        ))}
      </ul>
      <p data-testid="authority-panel-completeness" className="text-[12px] font-medium text-[var(--color-muted)]">
        {authority.declaredCount}/4 declared
      </p>
    </div>
  );
}

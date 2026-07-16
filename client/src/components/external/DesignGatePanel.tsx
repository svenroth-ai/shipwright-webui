/*
 * DesignGatePanel — thin board-card adapter for the paused design gate
 * (FR-01.45; reduced by A14, FR-01.58).
 *
 * A14 moved the design-gate REVIEW experience into the task's Mission view — the
 * three-card `DesignGateCard` (gallery of pending screens + Approve /
 * Request-changes decision bar). The gate is no longer a foreign full-bleed
 * screen reached from a board card, so this panel is reduced from its former
 * 64-LOC surface (its own "Review mockups" button + <MockupReviewOverlay> host)
 * to an HONEST, non-competing status hint: it tells the operator the run is
 * paused for their approval and points them to the Mission view. Badge + text,
 * never colour alone (AC9); no second primary CTA (AC4). The real review viewer
 * (<MockupReviewOverlay>) now lives in the gate card.
 */

import { AlertTriangle } from "lucide-react";

export function DesignGatePanel(_props: { projectId: string }) {
  return (
    <div
      data-testid="design-gate-panel"
      className="flex items-start gap-2 rounded-[var(--radius-button,8px)] border border-[var(--warn-line)] bg-warn-tint px-2.5 py-2 text-[11px] text-warn"
    >
      <AlertTriangle size={12} className="mt-[2px] shrink-0" aria-hidden="true" />
      <span>
        <strong>Awaiting your approval.</strong> Open this run&rsquo;s Mission
        view to review the mockups and approve — nothing builds until you do.
      </span>
    </div>
  );
}

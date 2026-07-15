/*
 * DesignGatePanel — the paused-at-design-gate affordance on the
 * SingleSessionRunCard (FR-01.45, AC1/AC2/AC5).
 *
 * Rendered ONLY when `useDesignGate(...).active` (server: paused_human_gate at
 * the design phase task AND the emitted viewer exists). Shows a paused note + a
 * "Review mockups" button that opens the full-bleed <MockupReviewOverlay>. After
 * feedback is saved it hints that the (existing) Resume CTA on the card will
 * apply it — the webui runs no orchestrator.py; Resume re-enters the master loop
 * which reads the feedback and revises / finalizes (AC5).
 */

import { useState } from "react";
import { AlertTriangle, MonitorPlay } from "lucide-react";

import { MockupReviewOverlay } from "./MockupReviewOverlay";

export function DesignGatePanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [savedRound, setSavedRound] = useState<number | null>(null);

  return (
    <div
      data-testid="design-gate-panel"
      className="flex flex-col gap-1.5 rounded-[var(--radius-button,8px)] border border-[var(--warn-line)] bg-warn-tint px-2.5 py-2"
    >
      <div className="flex items-start gap-2 text-[11px] text-warn">
        <AlertTriangle size={12} className="mt-[2px] shrink-0" />
        <span>
          Design paused for your review. Open the mockups, submit feedback, then
          press <strong>Resume</strong> below to apply it.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="design-gate-review-button"
          className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--warn-line)] bg-white px-2.5 py-1 text-[12px] font-medium text-warn transition-colors hover:bg-warn-tint"
        >
          <MonitorPlay size={13} />
          Review mockups
        </button>

        {savedRound !== null && (
          <span
            data-testid="design-gate-saved-hint"
            className="text-[11px] font-medium text-ok"
          >
            Round {savedRound} feedback saved — press Resume to apply.
          </span>
        )}
      </div>

      <MockupReviewOverlay
        open={open}
        onOpenChange={setOpen}
        projectId={projectId}
        onFeedbackSaved={setSavedRound}
      />
    </div>
  );
}

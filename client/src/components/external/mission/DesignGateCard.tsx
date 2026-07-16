/*
 * DesignGateCard — the design gate AS the Mission middle card (FR-01.58, A14).
 *
 * The design gate stops being a foreign screen: it renders in A13's `MissionBody`
 * (Record rail `now` at the Design node + artifact panel — A11, unchanged) as
 * A12's middle `.mc-op` slot in `designgate` mode. A12's `OperationCard` routes
 * here; there is NO new page, route, header, or glass recipe (AC1) — the card is
 * A12's existing `.mc-op` white-glass shell, its body swapped for the gallery +
 * decision bar.
 *
 * Read-only observer (AC2, DO-NOT #12): the gate WRITES nothing to
 * `run_loop_state.json`, `shipwright_run_config.json`, or Claude's JSONL. The
 * only write anywhere in this subtree is the transient, gitignored
 * `design-feedback-round{N}.md`, produced by the EXISTING `feedback-write.ts`
 * (round derived from disk) when the reused <MockupReviewOverlay> exports
 * feedback. Approve routes through the existing resume/CTA launch path.
 *
 * The gate is a DERIVED view of disk state, never a latched mode: when the poll
 * (`useDesignGate` via `useMissionState`) sees `paused_human_gate` cleared,
 * `OperationCard` stops routing here and Mission returns to A12 on its own (AC6).
 */

import { useState } from "react";

import type { ExternalTask } from "../../../lib/externalApi";
import { MockupReviewOverlay } from "../MockupReviewOverlay";
import { DesignGateGallery } from "./DesignGateGallery";
import { DesignGateDecision } from "./DesignGateDecision";

interface Props {
  task: ExternalTask;
}

export function DesignGateCard({ task }: Props) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [savedRound, setSavedRound] = useState<number | null>(null);

  return (
    <section
      className="mc-op"
      data-testid="design-gate-card"
      data-state="designgate"
    >
      <DesignGateGallery
        projectId={task.projectId}
        onOpenPreview={() => setReviewOpen(true)}
      />
      <DesignGateDecision
        task={task}
        onRequestChanges={() => setReviewOpen(true)}
        savedRound={savedRound}
      />

      {/* The shared review viewer — real hosted previews + the disk-derived
          round feedback write (feedback-write.ts). Reused verbatim from the
          former board-card gate surface. */}
      <MockupReviewOverlay
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        projectId={task.projectId}
        onFeedbackSaved={setSavedRound}
      />
    </section>
  );
}

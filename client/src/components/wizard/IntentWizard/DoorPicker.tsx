/*
 * DoorPicker — step 0 of the wizard (A08). The wizard heading + StepDots framing
 * over the shared <DoorGrid> (the three canonical First-Contact doors, the
 * "Register a project manually…" line, and the readiness GATE).
 *
 * The doors + gate live in DoorGrid so the wizard picker and the First Contact
 * hero (FirstContact) render them from ONE source (iterate-2026-07-23-first-
 * contact-hero). This component supplies only the wizard's own step chrome.
 */

import { DoorGrid } from "./DoorGrid";
import { StepDots } from "./StepDots";
import type { ReadinessState } from "./useReadiness";
import type { WizardDoor } from "./types";

export function DoorPicker({
  readiness,
  onPickDoor,
}: {
  readiness: ReadinessState;
  onPickDoor: (door: WizardDoor) => void;
}) {
  return (
    <div className="wz-left" data-testid="wizard-door-picker">
      <div style={{ width: "100%", maxWidth: 560, margin: "0 auto" }}>
        <StepDots total={5} current={0} />
        <h1 className="wz-q">What do you want to do?</h1>
        <div className="wz-hint">One question per screen. Plain words. Smart defaults already picked.</div>
        <DoorGrid readiness={readiness} onPickDoor={onPickDoor} />
      </div>
    </div>
  );
}

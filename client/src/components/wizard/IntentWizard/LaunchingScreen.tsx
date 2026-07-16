/*
 * LaunchingScreen — the transient state between a wizard "Go" and Mission
 * (A09a). While the create → task → launch round-trip is in flight the wizard
 * shows this honest hand-off screen; on success the wizard NAVIGATES to
 * /tasks/:id (this screen unmounts), so the only lingering render is a
 * launch-failed one, which names what broke and offers a way back.
 *
 * Webui spawns no Claude (Architecture rule 1) — the command was built
 * server-side and will auto-execute in the embedded terminal after we land.
 */

import { Loader2, AlertTriangle } from "lucide-react";

import { StepDots } from "./StepDots";
import { WzOutline, WzPrimary } from "./buttons";
import type { WizardDoor } from "./types";

const RUN_LABEL: Record<Exclude<WizardDoor, "grade">, string> = {
  new: "/shipwright-run",
  adopt: "/shipwright-adopt",
};

export function LaunchingScreen({
  door,
  failed,
  error,
  onBack,
  onRetry,
}: {
  door: Exclude<WizardDoor, "grade">;
  failed: boolean;
  error?: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  const plugin = RUN_LABEL[door];

  if (failed) {
    return (
      <div className="wz-left wz-block" data-testid="wizard-launch-failed">
        <StepDots total={5} current={5} />
        <h2 className="wz-q wz-q-sub">
          <AlertTriangle size={22} style={{ color: "var(--warn)", verticalAlign: "-3px" }} /> That didn’t start.
        </h2>
        <div className="wz-hint" style={{ maxWidth: 620 }}>
          I couldn’t hand this to {plugin}. Your answers are still here — “Try again” re-runs the same request. If a run
          was already created, you’ll also find it on the board.
          {error ? (
            <span data-testid="wizard-launch-error" className="mono" style={{ display: "block", marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
              {error}
            </span>
          ) : null}
        </div>
        <div className="wz-foot">
          <WzOutline data-testid="wizard-launch-back" onClick={onBack}>
            Back
          </WzOutline>
          <WzPrimary data-testid="wizard-launch-retry" onClick={onRetry}>
            Try again
          </WzPrimary>
        </div>
      </div>
    );
  }

  return (
    <div className="wz-left wz-block" data-testid="wizard-launching">
      <StepDots total={5} current={5} />
      <h2 className="wz-q wz-q-sub">
        <Loader2 className="iw-spin" size={20} style={{ color: "var(--accent)", verticalAlign: "-3px" }} /> Handing it to {plugin}…
      </h2>
      <div className="wz-hint" style={{ maxWidth: 620 }}>
        Setting up your project and starting the run in a terminal. This takes a moment — I’m building the exact command
        the embedded terminal will run for you.
      </div>
    </div>
  );
}

/*
 * NewPathPlanCard — "Here's what I understood." (A08). The 7 pipeline phases in
 * plain language + the final Go. A08 is UI-only, so Go is not yet wired to a real
 * /shipwright-run launch (that is A09) — it is presented as the not-yet-live
 * hand-off, never as a token already spent.
 */

import { Play } from "lucide-react";

import { planPhases, profileFor } from "./stubData";
import { StepDots } from "./StepDots";
import { WzPrimary, WzOutline } from "./buttons";
import type { WizardAction } from "./wizardState";
import type { NewAnswers } from "./types";

export function NewPathPlanCard({
  answers,
  dispatch,
}: {
  answers: NewAnswers;
  dispatch: (a: WizardAction) => void;
}) {
  const p = profileFor(answers);
  const phases = planPhases(answers);

  return (
    <div className="wz-left wz-block" data-testid="wizard-plan-card">
      <StepDots total={5} current={5} />
      <h2 className="wz-q wz-q-sub">Here’s what I understood.</h2>
      <div className="wz-hint">
        {answers.brief || "Your idea"} — for <b>{answers.who || "you"}</b>, on the <b>{p.name}</b> stack ({p.note}).
      </div>

      <div
        style={{
          maxWidth: 620,
          background: "var(--card)",
          border: "1px solid var(--line-card)",
          borderRadius: 16,
          boxShadow: "var(--sh-card)",
          padding: "8px 18px",
        }}
      >
        {phases.map((ph) => (
          <div
            key={ph.name}
            data-testid={`wizard-phase-${ph.name}`}
            style={{
              padding: "12px 0",
              borderTop: "1px solid var(--line)",
              opacity: ph.skipped ? 0.55 : 1,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent-deep)" }}>{ph.name}</div>
            <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5, marginTop: 2 }}>{ph.desc}</div>
          </div>
        ))}
      </div>

      <div className="wz-foot">
        <WzOutline data-testid="wizard-back" onClick={() => dispatch({ t: "back" })}>
          Back
        </WzOutline>
        <WzPrimary data-testid="wizard-go" disabled>
          <Play size={15} /> Go — build it
        </WzPrimary>
      </div>
      <div
        data-testid="wizard-plan-provenance"
        style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 14, maxWidth: 620 }}
      >
        Preview only — building isn’t wired up yet. The next step hands these answers to
        /shipwright-run as a brief; it waits for your “Go” before spending a token.
      </div>
    </div>
  );
}

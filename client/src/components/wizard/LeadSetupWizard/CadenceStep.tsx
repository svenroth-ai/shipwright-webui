/*
 * Question 4 — cadence + "wake on answer". `triggers.on` always carries
 * `chat_session_ended` as the baseline (the daemon's min-1 contract); the
 * toggle here additionally adds `answer_received` so a card reply wakes the
 * lead immediately instead of waiting for the next scheduled pass.
 */
import { StepDots } from "../IntentWizard/StepDots";
import { WzPrimary, WzOutline } from "../IntentWizard/buttons";
import { CADENCE_OPTIONS } from "./types";
import type { LeadSetupAction } from "./leadWizardState";
import type { LeadSetupAnswers } from "./types";
import { TOTAL_STEPS } from "./types";

export function CadenceStep({
  answers,
  dispatch,
}: {
  answers: LeadSetupAnswers;
  dispatch: (a: LeadSetupAction) => void;
}) {
  const canNext = !!answers.cadenceKey;

  return (
    <div className="wz-left" data-testid="lead-wizard-step-cadence">
      <StepDots total={TOTAL_STEPS} current={4} />
      <h2 className="wz-q">How often should this lead check in?</h2>
      <div className="wz-hint">
        This sets how often the lead wakes up on its own schedule, independent of any card activity.
      </div>

      <div className="wz-opts">
        {CADENCE_OPTIONS.map((c) => (
          <button
            type="button"
            key={c.key}
            className={answers.cadenceKey === c.key ? "wz-opt sel" : "wz-opt"}
            data-testid="lead-wizard-cadence-opt"
            onClick={() => dispatch({ t: "setCadence", cadenceKey: c.key })}
          >
            <div className="ol">{c.label}</div>
          </button>
        ))}
      </div>

      <label className="wz-checkbox-label" htmlFor="lead-wizard-wake-on-answer">
        <input
          id="lead-wizard-wake-on-answer"
          type="checkbox"
          data-testid="lead-wizard-wake-on-answer"
          checked={answers.wakeOnAnswer}
          onChange={(e) => dispatch({ t: "setWakeOnAnswer", wakeOnAnswer: e.target.checked })}
        />
        Also wake up as soon as someone answers a card
      </label>

      <div className="wz-foot">
        <WzOutline data-testid="lead-wizard-back" onClick={() => dispatch({ t: "back" })}>
          Back
        </WzOutline>
        <WzPrimary
          data-testid="lead-wizard-next"
          disabled={!canNext}
          onClick={() => dispatch({ t: "next" })}
        >
          Next
        </WzPrimary>
      </div>
    </div>
  );
}

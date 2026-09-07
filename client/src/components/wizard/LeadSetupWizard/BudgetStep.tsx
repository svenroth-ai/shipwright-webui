/*
 * Question 5 — weekly budget cap + pause/hard-stop fractions. `budget.window`
 * is always `"rolling-7d"` (fixed convention, not asked).
 */
import { StepDots } from "../IntentWizard/StepDots";
import { WzPrimary, WzOutline } from "../IntentWizard/buttons";
import type { LeadSetupAction } from "./leadWizardState";
import type { LeadSetupAnswers } from "./types";
import { TOTAL_STEPS } from "./types";

function isFraction(v: string): boolean {
  const n = Number(v);
  return v.trim().length > 0 && Number.isFinite(n) && n > 0 && n <= 1;
}

export function BudgetStep({
  answers,
  dispatch,
}: {
  answers: LeadSetupAnswers;
  dispatch: (a: LeadSetupAction) => void;
}) {
  const budgetValid = !!answers.budgetUsd && Number(answers.budgetUsd) > 0;
  const pauseValid = isFraction(answers.pauseAt);
  const hardStopValid = isFraction(answers.hardStopAt) && Number(answers.hardStopAt) >= Number(answers.pauseAt);
  const canNext = budgetValid && pauseValid && hardStopValid;

  return (
    <div className="wz-left" data-testid="lead-wizard-step-budget">
      <StepDots total={TOTAL_STEPS} current={5} />
      <h2 className="wz-q">What's this lead's weekly spending cap?</h2>
      <div className="wz-hint">
        A rolling 7-day cap. Below the pause point the lead runs normally; between pause and hard-stop it
        pauses and asks the PO; past hard-stop it stops entirely until the window rolls over.
      </div>

      <label className="wz-field-label" htmlFor="lead-wizard-budget-usd">
        Weekly cap (USD)
      </label>
      <input
        id="lead-wizard-budget-usd"
        className="wz-input"
        data-testid="lead-wizard-budget-usd"
        placeholder="50"
        inputMode="decimal"
        value={answers.budgetUsd ?? ""}
        onChange={(e) => dispatch({ t: "setBudgetUsd", budgetUsd: e.target.value })}
      />

      <label className="wz-field-label" htmlFor="lead-wizard-pause-at">
        Pause fraction (0–1)
      </label>
      <input
        id="lead-wizard-pause-at"
        className="wz-input"
        data-testid="lead-wizard-pause-at"
        value={answers.pauseAt}
        onChange={(e) => dispatch({ t: "setPauseAt", pauseAt: e.target.value })}
      />

      <label className="wz-field-label" htmlFor="lead-wizard-hard-stop-at">
        Hard-stop fraction (0–1)
      </label>
      <input
        id="lead-wizard-hard-stop-at"
        className="wz-input"
        data-testid="lead-wizard-hard-stop-at"
        value={answers.hardStopAt}
        onChange={(e) => dispatch({ t: "setHardStopAt", hardStopAt: e.target.value })}
      />
      {answers.hardStopAt && pauseValid && !hardStopValid ? (
        <div className="wz-hint" data-testid="lead-wizard-hard-stop-invalid">
          Hard-stop must be at or above the pause fraction.
        </div>
      ) : null}

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

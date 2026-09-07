/*
 * Question 6 — authority. The 4 band headings are fixed structural constants
 * (never deletable/renamable in this UI); only the body text per band is
 * editable. `max_concurrent_tasks` and `model` ride along here as small
 * editable fields — closest thematic fit, not worth their own screens.
 */
import { StepDots } from "../IntentWizard/StepDots";
import { WzPrimary, WzOutline } from "../IntentWizard/buttons";
import { AUTHORITY_BAND_HEADINGS } from "./types";
import type { LeadModel } from "./types";
import type { LeadSetupAction } from "./leadWizardState";
import type { LeadSetupAnswers } from "./types";
import { TOTAL_STEPS } from "./types";

const MODELS: LeadModel[] = ["fast", "balanced", "deep"];

function isPositiveInteger(v: string): boolean {
  const n = Number(v);
  return v.trim().length > 0 && Number.isInteger(n) && n > 0;
}

export function AuthorityStep({
  answers,
  dispatch,
}: {
  answers: LeadSetupAnswers;
  dispatch: (a: LeadSetupAction) => void;
}) {
  const maxConcurrentValid = isPositiveInteger(answers.maxConcurrentTasks);
  const canNext =
    AUTHORITY_BAND_HEADINGS.some((h) => answers.authorityBands[h].trim().length > 0) && maxConcurrentValid;

  return (
    <div className="wz-left" data-testid="lead-wizard-step-authority">
      <StepDots total={TOTAL_STEPS} current={6} />
      <h2 className="wz-q">What can this lead decide on its own?</h2>
      <div className="wz-hint">
        These four bands are fixed — only what you write under each one changes.
      </div>

      {AUTHORITY_BAND_HEADINGS.map((heading) => (
        <div key={heading}>
          <label className="wz-field-label" htmlFor={`lead-wizard-authority-${heading}`}>
            {heading}
          </label>
          <textarea
            id={`lead-wizard-authority-${heading}`}
            className="wz-input"
            data-testid="lead-wizard-authority-band"
            value={answers.authorityBands[heading]}
            onChange={(e) => dispatch({ t: "setAuthorityBand", heading, text: e.target.value })}
          />
        </div>
      ))}

      <label className="wz-field-label" htmlFor="lead-wizard-max-concurrent">
        Max concurrent tasks
      </label>
      <input
        id="lead-wizard-max-concurrent"
        className="wz-input"
        data-testid="lead-wizard-max-concurrent"
        value={answers.maxConcurrentTasks}
        onChange={(e) => dispatch({ t: "setMaxConcurrentTasks", maxConcurrentTasks: e.target.value })}
      />
      {answers.maxConcurrentTasks && !maxConcurrentValid ? (
        <div className="wz-hint" data-testid="lead-wizard-max-concurrent-invalid">
          Must be a whole number greater than 0.
        </div>
      ) : null}

      <label className="wz-field-label" htmlFor="lead-wizard-model">
        Model
      </label>
      <select
        id="lead-wizard-model"
        className="wz-input"
        data-testid="lead-wizard-model"
        value={answers.model}
        onChange={(e) => dispatch({ t: "setModel", model: e.target.value as LeadModel })}
      >
        {MODELS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

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

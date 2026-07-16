/*
 * NewPathQuestions — the four plain-language questions (A08), one per screen,
 * with example chips + smart defaults. No jargon appears before the plan card.
 */

import { QUESTIONS } from "./stubData";
import { StepDots } from "./StepDots";
import { WzPrimary, WzOutline } from "./buttons";
import type { WizardAction } from "./wizardState";
import type { NewAnswers } from "./types";

export function NewPathQuestions({
  step,
  answers,
  dispatch,
}: {
  step: number;
  answers: NewAnswers;
  dispatch: (a: WizardAction) => void;
}) {
  const q = QUESTIONS[step - 1];
  const canNext = q.type === "text" ? true : !!answers[q.k];

  return (
    <div className="wz-left" data-testid={`wizard-question-${q.k}`}>
      <StepDots total={5} current={step} />
      <h2 className="wz-q">{q.q}</h2>
      <div className="wz-hint">{q.hint}</div>

      {q.type === "text" ? (
        <>
          <textarea
            className="wz-input"
            data-testid="wizard-brief-input"
            placeholder="Type it here…"
            value={answers.brief ?? ""}
            onChange={(e) => dispatch({ t: "setBrief", text: e.target.value })}
          />
          <div className="wz-chips">
            {(q.chips ?? []).map((c) => (
              <button
                type="button"
                key={c}
                className="wz-chip"
                data-testid="wizard-brief-chip"
                onClick={() => dispatch({ t: "chip", text: c })}
              >
                {c}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="wz-opts">
          {(q.opts ?? []).map((o) => (
            <button
              type="button"
              key={o}
              className={answers[q.k] === o ? "wz-opt sel" : "wz-opt"}
              data-testid={`wizard-opt-${q.k}`}
              onClick={() => dispatch({ t: "answer", k: q.k as "who" | "remember" | "where", v: o })}
            >
              <div>
                <div className="ol">{o}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="wz-foot">
        <WzOutline data-testid="wizard-back" onClick={() => dispatch({ t: "back" })}>
          Back
        </WzOutline>
        <WzPrimary data-testid="wizard-next" disabled={!canNext} onClick={() => dispatch({ t: "next" })}>
          {step === 4 ? "See the plan" : "Next"}
        </WzPrimary>
      </div>
    </div>
  );
}

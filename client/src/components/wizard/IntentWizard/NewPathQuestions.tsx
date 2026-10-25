/*
 * NewPathQuestions — the four plain-language questions (A08), one per screen,
 * with example chips + smart defaults. No jargon appears before the plan card.
 */

import type { QuestionDef } from "./stubData";
import { StepDots } from "./StepDots";
import { WzPrimary, WzOutline } from "./buttons";
import type { WizardAction } from "./wizardState";
import type { CustomProfileChoice, NewAnswers } from "./types";

/** The stack question's "no own profile" choice — clears `answers.profile`. */
export const DERIVE_OPTION = "I’m new — guide me";

export function NewPathQuestions({
  step,
  questions,
  customProfiles = [],
  answers,
  dispatch,
}: {
  step: number;
  /** This run's questions (see `activeQuestions`). */
  questions: QuestionDef[];
  customProfiles?: CustomProfileChoice[];
  answers: NewAnswers;
  dispatch: (a: WizardAction) => void;
}) {
  const q = questions[step - 1];
  const isStack = q.k === "profile";
  // The stack question always has an answer: the default is "work it out".
  const canNext = q.type === "text" || isStack ? true : !!answers[q.k];

  return (
    <div className="wz-left" data-testid={`wizard-question-${q.k}`}>
      <StepDots total={questions.length + 1} current={step} />
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
      ) : isStack ? (
        <div className="wz-opts" data-testid="wizard-stack-options">
          {customProfiles.map((c) => (
            <button
              type="button"
              key={c.name}
              disabled={!c.valid}
              className={answers.profile === c.name ? "wz-opt sel" : "wz-opt"}
              data-testid={`wizard-stack-${c.name}`}
              onClick={() => dispatch({ t: "setProfile", name: c.name })}
            >
              <div>
                <div className="ol">{c.name}</div>
                {c.valid ? (
                  <div className="wz-hint">Your saved tech stack{c.description ? ` — ${c.description}` : ""}</div>
                ) : (
                  <div className="wz-hint" data-testid={`wizard-stack-invalid-${c.name}`}>
                    ⚠ Can’t be used yet: {c.error}
                  </div>
                )}
              </div>
            </button>
          ))}
          <button
            type="button"
            className={answers.profile ? "wz-opt" : "wz-opt sel"}
            data-testid="wizard-stack-derive"
            onClick={() => dispatch({ t: "setProfile", name: null })}
          >
            <div>
              <div className="ol">{DERIVE_OPTION}</div>
              <div className="wz-hint">I’ll ask a few plain questions and choose a sensible stack for you.</div>
            </div>
          </button>
        </div>
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
          {step === questions.length ? "See the plan" : "Next"}
        </WzPrimary>
      </div>
    </div>
  );
}

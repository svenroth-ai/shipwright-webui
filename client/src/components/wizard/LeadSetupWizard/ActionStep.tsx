/*
 * Question 3 — which action this lead runs. Fills `leadActionIds` (the
 * action id) and `allowed_skills` from `action.slash_command` DIRECTLY —
 * never derived from `action.id` (external-review finding: guessing risks
 * naming a skill that doesn't exist or isn't authorized for this lead). An
 * action with no `slash_command` on the wire can't be selected here.
 */
import { useProjectActions } from "../../../hooks/useProjectActions";
import { StepDots } from "../IntentWizard/StepDots";
import { WzPrimary, WzOutline } from "../IntentWizard/buttons";
import type { LeadSetupAction } from "./leadWizardState";
import type { LeadSetupAnswers } from "./types";
import { TOTAL_STEPS } from "./types";

export function ActionStep({
  answers,
  dispatch,
}: {
  answers: LeadSetupAnswers;
  dispatch: (a: LeadSetupAction) => void;
}) {
  const projectActions = useProjectActions(answers.projectId);
  const canNext = !!answers.actionId && !!answers.slashCommand;

  return (
    <div className="wz-left" data-testid="lead-wizard-step-action">
      <StepDots total={TOTAL_STEPS} current={3} />
      <h2 className="wz-q">What should this lead run on each pass?</h2>
      <div className="wz-hint">Only actions with a defined slash command can be assigned to a lead.</div>

      {projectActions.isLoading ? (
        <div data-testid="lead-wizard-action-loading">Loading actions…</div>
      ) : null}

      <div className="wz-opts">
        {(projectActions.data?.actions ?? []).map((a) => {
          const usable = !!a.slash_command;
          return (
            <button
              type="button"
              key={a.id}
              disabled={!usable}
              className={answers.actionId === a.id ? "wz-opt sel" : "wz-opt"}
              data-testid="lead-wizard-action-opt"
              onClick={() =>
                usable && dispatch({ t: "setAction", actionId: a.id, slashCommand: a.slash_command! })
              }
            >
              <div>
                <div className="ol">{a.label}</div>
                <div className="wz-hint">
                  {usable ? a.slash_command : "No slash command defined — can't be assigned to a lead."}
                </div>
              </div>
            </button>
          );
        })}
      </div>

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

/*
 * Question 2 — which project this lead watches. One selection fills BOTH
 * `projects` (the id) and `leadProjectRoots` (the project's absolute path)
 * — the card's explicit "no typing a project id/path" requirement.
 */
import { useProjects } from "../../../hooks/useProjects";
import { StepDots } from "../IntentWizard/StepDots";
import { WzPrimary, WzOutline } from "../IntentWizard/buttons";
import type { LeadSetupAction } from "./leadWizardState";
import type { LeadSetupAnswers } from "./types";
import { TOTAL_STEPS } from "./types";

export function ProjectStep({
  answers,
  dispatch,
}: {
  answers: LeadSetupAnswers;
  dispatch: (a: LeadSetupAction) => void;
}) {
  const projects = useProjects();
  const canNext = !!answers.projectId && !!answers.projectPath;

  return (
    <div className="wz-left" data-testid="lead-wizard-step-project">
      <StepDots total={TOTAL_STEPS} current={2} />
      <h2 className="wz-q">Which project should this lead work in?</h2>
      <div className="wz-hint">
        Picking a project fills in both its id and its file path — you never type either by hand.
      </div>

      {projects.isLoading ? <div data-testid="lead-wizard-project-loading">Loading projects…</div> : null}
      {projects.isError ? (
        <div data-testid="lead-wizard-project-error">Could not load your projects. Try again.</div>
      ) : null}

      <div className="wz-opts">
        {(projects.data ?? []).map((p) => (
          <button
            type="button"
            key={p.id}
            className={answers.projectId === p.id ? "wz-opt sel" : "wz-opt"}
            data-testid="lead-wizard-project-opt"
            onClick={() =>
              dispatch({ t: "setProject", projectId: p.id, projectName: p.name, projectPath: p.path })
            }
          >
            <div>
              <div className="ol">{p.name}</div>
              <div className="wz-hint">{p.path}</div>
            </div>
          </button>
        ))}
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

/*
 * LeadSetupWizard — the orchestrator (W14). Same shell as IntentWizard: one
 * reducer, one flight-plan rail, a step body switch — but its own reducer
 * and its own 7 questions + verdict step, because the domain genuinely
 * differs from IntentWizard's task-launch flow.
 */
import { useReducer } from "react";

import { FlightPlanRail } from "../IntentWizard/FlightPlanRail";
import { NameIdDomainStep } from "./NameIdDomainStep";
import { ProjectStep } from "./ProjectStep";
import { ActionStep } from "./ActionStep";
import { CadenceStep } from "./CadenceStep";
import { BudgetStep } from "./BudgetStep";
import { AuthorityStep } from "./AuthorityStep";
import { EscalationStep } from "./EscalationStep";
import { VerdictStep } from "./VerdictStep";
import { INITIAL_LEAD_SETUP_STATE, deriveLeadRows, leadSetupReducer } from "./leadWizardState";

export function LeadSetupWizard() {
  const [state, dispatch] = useReducer(leadSetupReducer, INITIAL_LEAD_SETUP_STATE);
  const rows = deriveLeadRows(state);

  let body: React.ReactNode;
  switch (state.step) {
    case 1:
      body = <NameIdDomainStep answers={state.answers} dispatch={dispatch} />;
      break;
    case 2:
      body = <ProjectStep answers={state.answers} dispatch={dispatch} />;
      break;
    case 3:
      body = <ActionStep answers={state.answers} dispatch={dispatch} />;
      break;
    case 4:
      body = <CadenceStep answers={state.answers} dispatch={dispatch} />;
      break;
    case 5:
      body = <BudgetStep answers={state.answers} dispatch={dispatch} />;
      break;
    case 6:
      body = <AuthorityStep answers={state.answers} dispatch={dispatch} />;
      break;
    case 7:
      body = <EscalationStep answers={state.answers} dispatch={dispatch} />;
      break;
    default:
      body = <VerdictStep answers={state.answers} dispatch={dispatch} />;
  }

  return (
    <div className="wz" data-testid="lead-setup-wizard">
      {body}
      <FlightPlanRail rows={rows} />
    </div>
  );
}

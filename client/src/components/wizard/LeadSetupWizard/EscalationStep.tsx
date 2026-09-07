/*
 * Question 7 — escalation target. Either the PO (from the org chart's `po`
 * field) or another existing lead — never free text, so `escalation_target`
 * always names something real.
 */
import { useOrgChart } from "../../../hooks/useOrgChart";
import { StepDots } from "../IntentWizard/StepDots";
import { WzPrimary, WzOutline } from "../IntentWizard/buttons";
import type { LeadSetupAction } from "./leadWizardState";
import type { LeadSetupAnswers } from "./types";
import { TOTAL_STEPS } from "./types";

export function EscalationStep({
  answers,
  dispatch,
}: {
  answers: LeadSetupAnswers;
  dispatch: (a: LeadSetupAction) => void;
}) {
  const orgChart = useOrgChart();
  const canNext = !!answers.escalationTarget;
  const po = orgChart.data?.po;
  const leadEntries = Object.entries(orgChart.data?.leads ?? {});

  return (
    <div className="wz-left" data-testid="lead-wizard-step-escalation">
      <StepDots total={TOTAL_STEPS} current={7} />
      <h2 className="wz-q">Who should this lead escalate to when it's stuck?</h2>
      <div className="wz-hint">The PO, or another lead already on the org chart.</div>

      <div className="wz-opts">
        {po ? (
          <button
            type="button"
            className={answers.escalationTarget === po ? "wz-opt sel" : "wz-opt"}
            data-testid="lead-wizard-escalation-opt"
            onClick={() => dispatch({ t: "setEscalationTarget", escalationTarget: po })}
          >
            <div className="ol">{po} (PO)</div>
          </button>
        ) : null}
        {leadEntries.map(([id, lead]) => (
          <button
            type="button"
            key={id}
            className={answers.escalationTarget === id ? "wz-opt sel" : "wz-opt"}
            data-testid="lead-wizard-escalation-opt"
            onClick={() => dispatch({ t: "setEscalationTarget", escalationTarget: id })}
          >
            <div className="ol">{lead.name}</div>
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
          Review
        </WzPrimary>
      </div>
    </div>
  );
}

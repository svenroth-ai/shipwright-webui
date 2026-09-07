/*
 * Question 1 — name + lead id + domain. Three separate fields (and three
 * separate flight-plan rows, per `deriveLeadRows`) even though a user will
 * often type the same word into id and domain — they answer different
 * questions (folder/charter path vs. which cards route here).
 */
import { StepDots } from "../IntentWizard/StepDots";
import { WzPrimary } from "../IntentWizard/buttons";
import { DomainSelect } from "../../common/DomainSelect";
import { useDomainVocabulary } from "../../../hooks/useDomainVocabulary";
import { LEAD_ID_RE } from "../../../lib/leadSetupWizardApi";
import type { LeadSetupAction } from "./leadWizardState";
import type { LeadSetupAnswers } from "./types";
import { TOTAL_STEPS } from "./types";

export function NameIdDomainStep({
  answers,
  dispatch,
}: {
  answers: LeadSetupAnswers;
  dispatch: (a: LeadSetupAction) => void;
}) {
  const domainVocabulary = useDomainVocabulary();
  const leadIdValid = !!answers.leadId && LEAD_ID_RE.test(answers.leadId);
  const canNext = !!answers.name?.trim() && leadIdValid && !!answers.domain;

  return (
    <div className="wz-left" data-testid="lead-wizard-step-name-id-domain">
      <StepDots total={TOTAL_STEPS} current={1} />
      <h2 className="wz-q">What should this lead be called, and what does it watch?</h2>
      <div className="wz-hint">
        The name is just a label. The lead ID becomes its folder name and charter path — lowercase,
        hyphens only. The domain decides which cards this lead is offered.
      </div>

      <label className="wz-field-label" htmlFor="lead-wizard-name-input">
        Name
      </label>
      <input
        id="lead-wizard-name-input"
        className="wz-input"
        data-testid="lead-wizard-name-input"
        placeholder="Billing Lead"
        value={answers.name ?? ""}
        onChange={(e) => dispatch({ t: "setName", name: e.target.value })}
      />

      <label className="wz-field-label" htmlFor="lead-wizard-id-input">
        Lead ID
      </label>
      <input
        id="lead-wizard-id-input"
        className="wz-input"
        data-testid="lead-wizard-id-input"
        placeholder="billing-lead"
        value={answers.leadId ?? ""}
        onChange={(e) => dispatch({ t: "setLeadId", leadId: e.target.value })}
      />
      {answers.leadId && !leadIdValid ? (
        <div className="wz-hint" data-testid="lead-wizard-id-invalid">
          Lowercase letters, numbers, and hyphens only — must start with a letter or number.
        </div>
      ) : null}

      <label className="wz-field-label" htmlFor="lead-wizard-domain-select">
        Domain
      </label>
      <DomainSelect
        value={answers.domain ?? ""}
        onChange={(domain) => dispatch({ t: "setDomain", domain })}
        domains={domainVocabulary.data?.domains ?? []}
        unclaimedCounts={domainVocabulary.data?.unclaimedCounts}
        className="wz-input"
        createInputClassName="wz-input"
        testIdPrefix="lead-wizard-domain-select"
        unavailable={domainVocabulary.isError}
      />

      <div className="wz-foot">
        {/* Step 1 is the first question — nothing to go back to. */}
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

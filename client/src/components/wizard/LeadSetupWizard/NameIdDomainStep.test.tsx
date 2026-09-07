/*
 * NameIdDomainStep.test.tsx — CI diff-coverage gap fix (Diff coverage gate,
 * iterate-2026-09-07-leadwright-setup-wizard). `useDomainVocabulary` is
 * mocked directly; `DomainSelect` renders for real (already fully covered).
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { NameIdDomainStep } from "./NameIdDomainStep";
import { useDomainVocabulary } from "../../../hooks/useDomainVocabulary";
import { INITIAL_ANSWERS } from "./types";
import type { LeadSetupAnswers } from "./types";

vi.mock("../../../hooks/useDomainVocabulary");
const mockedVocabulary = vi.mocked(useDomainVocabulary);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderStep(answers: LeadSetupAnswers = INITIAL_ANSWERS, dispatch = vi.fn()) {
  render(<NameIdDomainStep answers={answers} dispatch={dispatch} />);
  return dispatch;
}

describe("NameIdDomainStep", () => {
  it("Next is disabled with all fields empty", () => {
    mockedVocabulary.mockReturnValue({ data: undefined, isError: false } as never);
    renderStep();
    expect(screen.getByTestId("lead-wizard-next")).toBeDisabled();
  });

  it("dispatches setName and setLeadId on input", () => {
    mockedVocabulary.mockReturnValue({ data: undefined, isError: false } as never);
    const dispatch = renderStep();
    fireEvent.change(screen.getByTestId("lead-wizard-name-input"), { target: { value: "Billing Lead" } });
    expect(dispatch).toHaveBeenCalledWith({ t: "setName", name: "Billing Lead" });
    fireEvent.change(screen.getByTestId("lead-wizard-id-input"), { target: { value: "billing-lead" } });
    expect(dispatch).toHaveBeenCalledWith({ t: "setLeadId", leadId: "billing-lead" });
  });

  it("flags an invalid lead id (uppercase) and blocks Next", () => {
    mockedVocabulary.mockReturnValue({ data: undefined, isError: false } as never);
    renderStep({ ...INITIAL_ANSWERS, name: "Billing Lead", leadId: "Billing", domain: "billing" });
    expect(screen.getByTestId("lead-wizard-id-invalid")).toBeInTheDocument();
    expect(screen.getByTestId("lead-wizard-next")).toBeDisabled();
  });

  it("passes the fetched domain vocabulary through and enables Next once every field is valid", () => {
    mockedVocabulary.mockReturnValue({
      data: { domains: ["billing"], unclaimedCounts: { billing: 3 } },
      isError: false,
    } as never);
    const dispatch = renderStep({ ...INITIAL_ANSWERS, name: "Billing Lead", leadId: "billing-lead", domain: "billing" });
    expect(screen.getByText("billing (3 unclaimed)")).toBeInTheDocument();
    expect(screen.getByTestId("lead-wizard-next")).not.toBeDisabled();
    fireEvent.change(screen.getByTestId("lead-wizard-domain-select"), { target: { value: "billing" } });
    expect(dispatch).toHaveBeenCalledWith({ t: "setDomain", domain: "billing" });
  });

  it("degrades DomainSelect to free text when the vocabulary fetch failed", () => {
    mockedVocabulary.mockReturnValue({ data: undefined, isError: true } as never);
    renderStep();
    expect(screen.getByTestId("lead-wizard-domain-select-unavailable-input")).toBeInTheDocument();
  });
});

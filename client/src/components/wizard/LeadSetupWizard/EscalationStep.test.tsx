/*
 * EscalationStep.test.tsx — CI diff-coverage gap fix (Diff coverage gate,
 * iterate-2026-09-07-leadwright-setup-wizard). `useOrgChart` is mocked
 * directly, matching VerdictStep.test.tsx's idiom.
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { EscalationStep } from "./EscalationStep";
import { useOrgChart } from "../../../hooks/useOrgChart";
import { INITIAL_ANSWERS } from "./types";
import type { LeadSetupAnswers } from "./types";

vi.mock("../../../hooks/useOrgChart");
const mockedOrgChart = vi.mocked(useOrgChart);

function orgChartState(overrides: Partial<ReturnType<typeof useOrgChart>> = {}) {
  return { data: undefined, ...overrides } as unknown as ReturnType<typeof useOrgChart>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderStep(answers: LeadSetupAnswers = INITIAL_ANSWERS, dispatch = vi.fn()) {
  render(<EscalationStep answers={answers} dispatch={dispatch} />);
  return dispatch;
}

describe("EscalationStep", () => {
  it("renders no options and Next is disabled when the org chart has neither a PO nor leads", () => {
    mockedOrgChart.mockReturnValue(orgChartState());
    renderStep();
    expect(screen.queryByTestId("lead-wizard-escalation-opt")).toBeNull();
    expect(screen.getByTestId("lead-wizard-next")).toBeDisabled();
  });

  it("offers the PO first, labelled, and every existing lead", () => {
    mockedOrgChart.mockReturnValue(
      orgChartState({
        data: { po: "po-sven", leads: { "billing-lead": { name: "Billing Lead" } } } as never,
      }),
    );
    renderStep();
    const opts = screen.getAllByTestId("lead-wizard-escalation-opt");
    expect(opts).toHaveLength(2);
    expect(opts[0]).toHaveTextContent("po-sven (PO)");
    expect(opts[1]).toHaveTextContent("Billing Lead");
  });

  it("dispatches setEscalationTarget with the PO's id on click", () => {
    mockedOrgChart.mockReturnValue(orgChartState({ data: { po: "po-sven", leads: {} } as never }));
    const dispatch = renderStep();
    fireEvent.click(screen.getByText("po-sven (PO)"));
    expect(dispatch).toHaveBeenCalledWith({ t: "setEscalationTarget", escalationTarget: "po-sven" });
  });

  it("dispatches setEscalationTarget with the lead's id (not its display name) on click", () => {
    mockedOrgChart.mockReturnValue(
      orgChartState({ data: { po: undefined, leads: { "billing-lead": { name: "Billing Lead" } } } as never }),
    );
    const dispatch = renderStep();
    fireEvent.click(screen.getByText("Billing Lead"));
    expect(dispatch).toHaveBeenCalledWith({ t: "setEscalationTarget", escalationTarget: "billing-lead" });
  });

  it("marks the selected target and enables the Review button, and Back still dispatches back", () => {
    mockedOrgChart.mockReturnValue(orgChartState({ data: { po: "po-sven", leads: {} } as never }));
    const dispatch = renderStep({ ...INITIAL_ANSWERS, escalationTarget: "po-sven" });
    expect(screen.getByTestId("lead-wizard-escalation-opt")).toHaveClass("sel");
    expect(screen.getByTestId("lead-wizard-next")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("lead-wizard-back"));
    expect(dispatch).toHaveBeenCalledWith({ t: "back" });
  });
});

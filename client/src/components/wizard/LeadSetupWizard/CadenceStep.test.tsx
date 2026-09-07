/*
 * CadenceStep.test.tsx — CI diff-coverage gap fix (Diff coverage gate,
 * iterate-2026-09-07-leadwright-setup-wizard). No data hook — pure props.
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { CadenceStep } from "./CadenceStep";
import { CADENCE_OPTIONS, INITIAL_ANSWERS } from "./types";
import type { LeadSetupAnswers } from "./types";

afterEach(cleanup);

function renderStep(answers: LeadSetupAnswers = INITIAL_ANSWERS, dispatch = vi.fn()) {
  render(<CadenceStep answers={answers} dispatch={dispatch} />);
  return dispatch;
}

describe("CadenceStep", () => {
  it("renders every cadence option and Next is disabled with none chosen", () => {
    renderStep();
    expect(screen.getAllByTestId("lead-wizard-cadence-opt")).toHaveLength(CADENCE_OPTIONS.length);
    expect(screen.getByTestId("lead-wizard-next")).toBeDisabled();
  });

  it("dispatches setCadence on click and marks the selected option", () => {
    const dispatch = renderStep({ ...INITIAL_ANSWERS, cadenceKey: "hourly" });
    fireEvent.click(screen.getByText("Hourly"));
    expect(dispatch).toHaveBeenCalledWith({ t: "setCadence", cadenceKey: "hourly" });
    expect(screen.getByText("Hourly").closest("button")).toHaveClass("sel");
    expect(screen.getByTestId("lead-wizard-next")).not.toBeDisabled();
  });

  it("dispatches setWakeOnAnswer on the checkbox and reflects the checked state", () => {
    const dispatch = renderStep({ ...INITIAL_ANSWERS, wakeOnAnswer: true });
    expect(screen.getByTestId("lead-wizard-wake-on-answer")).toBeChecked();
    fireEvent.click(screen.getByTestId("lead-wizard-wake-on-answer"));
    expect(dispatch).toHaveBeenCalledWith({ t: "setWakeOnAnswer", wakeOnAnswer: false });
  });

  it("dispatches back", () => {
    const dispatch = renderStep();
    fireEvent.click(screen.getByTestId("lead-wizard-back"));
    expect(dispatch).toHaveBeenCalledWith({ t: "back" });
  });
});

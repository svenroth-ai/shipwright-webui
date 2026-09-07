/*
 * BudgetStep.test.tsx — CI diff-coverage gap fix (Diff coverage gate,
 * iterate-2026-09-07-leadwright-setup-wizard). No data hook — pure props +
 * local validity math (budget > 0, 0 < pause <= 1, hardStop >= pause).
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { BudgetStep } from "./BudgetStep";
import { INITIAL_ANSWERS } from "./types";
import type { LeadSetupAnswers } from "./types";

afterEach(cleanup);

function renderStep(answers: LeadSetupAnswers = INITIAL_ANSWERS, dispatch = vi.fn()) {
  render(<BudgetStep answers={answers} dispatch={dispatch} />);
  return dispatch;
}

describe("BudgetStep", () => {
  it("Next is disabled with the default empty budget", () => {
    renderStep();
    expect(screen.getByTestId("lead-wizard-next")).toBeDisabled();
  });

  it("dispatches setBudgetUsd on input", () => {
    const dispatch = renderStep();
    fireEvent.change(screen.getByTestId("lead-wizard-budget-usd"), { target: { value: "50" } });
    expect(dispatch).toHaveBeenCalledWith({ t: "setBudgetUsd", budgetUsd: "50" });
  });

  it("dispatches setPauseAt and setHardStopAt on input", () => {
    const dispatch = renderStep();
    fireEvent.change(screen.getByTestId("lead-wizard-pause-at"), { target: { value: "0.5" } });
    expect(dispatch).toHaveBeenCalledWith({ t: "setPauseAt", pauseAt: "0.5" });
    fireEvent.change(screen.getByTestId("lead-wizard-hard-stop-at"), { target: { value: "0.9" } });
    expect(dispatch).toHaveBeenCalledWith({ t: "setHardStopAt", hardStopAt: "0.9" });
  });

  it("flags a hard-stop below the pause fraction and blocks Next", () => {
    renderStep({ ...INITIAL_ANSWERS, budgetUsd: "50", pauseAt: "0.9", hardStopAt: "0.5" });
    expect(screen.getByTestId("lead-wizard-hard-stop-invalid")).toBeInTheDocument();
    expect(screen.getByTestId("lead-wizard-next")).toBeDisabled();
  });

  it("enables Next once budget, pause and hard-stop are all valid", () => {
    renderStep({ ...INITIAL_ANSWERS, budgetUsd: "50", pauseAt: "0.85", hardStopAt: "0.95" });
    expect(screen.queryByTestId("lead-wizard-hard-stop-invalid")).toBeNull();
    expect(screen.getByTestId("lead-wizard-next")).not.toBeDisabled();
  });

  it("dispatches back", () => {
    const dispatch = renderStep();
    fireEvent.click(screen.getByTestId("lead-wizard-back"));
    expect(dispatch).toHaveBeenCalledWith({ t: "back" });
  });
});

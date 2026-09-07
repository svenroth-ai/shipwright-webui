/*
 * AuthorityStep.test.tsx — CI diff-coverage gap fix (Diff coverage gate,
 * iterate-2026-09-07-leadwright-setup-wizard). No data hook — pure props +
 * local validity math (>= 1 non-empty band, max-concurrent a positive int).
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { AuthorityStep } from "./AuthorityStep";
import { AUTHORITY_BAND_HEADINGS, INITIAL_ANSWERS } from "./types";
import type { LeadSetupAnswers } from "./types";

afterEach(cleanup);

function renderStep(answers: LeadSetupAnswers = INITIAL_ANSWERS, dispatch = vi.fn()) {
  render(<AuthorityStep answers={answers} dispatch={dispatch} />);
  return dispatch;
}

describe("AuthorityStep", () => {
  it("renders every fixed band heading as a textarea, and Next is disabled with no band text", () => {
    renderStep();
    expect(screen.getAllByTestId("lead-wizard-authority-band")).toHaveLength(AUTHORITY_BAND_HEADINGS.length);
    expect(screen.getByTestId("lead-wizard-next")).toBeDisabled();
  });

  it("dispatches setAuthorityBand with the heading and typed text", () => {
    const dispatch = renderStep();
    const textarea = screen.getByLabelText("Decide alone");
    fireEvent.change(textarea, { target: { value: "Ship routine content." } });
    expect(dispatch).toHaveBeenCalledWith({
      t: "setAuthorityBand",
      heading: "Decide alone",
      text: "Ship routine content.",
    });
  });

  it("flags a non-integer max-concurrent-tasks value and blocks Next", () => {
    renderStep({
      ...INITIAL_ANSWERS,
      authorityBands: { ...INITIAL_ANSWERS.authorityBands, "Decide alone": "x" },
      maxConcurrentTasks: "abc",
    });
    expect(screen.getByTestId("lead-wizard-max-concurrent-invalid")).toBeInTheDocument();
    expect(screen.getByTestId("lead-wizard-next")).toBeDisabled();
  });

  it("dispatches setMaxConcurrentTasks on input", () => {
    const dispatch = renderStep();
    fireEvent.change(screen.getByTestId("lead-wizard-max-concurrent"), { target: { value: "3" } });
    expect(dispatch).toHaveBeenCalledWith({ t: "setMaxConcurrentTasks", maxConcurrentTasks: "3" });
  });

  it("dispatches setModel on select and enables Next once a band + valid max-concurrent are set", () => {
    const dispatch = renderStep({
      ...INITIAL_ANSWERS,
      authorityBands: { ...INITIAL_ANSWERS.authorityBands, "Decide alone": "Ship routine content." },
      maxConcurrentTasks: "2",
    });
    fireEvent.change(screen.getByTestId("lead-wizard-model"), { target: { value: "deep" } });
    expect(dispatch).toHaveBeenCalledWith({ t: "setModel", model: "deep" });
    expect(screen.getByTestId("lead-wizard-next")).not.toBeDisabled();
  });

  it("dispatches back", () => {
    const dispatch = renderStep();
    fireEvent.click(screen.getByTestId("lead-wizard-back"));
    expect(dispatch).toHaveBeenCalledWith({ t: "back" });
  });
});

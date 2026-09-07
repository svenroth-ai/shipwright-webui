/*
 * LeadSetupWizard.test.tsx — CI diff-coverage gap fix (Diff coverage gate,
 * iterate-2026-09-07-leadwright-setup-wizard). Exercises the orchestrator's
 * step switch and the FlightPlanRail wiring; each step body is mocked to a
 * thin stub identified by its own testid (real step behavior is covered by
 * each step's own test file) so this file stays about the switch, not their
 * internals.
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { LeadSetupWizard } from "./LeadSetupWizard";
import type { LeadSetupAction } from "./leadWizardState";
import type { LeadSetupAnswers } from "./types";

function stepStub(testid: string) {
  return ({ dispatch }: { answers: LeadSetupAnswers; dispatch: (a: LeadSetupAction) => void }) => (
    <button data-testid={testid} onClick={() => dispatch({ t: "next" })}>
      {testid}
    </button>
  );
}

vi.mock("./NameIdDomainStep", () => ({ NameIdDomainStep: stepStub("mock-step-1") }));
vi.mock("./ProjectStep", () => ({ ProjectStep: stepStub("mock-step-2") }));
vi.mock("./ActionStep", () => ({ ActionStep: stepStub("mock-step-3") }));
vi.mock("./CadenceStep", () => ({ CadenceStep: stepStub("mock-step-4") }));
vi.mock("./BudgetStep", () => ({ BudgetStep: stepStub("mock-step-5") }));
vi.mock("./AuthorityStep", () => ({ AuthorityStep: stepStub("mock-step-6") }));
vi.mock("./EscalationStep", () => ({ EscalationStep: stepStub("mock-step-7") }));
vi.mock("./VerdictStep", () => ({ VerdictStep: stepStub("mock-step-verdict") }));

afterEach(cleanup);

describe("LeadSetupWizard", () => {
  it("renders the wizard shell and starts on step 1", () => {
    render(<LeadSetupWizard />);
    expect(screen.getByTestId("lead-setup-wizard")).toBeInTheDocument();
    expect(screen.getByTestId("mock-step-1")).toBeInTheDocument();
  });

  it("walks the switch through every step in order via next, landing on the verdict step past 7", () => {
    render(<LeadSetupWizard />);
    for (let i = 2; i <= 7; i++) {
      fireEvent.click(screen.getByTestId(`mock-step-${i - 1}`));
      expect(screen.getByTestId(`mock-step-${i}`)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("mock-step-7"));
    expect(screen.getByTestId("mock-step-verdict")).toBeInTheDocument();
  });

  it("renders the flight-plan rail alongside the step body", () => {
    render(<LeadSetupWizard />);
    expect(document.querySelector(".wz")).not.toBeNull();
  });
});

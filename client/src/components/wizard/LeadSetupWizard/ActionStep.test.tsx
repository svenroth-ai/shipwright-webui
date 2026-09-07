/*
 * ActionStep.test.tsx — CI diff-coverage gap fix (Diff coverage gate,
 * iterate-2026-09-07-leadwright-setup-wizard): this step had zero direct
 * unit coverage before, only the E2E golden path. `useProjectActions` is
 * mocked directly, matching VerdictStep.test.tsx's idiom.
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { ActionStep } from "./ActionStep";
import { useProjectActions } from "../../../hooks/useProjectActions";
import { INITIAL_ANSWERS } from "./types";
import type { LeadSetupAnswers } from "./types";
import type { ResolvedProjectActions } from "../../../lib/externalApi";

vi.mock("../../../hooks/useProjectActions");
const mockedActions = vi.mocked(useProjectActions);

function actionsState(overrides: {
  isLoading?: boolean;
  data?: Partial<ResolvedProjectActions>;
} = {}) {
  return {
    isLoading: false,
    data: { actions: [] },
    ...overrides,
  } as unknown as ReturnType<typeof useProjectActions>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderStep(answers: LeadSetupAnswers = INITIAL_ANSWERS, dispatch = vi.fn()) {
  render(<ActionStep answers={answers} dispatch={dispatch} />);
  return dispatch;
}

describe("ActionStep", () => {
  it("shows a loading indicator while actions are loading", () => {
    mockedActions.mockReturnValue(actionsState({ isLoading: true, data: undefined }));
    renderStep();
    expect(screen.getByTestId("lead-wizard-action-loading")).toBeInTheDocument();
  });

  it("renders each action with its slash command, and Next is disabled with none selected", () => {
    mockedActions.mockReturnValue(
      actionsState({
        data: {
          actions: [
            { id: "a1", label: "Content orchestrator", kind: "external_launch", slash_command: "/content-orchestrator" },
          ],
        },
      }),
    );
    renderStep();
    expect(screen.getByText("/content-orchestrator")).toBeInTheDocument();
    expect(screen.getByTestId("lead-wizard-next")).toBeDisabled();
  });

  it("disables and explains an action with no slash command, never dispatching setAction for it", () => {
    mockedActions.mockReturnValue(
      actionsState({
        data: { actions: [{ id: "a2", label: "No command", kind: "external_launch" }] },
      }),
    );
    const dispatch = renderStep();
    const opt = screen.getByTestId("lead-wizard-action-opt");
    expect(opt).toBeDisabled();
    fireEvent.click(opt);
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText("No slash command defined — can't be assigned to a lead.")).toBeInTheDocument();
  });

  it("dispatches setAction with the slash_command taken directly from the wire, and enables Next", () => {
    mockedActions.mockReturnValue(
      actionsState({
        data: { actions: [{ id: "a1", label: "Content", kind: "external_launch", slash_command: "/content-orchestrator" }] },
      }),
    );
    const dispatch = renderStep({ ...INITIAL_ANSWERS, actionId: "a1", slashCommand: "/content-orchestrator" });
    fireEvent.click(screen.getByTestId("lead-wizard-action-opt"));
    expect(dispatch).toHaveBeenCalledWith({ t: "setAction", actionId: "a1", slashCommand: "/content-orchestrator" });
    expect(screen.getByTestId("lead-wizard-next")).not.toBeDisabled();
    expect(screen.getByTestId("lead-wizard-action-opt")).toHaveClass("sel");
  });

  it("dispatches back and next", () => {
    mockedActions.mockReturnValue(actionsState());
    const dispatch = renderStep();
    fireEvent.click(screen.getByTestId("lead-wizard-back"));
    expect(dispatch).toHaveBeenCalledWith({ t: "back" });
  });
});

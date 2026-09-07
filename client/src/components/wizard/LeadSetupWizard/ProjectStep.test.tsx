/*
 * ProjectStep.test.tsx — CI diff-coverage gap fix (Diff coverage gate,
 * iterate-2026-09-07-leadwright-setup-wizard). `useProjects` is mocked
 * directly, matching VerdictStep.test.tsx's idiom.
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { ProjectStep } from "./ProjectStep";
import { useProjects } from "../../../hooks/useProjects";
import { INITIAL_ANSWERS } from "./types";
import type { LeadSetupAnswers } from "./types";

vi.mock("../../../hooks/useProjects");
const mockedProjects = vi.mocked(useProjects);

function projectsState(overrides: Partial<ReturnType<typeof useProjects>> = {}) {
  return {
    isLoading: false,
    isError: false,
    data: [],
    ...overrides,
  } as unknown as ReturnType<typeof useProjects>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderStep(answers: LeadSetupAnswers = INITIAL_ANSWERS, dispatch = vi.fn()) {
  render(<ProjectStep answers={answers} dispatch={dispatch} />);
  return dispatch;
}

describe("ProjectStep", () => {
  it("shows a loading indicator", () => {
    mockedProjects.mockReturnValue(projectsState({ isLoading: true }));
    renderStep();
    expect(screen.getByTestId("lead-wizard-project-loading")).toBeInTheDocument();
  });

  it("shows an error notice when the projects fetch failed", () => {
    mockedProjects.mockReturnValue(projectsState({ isError: true }));
    renderStep();
    expect(screen.getByTestId("lead-wizard-project-error")).toBeInTheDocument();
  });

  it("Next is disabled with no project chosen", () => {
    mockedProjects.mockReturnValue(projectsState());
    renderStep();
    expect(screen.getByTestId("lead-wizard-next")).toBeDisabled();
  });

  it("dispatches setProject with id, name and path together on click, and enables Next", () => {
    mockedProjects.mockReturnValue(
      projectsState({
        data: [
          { id: "p1", name: "Project One", path: "/abs/p1", profile: "node", status: "active", lastActive: "", createdAt: "" },
        ],
      }),
    );
    const dispatch = renderStep({ ...INITIAL_ANSWERS, projectId: "p1", projectPath: "/abs/p1" });
    fireEvent.click(screen.getByTestId("lead-wizard-project-opt"));
    expect(dispatch).toHaveBeenCalledWith({
      t: "setProject",
      projectId: "p1",
      projectName: "Project One",
      projectPath: "/abs/p1",
    });
    expect(screen.getByTestId("lead-wizard-next")).not.toBeDisabled();
    expect(screen.getByTestId("lead-wizard-project-opt")).toHaveClass("sel");
  });

  it("dispatches back", () => {
    mockedProjects.mockReturnValue(projectsState());
    const dispatch = renderStep();
    fireEvent.click(screen.getByTestId("lead-wizard-back"));
    expect(dispatch).toHaveBeenCalledWith({ t: "back" });
  });
});

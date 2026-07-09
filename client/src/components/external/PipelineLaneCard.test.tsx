import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { PipelineLaneCard } from "./PipelineLaneCard";
import type { Project } from "../../types";
import type { RunConfigResponse, RunConfigV2, RunMode } from "../../lib/run-config-v2";

// Stub both representations — this test only proves the mode SELECTION + the
// lane wrapper; each card's rendering is covered by its own test.
vi.mock("./SingleSessionRunCard", () => ({
  SingleSessionRunCard: () => <div data-testid="stub-single-session" />,
}));
vi.mock("./MasterTaskCard", () => ({
  MasterTaskCard: () => <div data-testid="stub-master-task" />,
}));

const PROJECT: Project = {
  id: "p1", name: "proj", path: "/proj", profile: "node",
  status: "active", lastActive: "", createdAt: "",
};

function okResponse(mode?: RunMode): RunConfigResponse {
  const config = {
    schemaVersion: 2,
    runId: "run-a1b2c3d4",
    scope: "full_app",
    autonomy: "guided",
    deploy_target: "none",
    pipeline: ["project"],
    runConditions: { securityEnabled: false, splitMode: null, aikidoClientIdPresent: false },
    splits_frozen: [],
    status: "in_progress",
    completed_phase_task_ids: [],
    phase_tasks: [],
    created_at: "2026-07-09T00:00:00.000Z",
    ...(mode ? { mode } : {}),
  } as RunConfigV2;
  return { status: "ok", config, readyToLaunchTasks: [], diagnostics: { droppedPhaseTaskIds: [], warnings: [] } };
}

describe("PipelineLaneCard — mode selection", () => {
  it("renders nothing when there is no run-config", () => {
    const { container } = render(<PipelineLaneCard runConfig={undefined} project={PROJECT} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a non-ok run-config (missing / v1 / invalid)", () => {
    const { container } = render(<PipelineLaneCard runConfig={{ status: "missing" }} project={PROJECT} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when no project is resolved", () => {
    const { container } = render(<PipelineLaneCard runConfig={okResponse("single_session")} project={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the SingleSessionRunCard for a single_session run (not MasterTaskCard)", () => {
    render(<PipelineLaneCard runConfig={okResponse("single_session")} project={PROJECT} />);
    expect(screen.getByTestId("task-board-pipelines-lane")).toBeInTheDocument();
    expect(screen.getByText("Pipelines")).toBeInTheDocument();
    expect(screen.getByTestId("stub-single-session")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-master-task")).toBeNull();
  });

  it("renders the MasterTaskCard for a multi_session run (not SingleSessionRunCard)", () => {
    render(<PipelineLaneCard runConfig={okResponse("multi_session")} project={PROJECT} />);
    expect(screen.getByTestId("stub-master-task")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-single-session")).toBeNull();
  });

  it("renders the MasterTaskCard for a mode-less legacy run (defaults to multi_session)", () => {
    render(<PipelineLaneCard runConfig={okResponse(undefined)} project={PROJECT} />);
    expect(screen.getByTestId("stub-master-task")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-single-session")).toBeNull();
  });
});

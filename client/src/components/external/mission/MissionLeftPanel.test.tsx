import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { MissionLeftPanel } from "./MissionLeftPanel";
import { deriveMissionLive, type MissionLiveModel } from "../../../hooks/useMissionLive";
import type { TranscriptSummary } from "../../../lib/narrator-transcript";
import type { RunDataJoin } from "../../../lib/runDataApi";

const EMPTY_TRANSCRIPT: TranscriptSummary = {
  topic: null,
  summary: null,
  activity: [],
  stage: null,
  hasActivity: false,
};

function liveModel(stage: "Spec" | "Build" | "Test" | "Finalize" | null): MissionLiveModel {
  return deriveMissionLive({
    missionState: "live",
    run: null,
    transcript: { ...EMPTY_TRANSCRIPT, stage, hasActivity: true, summary: "x" },
    taskTitle: "Add a login page",
  });
}

function completedModel(): MissionLiveModel {
  const run = {
    runId: "r1",
    summary: "Ship the survey",
    commit: "abc1234",
    affectedFrs: ["FR-01.66"],
    specImpact: "add",
    tests: { passed: 12, total: 12 },
    gates: { derived: true, review: "pass" },
  } as unknown as RunDataJoin;
  return deriveMissionLive({
    missionState: "done",
    run,
    transcript: EMPTY_TRANSCRIPT,
    taskTitle: "Survey",
  });
}

describe("MissionLeftPanel — stage labels (AC4)", () => {
  it("renders the four stage labels EXACTLY, in order", () => {
    render(<MissionLeftPanel model={liveModel("Build")} activeNodeKey={null} onNodeClick={vi.fn()} />);
    const stage = screen.getByTestId("mission-stage");
    const labels = within(stage)
      .getAllByText(/Spec|Build|Test|Finalize/)
      .map((el) => el.textContent);
    expect(labels).toEqual(["Spec", "Build", "Test", "Finalize"]);
  });

  it("highlights the current stage and marks the earlier ones done", () => {
    render(<MissionLeftPanel model={liveModel("Test")} activeNodeKey={null} onNodeClick={vi.fn()} />);
    const stage = screen.getByTestId("mission-stage");
    expect(stage).toHaveAttribute("data-stage", "Test");
    const steps = stage.querySelectorAll("li.ml-step");
    expect(steps[0].getAttribute("data-state")).toBe("done"); // Spec
    expect(steps[1].getAttribute("data-state")).toBe("done"); // Build
    expect(steps[2].getAttribute("data-state")).toBe("current"); // Test
    expect(steps[3].getAttribute("data-state")).toBe("todo"); // Finalize
  });

  it("shows an honest '—' when the stage cannot be derived (AC3)", () => {
    render(<MissionLeftPanel model={liveModel(null)} activeNodeKey={null} onNodeClick={vi.fn()} />);
    expect(screen.getByTestId("mission-stage")).toHaveAttribute("data-stage", "none");
    expect(screen.getByTestId("mission-stage-none")).toBeInTheDocument();
  });

  it("a completed run marks every stage done and shows no '—'", () => {
    render(<MissionLeftPanel model={completedModel()} activeNodeKey={null} onNodeClick={vi.fn()} />);
    const stage = screen.getByTestId("mission-stage");
    expect(stage).toHaveAttribute("data-stage", "Finalize");
    expect(screen.queryByTestId("mission-stage-none")).not.toBeInTheDocument();
    for (const step of stage.querySelectorAll("li.ml-step")) {
      expect(step.getAttribute("data-state")).toBe("done");
    }
  });
});

describe("MissionLeftPanel — summary + artifact links", () => {
  it("renders the business summary", () => {
    render(<MissionLeftPanel model={liveModel("Build")} activeNodeKey={null} onNodeClick={vi.fn()} />);
    expect(screen.getByTestId("mission-summary")).toHaveTextContent("Add a login page");
  });

  it("falls back to an honest waiting line when there is no summary", () => {
    const model = deriveMissionLive({
      missionState: "done",
      run: null,
      transcript: EMPTY_TRANSCRIPT,
      taskTitle: null,
    });
    render(<MissionLeftPanel model={model} activeNodeKey={null} onNodeClick={vi.fn()} />);
    expect(screen.getByTestId("mission-summary")).toHaveTextContent(/waiting/i);
  });

  it("renders the Req/Spec/Test/Review/Commit nodes as clickable artifact links (AC2)", () => {
    const onNodeClick = vi.fn();
    render(<MissionLeftPanel model={completedModel()} activeNodeKey={null} onNodeClick={onNodeClick} />);
    for (const key of ["req", "spec", "tests", "review", "commit"] as const) {
      expect(screen.getByTestId(`record-node-${key}`)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("record-node-spec"));
    expect(onNodeClick).toHaveBeenCalledWith("spec");
  });
});

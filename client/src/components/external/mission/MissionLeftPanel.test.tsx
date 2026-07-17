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

function liveModel(
  stage: "Analyze" | "Spec" | "Build" | "Test" | "Finalize" | "Merge" | null,
): MissionLiveModel {
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

describe("MissionLeftPanel — stage labels (FR-01.67 AC1)", () => {
  it("renders the SIX stage labels EXACTLY, in order (Analyze…Merge)", () => {
    render(<MissionLeftPanel model={liveModel("Build")} activeNodeKey={null} onNodeClick={vi.fn()} />);
    const stage = screen.getByTestId("mission-stage");
    const labels = within(stage)
      .getAllByText(/Analyze|Spec|Build|Test|Finalize|Merge/)
      .map((el) => el.textContent);
    expect(labels).toEqual(["Analyze", "Spec", "Build", "Test", "Finalize", "Merge"]);
  });

  it("highlights the current stage and marks the earlier ones done", () => {
    render(<MissionLeftPanel model={liveModel("Test")} activeNodeKey={null} onNodeClick={vi.fn()} />);
    const stage = screen.getByTestId("mission-stage");
    expect(stage).toHaveAttribute("data-stage", "Test");
    const steps = stage.querySelectorAll("li.ml-step");
    expect(steps[0].getAttribute("data-state")).toBe("done"); // Analyze
    expect(steps[1].getAttribute("data-state")).toBe("done"); // Spec
    expect(steps[2].getAttribute("data-state")).toBe("done"); // Build
    expect(steps[3].getAttribute("data-state")).toBe("current"); // Test
    expect(steps[4].getAttribute("data-state")).toBe("todo"); // Finalize
    expect(steps[5].getAttribute("data-state")).toBe("todo"); // Merge
  });

  it("shows an honest '—' when the stage cannot be derived (AC3)", () => {
    render(<MissionLeftPanel model={liveModel(null)} activeNodeKey={null} onNodeClick={vi.fn()} />);
    expect(screen.getByTestId("mission-stage")).toHaveAttribute("data-stage", "none");
    expect(screen.getByTestId("mission-stage-none")).toBeInTheDocument();
  });

  it("a completed (merged) run marks every stage done and shows no '—'", () => {
    render(<MissionLeftPanel model={completedModel()} activeNodeKey={null} onNodeClick={vi.fn()} />);
    const stage = screen.getByTestId("mission-stage");
    expect(stage).toHaveAttribute("data-stage", "Merge");
    expect(screen.queryByTestId("mission-stage-none")).not.toBeInTheDocument();
    const steps = stage.querySelectorAll("li.ml-step");
    expect(steps.length).toBe(6);
    for (const step of steps) {
      expect(step.getAttribute("data-state")).toBe("done");
    }
  });
});

describe("MissionLeftPanel — campaign progress line (FR-01.67 AC3)", () => {
  function campaignModel(): MissionLiveModel {
    return deriveMissionLive({
      missionState: "live",
      run: null,
      transcript: { ...EMPTY_TRANSCRIPT, stage: "Build", hasActivity: true, summary: "x" },
      taskTitle: "campaign: wow-usability",
      campaign: { slug: "wow-usability", done: 21, total: 22, activeSubIterate: "A21" },
    });
  }

  it("renders 'Sub-iterate N of M · A<k>' above the stepper for a campaign session", () => {
    render(<MissionLeftPanel model={campaignModel()} activeNodeKey={null} onNodeClick={vi.fn()} />);
    const line = screen.getByTestId("mission-campaign-progress");
    expect(line).toHaveTextContent("Sub-iterate 21 of 22");
    expect(line).toHaveTextContent("A21");
    // The stepper still renders the active sub-iterate's stage.
    expect(screen.getByTestId("mission-stage")).toHaveAttribute("data-stage", "Build");
    // The business summary is the readable slug, not the raw title.
    expect(screen.getByTestId("mission-summary")).toHaveTextContent("wow-usability");
  });

  it("no campaign line for a normal (non-campaign) session", () => {
    render(<MissionLeftPanel model={liveModel("Build")} activeNodeKey={null} onNodeClick={vi.fn()} />);
    expect(screen.queryByTestId("mission-campaign-progress")).not.toBeInTheDocument();
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

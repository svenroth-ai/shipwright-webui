import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { ExternalTask } from "../../../lib/externalApi";
import type { RunDetailResponse } from "../../../lib/runDataApi";

const missionStateMock = vi.fn<() => "done" | "live" | "designgate">();
const runDetailMock = vi.fn<() => { data: RunDetailResponse | undefined }>();
vi.mock("../../../hooks/useMissionState", () => ({
  useMissionState: () => missionStateMock(),
}));
vi.mock("../../../hooks/useRunData", () => ({
  useRunDetail: () => runDetailMock(),
}));

import { MissionBody } from "./MissionBody";

const TASK = { projectId: "p1", runId: "iterate-2026-07-16-x" } as unknown as ExternalTask;

afterEach(() => {
  missionStateMock.mockReset();
  runDetailMock.mockReset();
});

function setup(onOpenDocument = vi.fn()) {
  render(<MissionBody task={TASK} onOpenDocument={onOpenDocument} />);
  return { onOpenDocument };
}

describe("MissionBody", () => {
  it("renders TWO cards (Record + Operation) with no active node; no scrim in the tree", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
    setup();
    expect(screen.getByTestId("record-rail")).toBeInTheDocument();
    expect(screen.getByTestId("operation-card")).toBeInTheDocument();
    // No active node → no artifact card, and therefore NO scrim/dimming element
    // behind the row (AC1 — the scrim only exists as the artifact's compact
    // slide-over overlay, never a panel behind the three cards).
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("artifact-scrim")).not.toBeInTheDocument();
  });

  it("opening a node reveals the THIRD (Artifact) card; re-click closes it", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
    setup();
    fireEvent.click(screen.getByTestId("record-node-req"));
    expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("record-node-req"));
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();
  });

  it("collapsing the rail clears the active node; a collapsed dot re-expands + opens", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
    setup();
    fireEvent.click(screen.getByTestId("record-node-tests"));
    expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("record-collapse"));
    expect(screen.getByTestId("record-rail")).toHaveAttribute("data-collapsed", "true");
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("record-node-req"));
    expect(screen.getByTestId("record-rail")).not.toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
  });

  it("the design-gate mode routes the Operation card to A14's design-gate surface", () => {
    missionStateMock.mockReturnValue("designgate");
    runDetailMock.mockReturnValue({ data: undefined });
    setup();
    expect(screen.getByTestId("operation-designgate-placeholder")).toBeInTheDocument();
  });

  it("'Open full document' fires the parent callback and closes the panel", () => {
    missionStateMock.mockReturnValue("live");
    runDetailMock.mockReturnValue({ data: undefined });
    const { onOpenDocument } = setup();
    fireEvent.click(screen.getByTestId("record-node-commit"));
    fireEvent.click(screen.getByTestId("artifact-open-document"));
    expect(onOpenDocument).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();
  });
});

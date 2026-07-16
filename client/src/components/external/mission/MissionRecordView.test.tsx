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

import { MissionRecordView } from "./MissionRecordView";

const TASK = { projectId: "p1", runId: "iterate-2026-07-15-x" } as unknown as ExternalTask;

afterEach(() => {
  missionStateMock.mockReset();
  runDetailMock.mockReset();
});

function setup(onOpenDocument = vi.fn()) {
  render(<MissionRecordView task={TASK} onOpenDocument={onOpenDocument} />);
  return { onOpenDocument };
}

describe("MissionRecordView", () => {
  it("renders the Record rail; a node opens the artifact; re-click closes it", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
    setup();
    expect(screen.getByTestId("record-rail")).toBeInTheDocument();

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
    // collapse → clears the active node
    fireEvent.click(screen.getByTestId("record-collapse"));
    expect(screen.getByTestId("record-rail")).toHaveAttribute("data-collapsed", "true");
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();
    // a dot click while collapsed re-expands AND opens
    fireEvent.click(screen.getByTestId("record-node-req"));
    expect(screen.getByTestId("record-rail")).not.toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
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

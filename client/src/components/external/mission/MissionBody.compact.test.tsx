import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExternalTask } from "../../../lib/externalApi";
import type { RunDataJoin, RunDetailResponse } from "../../../lib/runDataApi";

const missionStateMock = vi.fn<() => "done" | "live" | "designgate">();
const runDetailMock = vi.fn<() => { data: RunDetailResponse | undefined }>();
const missionContextMock = vi.fn<() => { data: unknown }>();
vi.mock("../../../hooks/useMissionState", () => ({
  useMissionState: () => missionStateMock(),
}));
vi.mock("../../../hooks/useRunData", () => ({
  useRunDetail: () => runDetailMock(),
}));
vi.mock("../../../hooks/useCampaigns", () => ({ useCampaigns: () => ({ data: [] }) }));
vi.mock("./DesignGateCard", () => ({
  DesignGateCard: () => <div data-testid="design-gate-card-stub" />,
}));
vi.mock("../../../hooks/useMissionContext", () => ({
  useMissionContext: () => missionContextMock(),
  useArtifactDocument: () => ({ data: undefined, isPending: false, isError: false }),
}));

import { MissionBody } from "./MissionBody";

const originalMatchMedia = window.matchMedia;
const TASK = {
  projectId: "p1",
  runId: "iterate-2026-07-16-x",
  title: "Survey the hull",
} as unknown as ExternalTask;
const COMPLETED_RUN = {
  runId: "iterate-2026-07-16-x",
  summary: "Ship the survey",
  commit: "abc1234",
  affectedFrs: ["FR-01.66"],
  specImpact: "add",
  tests: { passed: 12, total: 12 },
  gates: { derived: true, review: "pass" },
} as unknown as RunDataJoin;

beforeEach(() => {
  missionContextMock.mockReturnValue({ data: undefined });
});

afterEach(() => {
  missionStateMock.mockReset();
  runDetailMock.mockReset();
  missionContextMock.mockReset();
  window.matchMedia = originalMatchMedia;
});

function setCompact(compact: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(max-width: 1023px)" ? compact : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function setResponsiveCompact(initial: boolean) {
  let matches = initial;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = "(max-width: 1023px)";
  const mql = {
    get matches() { return matches; },
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
  window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia;
  return (next: boolean) => {
    matches = next;
    act(() => listeners.forEach((listener) =>
      listener({ matches: next, media: query } as MediaQueryListEvent)));
  };
}

function setupCompletedCompact(transcriptContent = "") {
  setCompact(true);
  missionStateMock.mockReturnValue("done");
  runDetailMock.mockReturnValue({
    data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse,
  });
  render(
    <MissionBody task={TASK} transcriptContent={transcriptContent} onOpenDocument={vi.fn()} />,
  );
}

describe("MissionBody — compact Overview / Activity / Detail navigation", () => {
  it("starts on Overview with semantic tabs and disabled Detail", () => {
    setupCompletedCompact();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview", "Activity", "Detail",
    ]);
    expect(screen.getByTestId("mission-compact-tab-overview")).toHaveAttribute(
      "aria-selected", "true",
    );
    expect(screen.getByTestId("mission-compact-tab-detail")).toBeDisabled();
    expect(screen.getByTestId("mission-panel-overview")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("mission-panel-activity")).toHaveAttribute("hidden");
  });

  it("an Overview artifact automatically selects Detail", () => {
    setupCompletedCompact();
    fireEvent.click(screen.getByTestId("record-node-req"));
    expect(screen.getByTestId("mission-compact-tab-detail")).not.toBeDisabled();
    expect(screen.getByTestId("mission-compact-tab-detail")).toHaveAttribute(
      "aria-selected", "true",
    );
    expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
  });

  it("manual Activity preserves the selected Detail artifact", () => {
    setupCompletedCompact();
    fireEvent.click(screen.getByTestId("record-node-req"));
    fireEvent.click(screen.getByTestId("mission-compact-tab-activity"));
    expect(screen.getByTestId("mission-panel-detail")).toHaveAttribute("hidden");
    fireEvent.click(screen.getByTestId("mission-compact-tab-detail"));
    expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
  });

  it("an Activity prose artifact link automatically selects Detail", () => {
    setupCompletedCompact(JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "spec-write",
          name: "Edit",
          input: { file_path: "/project/.shipwright/planning/iterate/mobile.md" },
        }],
      },
    }));
    fireEvent.click(screen.getByTestId("mission-compact-tab-activity"));
    fireEvent.click(within(screen.getByTestId("mission-narration")).getByRole(
      "button", { name: "plan" },
    ));
    expect(screen.getByTestId("mission-compact-tab-detail")).toHaveAttribute(
      "aria-selected", "true",
    );
    expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
  });

  it("Activity → Detail → close restores and focuses Activity", async () => {
    setupCompletedCompact();
    fireEvent.click(screen.getByTestId("record-node-req"));
    fireEvent.click(screen.getByTestId("mission-compact-tab-activity"));
    fireEvent.click(screen.getByTestId("mission-compact-tab-detail"));
    fireEvent.click(screen.getByTestId("artifact-close"));
    await waitFor(() =>
      expect(screen.getByTestId("mission-compact-tab-activity")).toHaveFocus());
    expect(screen.getByTestId("mission-compact-tab-activity")).toHaveAttribute(
      "aria-selected", "true",
    );
  });

  it("reselecting the active artifact from Activity returns to Activity", async () => {
    setupCompletedCompact();
    const artifact = screen.getByTestId("record-node-req");
    fireEvent.click(artifact);
    fireEvent.click(screen.getByTestId("mission-compact-tab-activity"));
    fireEvent.click(artifact);
    await waitFor(() =>
      expect(screen.getByTestId("mission-compact-tab-activity")).toHaveFocus());
    expect(screen.getByTestId("mission-compact-tab-detail")).toBeDisabled();
  });

  it("closing Detail restores Overview and focuses its tab", async () => {
    setupCompletedCompact();
    fireEvent.click(screen.getByTestId("record-node-req"));
    fireEvent.click(screen.getByTestId("artifact-close"));
    await waitFor(() =>
      expect(screen.getByTestId("mission-compact-tab-overview")).toHaveFocus());
    expect(screen.getByTestId("mission-compact-tab-detail")).toBeDisabled();
  });

  it("ArrowRight activates Activity while inactive panels remain mounted", () => {
    setupCompletedCompact();
    const overview = screen.getByTestId("mission-compact-tab-overview");
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(screen.getByTestId("mission-compact-tab-activity")).toHaveFocus();
    expect(screen.getByTestId("record-rail")).toBeInTheDocument();
    expect(screen.getByTestId("mission-panel-overview")).toHaveAttribute("hidden");
  });

  it("desktop keeps the existing three-card body without compact tabs", () => {
    setCompact(false);
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({
      data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse,
    });
    render(<MissionBody task={TASK} transcriptContent="" onOpenDocument={vi.fn()} />);
    expect(screen.queryByTestId("mission-compact-tabs")).toBeNull();
    expect(screen.getByTestId("record-rail")).toBeInTheDocument();
  });

  it("desktop artifact selection preserves the compact Overview destination", () => {
    const switchViewport = setResponsiveCompact(false);
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({
      data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse,
    });
    render(<MissionBody task={TASK} transcriptContent="" onOpenDocument={vi.fn()} />);
    fireEvent.click(screen.getByTestId("record-node-req"));
    switchViewport(true);
    expect(screen.getByTestId("mission-compact-tab-overview")).toHaveAttribute(
      "aria-selected", "true",
    );
    expect(screen.getByTestId("mission-compact-tab-detail")).not.toBeDisabled();
  });

  it("desktop close does not overwrite the preserved compact Activity destination", () => {
    const switchViewport = setResponsiveCompact(true);
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({
      data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse,
    });
    render(<MissionBody task={TASK} transcriptContent="" onOpenDocument={vi.fn()} />);
    fireEvent.click(screen.getByTestId("record-node-req"));
    fireEvent.click(screen.getByTestId("mission-compact-tab-activity"));

    switchViewport(false);
    fireEvent.click(screen.getByTestId("artifact-close"));
    switchViewport(true);

    expect(screen.getByTestId("mission-compact-tab-activity")).toHaveAttribute(
      "aria-selected", "true",
    );
    expect(screen.getByTestId("mission-compact-tab-detail")).toBeDisabled();
  });

  it("compact Detail → desktop close → compact restores an enabled source tab", () => {
    const switchViewport = setResponsiveCompact(true);
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({
      data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse,
    });
    render(<MissionBody task={TASK} transcriptContent="" onOpenDocument={vi.fn()} />);
    fireEvent.click(screen.getByTestId("record-node-req"));

    switchViewport(false);
    fireEvent.click(screen.getByTestId("artifact-close"));
    switchViewport(true);

    const overview = screen.getByTestId("mission-compact-tab-overview");
    expect(overview).toHaveAttribute("aria-selected", "true");
    expect(overview).not.toBeDisabled();
    expect(overview).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("mission-panel-overview")).toBeVisible();
  });

  it("compact Detail → desktop artifact toggle → compact restores Overview", () => {
    const switchViewport = setResponsiveCompact(true);
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({
      data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse,
    });
    render(<MissionBody task={TASK} transcriptContent="" onOpenDocument={vi.fn()} />);
    fireEvent.click(screen.getByTestId("record-node-req"));

    switchViewport(false);
    fireEvent.click(screen.getByTestId("record-node-req"));
    switchViewport(true);

    expect(screen.getByTestId("mission-compact-tab-overview")).toHaveAttribute(
      "aria-selected", "true",
    );
    expect(screen.getByTestId("mission-compact-tab-detail")).toBeDisabled();
    expect(screen.getByTestId("mission-panel-overview")).toBeVisible();
  });
});

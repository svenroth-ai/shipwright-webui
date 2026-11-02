import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExternalTask } from "../../../lib/externalApi";
import type { RunDataJoin, RunDetailResponse } from "../../../lib/runDataApi";

const missionStateMock = vi.fn<() => "done" | "live" | "designgate">();
const runDetailMock = vi.fn<() => { data: RunDetailResponse | undefined }>();
const missionContextMock = vi.fn<() => { data: unknown }>();
// M3: the right info sidebar owns its own session-info query; covered in MissionInfoSidebar.test.tsx.
vi.mock("../../../hooks/useMissionAgents", () => ({
  useMissionAgents: () => ({ agents: [], runningCount: 0, open: false, selectedId: null, loading: false, failed: false, setOpen: () => {}, select: () => {}, openFor: () => false, canOpen: () => false, refresh: () => {} }),
}));
vi.mock("./MissionInfoSidebar", async () => ({ MissionInfoSidebar: (await import("./MissionInfoSidebar.docs-stub")).MissionInfoSidebarDocsStub }));
vi.mock("../../../hooks/useMissionFileOpen", () => ({ useMissionFileOpen: () => ({ fileOpen: { projectRoot: null, open: () => {} }, request: null }) }));
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

// @covers FR-01.66
describe("MissionBody — compact Overview / Activity / Info navigation (documents open in the Viewer)", () => {
  it("starts on Overview with three semantic tabs - there is no Detail tab any more", () => {
    setupCompletedCompact();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Activity", "Info"]);
    expect(screen.queryByTestId("mission-compact-tab-detail")).toBeNull();
    expect(screen.queryByTestId("mission-panel-detail")).toBeNull();
    expect(screen.getByTestId("mission-compact-tab-overview")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("mission-panel-overview")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("mission-panel-activity")).toHaveAttribute("hidden");
  });

  it("the Info tab reveals the right sidebar panel (M3)", () => {
    setupCompletedCompact();
    expect(screen.getByTestId("mission-panel-info")).toHaveAttribute("hidden");
    fireEvent.click(screen.getByTestId("mission-compact-tab-info"));
    expect(screen.getByTestId("mission-panel-info")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("mission-panel-overview")).toHaveAttribute("hidden");
  });

  it("an Overview artifact opens in the Viewer under the Info tab", () => {
    setupCompletedCompact();
    fireEvent.click(screen.getByTestId("record-node-req"));
    expect(screen.getByTestId("mission-compact-tab-info")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("mission-panel-info")).not.toHaveAttribute("hidden");
    expect(within(screen.getByTestId("mission-side-doc")).getByTestId("artifact-panel")).toBeInTheDocument();
  });

  it("the opened document stays in the Viewer while the user visits Activity and comes back", () => {
    setupCompletedCompact();
    fireEvent.click(screen.getByTestId("record-node-req"));
    fireEvent.click(screen.getByTestId("mission-compact-tab-activity"));
    expect(screen.getByTestId("mission-panel-info")).toHaveAttribute("hidden");
    fireEvent.click(screen.getByTestId("mission-compact-tab-info"));
    expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
  });

  it("an Activity command group stays available without changing compact panels", () => {
    setupCompletedCompact(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Updating the mobile iterate spec." },
          {
            type: "tool_use",
            id: "spec-write",
            name: "Edit",
            input: { file_path: "/project/.shipwright/planning/iterate/mobile.md" },
          },
        ],
      },
    }));
    fireEvent.click(screen.getByTestId("mission-compact-tab-activity"));
    // Commands are collapsed behind a count toggle by default
    // (iterate-2026-09-16-mission-feed-render-fidelity) — expand it first.
    fireEvent.click(within(screen.getByTestId("mission-activity-feed")).getByRole("button", { name: "1 command" }));
    const group = within(screen.getByTestId("mission-activity-feed")).getByText("Edit: /project/.shipwright/planning/iterate/mobile.md");
    fireEvent.click(group);
    expect(screen.getByTestId("mission-compact-tab-activity")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();
  });

  it("closing the document keeps the user on the Info tab (the Viewer), with nothing left behind", () => {
    setupCompletedCompact();
    fireEvent.click(screen.getByTestId("record-node-req"));
    fireEvent.click(screen.getByTestId("artifact-close"));
    expect(screen.queryByTestId("artifact-panel")).toBeNull();
    expect(screen.getByTestId("mission-compact-tab-info")).toHaveAttribute("aria-selected", "true");
  });

  it("ArrowRight activates Activity while inactive panels remain mounted; End reaches Info", () => {
    setupCompletedCompact();
    const overview = screen.getByTestId("mission-compact-tab-overview");
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(screen.getByTestId("mission-compact-tab-activity")).toHaveFocus();
    expect(screen.getByTestId("record-rail")).toBeInTheDocument();
    expect(screen.getByTestId("mission-panel-overview")).toHaveAttribute("hidden");
    fireEvent.keyDown(screen.getByTestId("mission-compact-tab-activity"), { key: "End" });
    expect(screen.getByTestId("mission-compact-tab-info")).toHaveAttribute("aria-selected", "true");
  });

  it("desktop keeps the card body without compact tabs and opens a document in the sidebar", () => {
    setCompact(false);
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({
      data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse,
    });
    render(<MissionBody task={TASK} transcriptContent="" onOpenDocument={vi.fn()} />);
    expect(screen.queryByTestId("mission-compact-tabs")).toBeNull();
    expect(screen.getByTestId("record-rail")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("record-node-req"));
    expect(screen.queryByTestId("mission-panel-detail")).toBeNull();
    expect(within(screen.getByTestId("mission-side-doc")).getByTestId("artifact-panel")).toBeInTheDocument();
  });

  it("a desktop document selection does not move the compact destination", () => {
    const switchViewport = setResponsiveCompact(false);
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({
      data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse,
    });
    render(<MissionBody task={TASK} transcriptContent="" onOpenDocument={vi.fn()} />);
    fireEvent.click(screen.getByTestId("record-node-req"));
    switchViewport(true);
    expect(screen.getByTestId("mission-compact-tab-overview")).toHaveAttribute("aria-selected", "true");
  });
});

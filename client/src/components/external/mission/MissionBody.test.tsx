import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { ExternalTask } from "../../../lib/externalApi";
import type { RunDataJoin, RunDetailResponse } from "../../../lib/runDataApi";

const missionStateMock = vi.fn<() => "done" | "live" | "designgate">();
const runDetailMock = vi.fn<() => { data: RunDetailResponse | undefined }>();
vi.mock("../../../hooks/useMissionState", () => ({
  useMissionState: () => missionStateMock(),
}));
vi.mock("../../../hooks/useRunData", () => ({
  useRunDetail: () => runDetailMock(),
}));
// FR-01.67: useMissionLive now consults useCampaigns (dormant for non-campaign
// titles). Stub it so this shell test needs no QueryClient provider.
vi.mock("../../../hooks/useCampaigns", () => ({
  useCampaigns: () => ({ data: [] }),
}));
// A14's gate body (rendered by OperationCard in designgate mode) carries its own
// tests + needs QueryClient / LaunchCoordinator providers; stub it so this shell
// test stays about the three-card routing.
vi.mock("./DesignGateCard", () => ({
  DesignGateCard: () => <div data-testid="design-gate-card-stub" />,
}));
// S1 — MissionBody now consults the mission-context resolver. Stubbed to
// "resolved nothing" here so these cases keep asserting the LEGACY rail
// (scenarios 1/3/4/5), which is exactly the no-regression contract. The
// context-driven rail has its own cases in MissionBody.context.test.tsx.
vi.mock("../../../hooks/useMissionContext", () => ({
  useMissionContext: () => ({ data: undefined }),
  useArtifactDocument: () => ({ data: undefined, isPending: false, isError: false }),
}));

import { MissionBody } from "./MissionBody";

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

afterEach(() => {
  missionStateMock.mockReset();
  runDetailMock.mockReset();
});

function setup(transcript = "", onOpenDocument = vi.fn()) {
  render(
    <MissionBody task={TASK} transcriptContent={transcript} onOpenDocument={onOpenDocument} />,
  );
  return { onOpenDocument };
}

describe("MissionBody — the redesigned left panel + live/verdict middle", () => {
  it("renders the left panel + a middle card with no active node; no scrim", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
    setup();
    expect(screen.getByTestId("record-rail")).toBeInTheDocument();
    expect(screen.getByTestId("operation-card")).toBeInTheDocument();
    // No active node → no artifact card, therefore no scrim behind the row.
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("artifact-scrim")).not.toBeInTheDocument();
  });

  it("a live session with no run row narrates the JSONL, NOT 'No run data yet' (AC1)", () => {
    missionStateMock.mockReturnValue("live");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
    const transcript = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/x/login.tsx" } }] },
    });
    setup(transcript);
    // The middle is the told story, not the verdict banner / "No run data yet".
    // FR-01.68 replaced the `mission-narration-summary` line and the mechanical
    // per-step list ("Editing login.tsx") with prose: one edit to a product file
    // reads as work done, not as a filename.
    expect(screen.getByTestId("mission-narration")).toBeInTheDocument();
    expect(screen.getByTestId("mission-narration")).toHaveTextContent(
      "One file was then changed.",
    );
    expect(screen.queryByTestId("mission-narration-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("mission-narration")).not.toHaveTextContent("login.tsx");
    expect(screen.queryByText(/No run data yet/i)).not.toBeInTheDocument();
    // The left panel shows the business summary + the inferred stage.
    expect(screen.getByTestId("mission-summary")).toHaveTextContent("Survey the hull");
    expect(screen.getByTestId("mission-stage")).toHaveAttribute("data-stage", "Build");
  });

  it("no run AND no transcript → honest waiting, no fabricated activity (AC3)", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } as RunDetailResponse });
    setup("");
    expect(screen.getByTestId("mission-narration")).toHaveAttribute("data-empty", "true");
    expect(screen.getByTestId("mission-narration")).toHaveTextContent(/waiting/i);
    // Stage is "—" when it cannot be derived (never guessed).
    expect(screen.getByTestId("mission-stage")).toHaveAttribute("data-stage", "none");
    expect(screen.getByTestId("mission-stage-none")).toBeInTheDocument();
  });

  it("a COMPLETED run keeps its verdict/proof middle + artifact links (AC2)", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse });
    setup("");
    // FR-01.68 AC10: the verdict is KEPT and the story is added beneath it, so a
    // run reads the same before and after it finishes — only more complete.
    // (Before FR-01.68 the narration was absent entirely once a run completed.)
    expect(screen.getByTestId("verdict-banner")).toBeInTheDocument();
    expect(screen.getByTestId("mission-completed-stack")).toBeInTheDocument();
    expect(screen.getByTestId("mission-narration")).toBeInTheDocument();
    // The audit trail is preserved as clickable artifact links.
    for (const key of ["req", "spec", "tests", "review", "commit"] as const) {
      expect(screen.getByTestId(`record-node-${key}`)).toBeInTheDocument();
    }
    // Stage is a done, terminal Merge (FR-01.67).
    expect(screen.getByTestId("mission-stage")).toHaveAttribute("data-stage", "Merge");
  });

  it("clicking an artifact link opens the RIGHT panel; re-click closes it", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse });
    setup("");
    fireEvent.click(screen.getByTestId("record-node-req"));
    expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("record-node-req"));
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();
  });

  it("the design-gate mode routes the middle to A14's design-gate surface", () => {
    missionStateMock.mockReturnValue("designgate");
    runDetailMock.mockReturnValue({ data: undefined });
    setup();
    expect(screen.getByTestId("design-gate-card-stub")).toBeInTheDocument();
  });

  it("'Open full document' fires the parent callback and closes the panel", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue({ data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse });
    const { onOpenDocument } = setup("");
    fireEvent.click(screen.getByTestId("record-node-commit"));
    fireEvent.click(screen.getByTestId("artifact-open-document"));
    expect(onOpenDocument).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();
  });
});

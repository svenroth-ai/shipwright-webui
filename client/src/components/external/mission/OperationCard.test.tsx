import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ExternalTask } from "../../../lib/externalApi";
import type { RunDataJoin, RunDetailResponse } from "../../../lib/runDataApi";
import type { MissionContext } from "../../../lib/missionContextApi";

// AC1: the card consumes A11's useMissionState + A02's useRunDetail — it does NOT
// re-derive state. We mock both hooks and drive the card from their outputs.
const missionStateMock = vi.fn<() => "done" | "live" | "designgate">();
const runDetailMock = vi.fn<(projectId: string | null, runId: string | null) => { data: RunDetailResponse | undefined }>();
vi.mock("../../../hooks/useMissionState", () => ({
  useMissionState: () => missionStateMock(),
}));
vi.mock("../../../hooks/useRunData", () => ({
  useRunDetail: (projectId: string | null, runId: string | null) => runDetailMock(projectId, runId),
}));
// A14 owns the design-gate body; A12 only ROUTES to it. Stub it so this test
// stays about the routing decision, not the gate's internals (which carry their
// own tests + need QueryClient / LaunchCoordinator providers).
vi.mock("./DesignGateCard", () => ({
  DesignGateCard: () => <div data-testid="design-gate-card-stub" />,
}));

import { OperationCard } from "./OperationCard";

const TASK = { projectId: "p1", runId: "iterate-2026-07-10-x" } as unknown as ExternalTask;

const GREEN_RUN = {
  runId: "iterate-2026-07-10-x",
  commit: "ac845a1def",
  affectedFrs: ["FR-01.56"],
  tests: { passed: 1882, total: 1882 },
  gates: { derived: true, test: "pass", review: "pass", security: "pass" },
  phaseDurations: null,
} as unknown as RunDataJoin;

const HELD_RUN = {
  runId: "iterate-2026-07-10-x",
  commit: null,
  affectedFrs: ["FR-01.56"],
  tests: { passed: 10, total: 12 },
  gates: { derived: true, test: "unknown", review: "unknown", security: "fail" },
  phaseDurations: null,
} as unknown as RunDataJoin;

function ok(run: RunDataJoin | null): { data: RunDetailResponse } {
  return { data: { status: "ok", run } };
}

afterEach(() => {
  missionStateMock.mockReset();
  runDetailMock.mockReset();
});

describe("OperationCard — the three states render from real signals (AC1)", () => {
  it("uses the resolved Mission iterate id, never the task pipeline id", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue(ok(null));
    const context = {
      scenario: "iterate",
      runId: "iterate-2026-08-11-mis-1",
      servesFrId: "FR-01.66",
      artifacts: [{ kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: { type: "tests", results: { passed: 4, total: 4, skipped: 0, gate: "pass" }, rows: [], counts: { added: 0, modified: 0, removed: 0 }, byLayer: [], truncated: false, manifestStatus: "ok" } }],
    } as unknown as MissionContext;
    render(<OperationCard task={{ ...TASK, runId: "run-pipeline" } as ExternalTask} context={context} />);
    expect(screen.getByTestId("proof-summary")).toHaveTextContent("iterate-2026-08-11-mis-1");
    // Neutral verdict (security gate unwired) -> no banner at all (iterate-
    // 2026-08-13-mission-mobile-visual); the proof summary carries the fact.
    expect(screen.queryByTestId("verdict-banner")).not.toBeInTheDocument();
  });

  it("never falls back to a pipeline id when an iterate identity is absent", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue(ok(GREEN_RUN));
    render(<OperationCard task={{ ...TASK, runId: "run-pipeline" } as ExternalTask} context={{ scenario: "iterate", runId: null, artifacts: [], servesFrId: null } as unknown as MissionContext} />);
    expect(runDetailMock).toHaveBeenLastCalledWith("p1", null);
    // Neutral/no-data -> no banner; ProofSummary's own honest-empty state
    // carries "no run data" instead of a redundant second banner.
    expect(screen.queryByTestId("verdict-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("proof-summary")).toHaveAttribute("data-empty", "true");
  });
  it("done + a green run -> ALL CLEAR + green proof lines", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue(ok(GREEN_RUN));
    render(<OperationCard task={TASK} />);

    expect(screen.getByTestId("verdict-banner")).toHaveAttribute("data-outcome", "clear");
    expect(screen.getByTestId("verdict-banner")).toHaveTextContent("ALL CLEAR");
    expect(screen.getByTestId("proof-summary")).toHaveTextContent("suite green");
    expect(screen.getByTestId("proof-summary")).toHaveTextContent("committed");
  });

  it("live + a failing security gate -> GATE HOLD with the check named", () => {
    missionStateMock.mockReturnValue("live");
    runDetailMock.mockReturnValue(ok(HELD_RUN));
    render(<OperationCard task={TASK} />);

    expect(screen.getByTestId("verdict-banner")).toHaveAttribute("data-outcome", "hold");
    expect(screen.getByTestId("verdict-banner")).toHaveTextContent("GATE HOLD");
    expect(screen.getByTestId("proof-summary")).toHaveTextContent("security gate held");
  });

  it("designgate -> routes to A14's DesignGateCard, never a fake verdict", () => {
    missionStateMock.mockReturnValue("designgate");
    runDetailMock.mockReturnValue({ data: undefined });
    render(<OperationCard task={TASK} />);

    expect(screen.getByTestId("design-gate-card-stub")).toBeInTheDocument();
    // No verdict banner at all — A12 only routes; A14 owns the gate body.
    expect(screen.queryByTestId("verdict-banner")).not.toBeInTheDocument();
    expect(screen.queryByText("ALL CLEAR")).not.toBeInTheDocument();
  });

  it("empty event log (done, run null) -> NEUTRAL, no banner, never a false ALL CLEAR (AC3)", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue(ok(null));
    render(<OperationCard task={TASK} />);

    // Neutral -> no banner at all (retired iterate-2026-08-13-mission-
    // mobile-visual): a fact-free banner on top of an already-honest empty
    // ProofSummary was pure redundancy.
    expect(screen.queryByTestId("verdict-banner")).not.toBeInTheDocument();
    expect(screen.queryByText("ALL CLEAR")).not.toBeInTheDocument();
    // honest empty summary — never an invented line.
    expect(screen.getByTestId("proof-summary")).toHaveAttribute("data-empty", "true");
  });

  it("DONE task, green suite but unwired gates -> no banner, the red/green proof line still shows (never hidden)", () => {
    // The common REAL case today: a finished run with green tests but review/security
    // unknown (the server never emits them). Neutral, no banner — but the suite's
    // outcome is never hidden: it is a real proof line inside ProofSummary.
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue(
      ok({
        runId: "iterate-2026-07-10-x",
        commit: "ac845a1",
        affectedFrs: ["FR-01.56"],
        tests: { passed: 1882, total: 1882 },
        gates: { derived: true, test: "pass", review: "unknown", security: "unknown" },
        phaseDurations: null,
      } as unknown as RunDataJoin),
    );
    render(<OperationCard task={TASK} />);

    expect(screen.queryByTestId("verdict-banner")).not.toBeInTheDocument();
    expect(screen.queryByText("ALL CLEAR")).not.toBeInTheDocument();
    // the honest partial evidence IS shown: the green suite line.
    expect(screen.getByTestId("proof-summary")).toHaveTextContent("suite green");
  });

  it("DONE task, RED suite (test gate failed) -> no banner, but the red suite line is NEVER hidden", () => {
    // The exact regression an earlier draft of this iterate would have introduced:
    // hiding the whole card on neutral would have hidden this line. It must not.
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue(
      ok({
        runId: "iterate-2026-07-10-x",
        commit: null,
        affectedFrs: ["FR-01.56"],
        tests: { passed: 10, total: 12 },
        gates: { derived: true, test: "fail", review: "unknown", security: "unknown" },
        phaseDurations: null,
      } as unknown as RunDataJoin),
    );
    render(<OperationCard task={TASK} />);

    expect(screen.queryByTestId("verdict-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("proof-summary")).toHaveTextContent("10/12 passing");
    expect(screen.getByTestId("proof-summary")).not.toHaveAttribute("data-empty", "true");
  });

  it("LIVE run with only partial facts -> no banner (neutral)", () => {
    missionStateMock.mockReturnValue("live");
    runDetailMock.mockReturnValue(
      ok({
        runId: "iterate-2026-07-10-x",
        tests: null,
        gates: { derived: true, test: "unknown", review: "unknown", security: "unknown" },
        phaseDurations: null,
      } as unknown as RunDataJoin),
    );
    render(<OperationCard task={TASK} />);
    expect(screen.queryByTestId("verdict-banner")).not.toBeInTheDocument();
  });
});

describe("OperationCard — the proof summary is NOT the terminal (AC2)", () => {
  const STATES: Array<{ state: "done" | "live" | "designgate"; run: RunDataJoin | null }> = [
    { state: "done", run: GREEN_RUN },
    { state: "live", run: HELD_RUN },
    { state: "designgate", run: null },
  ];

  it("no xterm element, no canvas, no WebSocket construction in any state", () => {
    const wsSpy = vi.spyOn(globalThis, "WebSocket");
    for (const { state, run } of STATES) {
      missionStateMock.mockReturnValue(state);
      runDetailMock.mockReturnValue(ok(run));
      const { container, unmount } = render(<OperationCard task={TASK} />);

      expect(container.querySelector(".xterm")).toBeNull();
      expect(container.querySelector("canvas")).toBeNull();
      expect(container.querySelector("[data-testid='embedded-terminal']")).toBeNull();
      // no input affordance — a proof summary is read-only.
      expect(container.querySelector("textarea")).toBeNull();
      unmount();
    }
    expect(wsSpy).not.toHaveBeenCalled();
    wsSpy.mockRestore();
  });
});

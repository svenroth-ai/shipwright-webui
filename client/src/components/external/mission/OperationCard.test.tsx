import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ExternalTask } from "../../../lib/externalApi";
import type { RunDataJoin, RunDetailResponse } from "../../../lib/runDataApi";

// AC1: the card consumes A11's useMissionState + A02's useRunDetail — it does NOT
// re-derive state. We mock both hooks and drive the card from their outputs.
const missionStateMock = vi.fn<() => "done" | "live" | "designgate">();
const runDetailMock = vi.fn<() => { data: RunDetailResponse | undefined }>();
vi.mock("../../../hooks/useMissionState", () => ({
  useMissionState: () => missionStateMock(),
}));
vi.mock("../../../hooks/useRunData", () => ({
  useRunDetail: () => runDetailMock(),
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

  it("designgate -> routes to an HONEST placeholder, never a fake verdict", () => {
    missionStateMock.mockReturnValue("designgate");
    runDetailMock.mockReturnValue({ data: undefined });
    render(<OperationCard task={TASK} />);

    expect(screen.getByTestId("operation-designgate-placeholder")).toBeInTheDocument();
    // No verdict banner at all — A12 only routes; A14 owns the gate body.
    expect(screen.queryByTestId("verdict-banner")).not.toBeInTheDocument();
    expect(screen.queryByText("ALL CLEAR")).not.toBeInTheDocument();
  });

  it("empty event log (done, run null) -> NEUTRAL, never a false ALL CLEAR (AC3)", () => {
    missionStateMock.mockReturnValue("done");
    runDetailMock.mockReturnValue(ok(null));
    render(<OperationCard task={TASK} />);

    const banner = screen.getByTestId("verdict-banner");
    expect(banner).toHaveAttribute("data-outcome", "neutral");
    expect(banner).toHaveTextContent("No run data yet");
    expect(banner).not.toHaveTextContent("ALL CLEAR");
    // honest empty summary — never an invented line.
    expect(screen.getByTestId("proof-summary")).toHaveAttribute("data-empty", "true");
  });

  it("DONE task, green suite but unwired gates -> 'Not fully verified', NOT 'In progress' / ALL CLEAR", () => {
    // The common REAL case today: a finished run with green tests but review/security
    // unknown (the server never emits them). It is neither ALL CLEAR nor running.
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

    const banner = screen.getByTestId("verdict-banner");
    expect(banner).toHaveAttribute("data-outcome", "neutral");
    expect(banner).toHaveTextContent("Not fully verified");
    expect(banner).not.toHaveTextContent("ALL CLEAR");
    expect(banner).not.toHaveTextContent("In progress");
    // the honest partial evidence IS shown: the green suite line.
    expect(screen.getByTestId("proof-summary")).toHaveTextContent("suite green");
  });

  it("LIVE run with only partial facts -> 'In progress'", () => {
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
    expect(screen.getByTestId("verdict-banner")).toHaveTextContent("In progress");
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

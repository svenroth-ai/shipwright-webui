import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { ExternalTask } from "../../../lib/externalApi";
import type { ComplianceResponse } from "../../../lib/complianceApi";
import type { RunDetailResponse } from "../../../lib/runDataApi";

import type { MissionContext } from "../../../lib/missionContextApi";

const complianceMock = vi.fn<() => { data: ComplianceResponse | undefined }>();
const runDetailMock = vi.fn<() => { data: RunDetailResponse | undefined }>();
// S1 (AC8) — the Tests + Serves chips now prefer the mission-context resolver.
const missionContextMock = vi.fn<() => { data: MissionContext | undefined }>();
vi.mock("../../../hooks/useProjectCompliance", () => ({
  useProjectCompliance: () => complianceMock(),
}));
vi.mock("../../../hooks/useRunData", () => ({
  useRunDetail: () => runDetailMock(),
}));
vi.mock("../../../hooks/useMissionContext", () => ({
  useMissionContext: () => missionContextMock(),
}));

import { Instruments } from "./Instruments";

const TASK = { projectId: "p1", runId: "iterate-2026-07-15-x" } as unknown as ExternalTask;

beforeEach(() => {
  // Default: the resolver produced nothing, so these legacy cases keep
  // asserting the run-detail fallback path unchanged.
  missionContextMock.mockReturnValue({ data: undefined });
});

afterEach(() => {
  complianceMock.mockReset();
  runDetailMock.mockReset();
  missionContextMock.mockReset();
});

function chipValue(testid: string): string {
  return within(screen.getByTestId(testid)).getByText((_, el) => el?.tagName === "B")
    .textContent as string;
}

describe("Instruments", () => {
  // @covers FR-01.66
  it("renders live values when A01/A02 + compliance data are present", () => {
    complianceMock.mockReturnValue({
      data: { status: "ok", grade: "A", score: 92 } as ComplianceResponse,
    });
    runDetailMock.mockReturnValue({
      data: {
        status: "ok",
        run: { affectedFrs: ["FR-01.55"], tests: { passed: 12, total: 12 } },
      } as RunDetailResponse,
    });
    render(<Instruments task={TASK} />);
    expect(chipValue("instr-grade")).toBe("A");
    expect(chipValue("instr-tests")).toBe("12/12");
    expect(chipValue("instr-serves")).toBe("FR-01.55");
  });

  // @covers FR-01.66
  it("renders an honest empty state (never a fabricated number) without run data", () => {
    complianceMock.mockReturnValue({ data: { status: "missing" } });
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } });
    render(<Instruments task={TASK} />);
    expect(chipValue("instr-grade")).toBe("—");
    expect(chipValue("instr-tests")).toBe("—");
    expect(chipValue("instr-serves")).toBe("—");
    expect(screen.getByTestId("instr-tests")).toHaveAttribute("data-empty", "true");
  });

  // @covers FR-01.66
  it("degrades each chip independently — grade can be real while the run is absent", () => {
    complianceMock.mockReturnValue({
      data: { status: "ok", grade: "B", score: 80 } as ComplianceResponse,
    });
    runDetailMock.mockReturnValue({ data: undefined });
    render(<Instruments task={TASK} />);
    expect(chipValue("instr-grade")).toBe("B");
    expect(chipValue("instr-tests")).toBe("—");
    expect(chipValue("instr-serves")).toBe("—");
  });
});

/*
 * S1 (AC8) — the Tests + Serves chips on a STANDALONE ITERATE.
 *
 * Before this slice both chips read `useRunDetail(task.runId)`. A standalone
 * iterate has no `task.runId` (that field is pipeline-shaped, `run-xxxxxxxx`),
 * so the join was always empty and both chips showed "—" on every iterate.
 * They now prefer the mission-context resolver, which joins by the iterate's
 * own `run_id`.
 */
describe("Instruments — fed by the mission-context resolver (AC8)", () => {
  const ITERATE_TASK = { taskId: "t1", projectId: "p1" } as unknown as ExternalTask;

  function ctx(over: Partial<MissionContext> = {}): MissionContext {
    return {
      schemaVersion: 1,
      scenario: "iterate",
      missionTabVisible: true,
      runId: "iterate-2026-07-18-demo",
    runLive: false,
      artifacts: [],
      tests: { passed: 4940, total: 4941 },
      servesFrId: "FR-01.66",
      sourceRev: "rev",
      ...over,
    };
  }

  // @covers FR-01.66
  it("shows LIVE Tests + Serves on an iterate that has no task.runId at all", () => {
    complianceMock.mockReturnValue({ data: { status: "missing" } });
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } });
    missionContextMock.mockReturnValue({ data: ctx() });
    render(<Instruments task={ITERATE_TASK} />);
    expect(chipValue("instr-tests")).toBe("4940/4941");
    expect(chipValue("instr-serves")).toBe("FR-01.66");
  });

  // @covers FR-01.66
  it("still shows an honest — when the resolver produced nothing", () => {
    complianceMock.mockReturnValue({ data: { status: "missing" } });
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } });
    missionContextMock.mockReturnValue({ data: ctx({ tests: null, servesFrId: null }) });
    render(<Instruments task={ITERATE_TASK} />);
    expect(chipValue("instr-tests")).toBe("—");
    expect(chipValue("instr-serves")).toBe("—");
  });

  // @covers FR-01.66
  it("never fabricates a denominator from a partial tests record", () => {
    complianceMock.mockReturnValue({ data: { status: "missing" } });
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } });
    missionContextMock.mockReturnValue({ data: ctx({ tests: { passed: 12, total: null } }) });
    render(<Instruments task={ITERATE_TASK} />);
    expect(chipValue("instr-tests")).toBe("—");
  });

  // @covers FR-01.66
  it("falls back to the run-detail join for a PIPELINE run (no resolver data)", () => {
    complianceMock.mockReturnValue({ data: { status: "missing" } });
    runDetailMock.mockReturnValue({
      data: {
        status: "ok",
        run: { tests: { passed: 3, total: 3 }, affectedFrs: ["FR-01.10"] },
      } as unknown as RunDetailResponse,
    });
    missionContextMock.mockReturnValue({ data: undefined });
    render(<Instruments task={TASK} />);
    expect(chipValue("instr-tests")).toBe("3/3");
    expect(chipValue("instr-serves")).toBe("FR-01.10");
  });
});

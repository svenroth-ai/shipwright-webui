import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { ExternalTask } from "../../../lib/externalApi";
import type { ComplianceResponse } from "../../../lib/complianceApi";
import type { RunDetailResponse } from "../../../lib/runDataApi";

const complianceMock = vi.fn<() => { data: ComplianceResponse | undefined }>();
const runDetailMock = vi.fn<() => { data: RunDetailResponse | undefined }>();
vi.mock("../../../hooks/useProjectCompliance", () => ({
  useProjectCompliance: () => complianceMock(),
}));
vi.mock("../../../hooks/useRunData", () => ({
  useRunDetail: () => runDetailMock(),
}));

import { Instruments } from "./Instruments";

const TASK = { projectId: "p1", runId: "iterate-2026-07-15-x" } as unknown as ExternalTask;

afterEach(() => {
  complianceMock.mockReset();
  runDetailMock.mockReset();
});

function chipValue(testid: string): string {
  return within(screen.getByTestId(testid)).getByText((_, el) => el?.tagName === "B")
    .textContent as string;
}

describe("Instruments", () => {
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

  it("renders an honest empty state (never a fabricated number) without run data", () => {
    complianceMock.mockReturnValue({ data: { status: "missing" } });
    runDetailMock.mockReturnValue({ data: { status: "ok", run: null } });
    render(<Instruments task={TASK} />);
    expect(chipValue("instr-grade")).toBe("—");
    expect(chipValue("instr-tests")).toBe("—");
    expect(chipValue("instr-serves")).toBe("—");
    expect(screen.getByTestId("instr-tests")).toHaveAttribute("data-empty", "true");
  });

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

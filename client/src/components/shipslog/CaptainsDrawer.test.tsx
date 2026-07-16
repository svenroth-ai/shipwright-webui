/*
 * CaptainsDrawer (A16) — sub-scores render ONLY when the reader parsed the
 * dimension table; ungraded shows an honest strip; "Why an A?" opens the real
 * control record (ComplianceDetailModal). No demo literals.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { CaptainsDrawer } from "./CaptainsDrawer";
import type { ComplianceDimension, ComplianceResponse } from "../../lib/complianceApi";

const complianceMock = vi.fn<() => { data: ComplianceResponse | undefined }>();
vi.mock("../../hooks/useProjectCompliance", () => ({
  useProjectCompliance: () => complianceMock(),
}));

const OK = (dimensions: ComplianceDimension[]): ComplianceResponse => ({
  status: "ok",
  grade: "A",
  score: 98,
  verdict: "Under full control.",
  generatedAt: "2026-07-14T00:00:00Z",
  controlVerdictMarkdown: "## Control Verdict\n\n| | Dimension | Signal | Anchor |",
  ciSecurityMarkdown: "",
  dimensions,
});

beforeEach(() => complianceMock.mockReset());

describe("CaptainsDrawer", () => {
  it("renders sub-scores WHEN the reader parsed the dimension table", () => {
    complianceMock.mockReturnValue({
      data: OK([
        { key: "test-health", label: "Test health", value: "3464/3464", pct: 100, doc: "OpenSSF" },
        { key: "security", label: "Security", value: "0 open high/critical", pct: 100, doc: "NIST" },
      ]),
    });
    render(<CaptainsDrawer projectId="p1" />);
    expect(screen.getByTestId("captains-drawer")).toHaveAttribute("data-graded", "true");
    expect(screen.getByTestId("captains-drawer-subs")).toBeInTheDocument();
    expect(screen.getByTestId("captains-drawer-sub-test-health")).toBeInTheDocument();
    expect(screen.getByTestId("captains-drawer-sub-security")).toBeInTheDocument();
    // Honesty: the eyebrow uses the real grade + score, never a demo literal.
    expect(screen.getByTestId("captains-drawer-eyebrow").textContent).toContain("98/100");
  });

  it("renders NO bars at all when the table was NOT parsed (dimensions empty)", () => {
    complianceMock.mockReturnValue({ data: OK([]) });
    render(<CaptainsDrawer projectId="p1" />);
    expect(screen.getByTestId("captains-drawer")).toHaveAttribute("data-graded", "true");
    expect(screen.queryByTestId("captains-drawer-subs")).toBeNull();
  });

  it("ungraded (missing dashboard) → honest strip, no ring, data-graded=false", () => {
    complianceMock.mockReturnValue({ data: { status: "missing" } });
    render(<CaptainsDrawer projectId="p1" />);
    expect(screen.getByTestId("captains-drawer")).toHaveAttribute("data-graded", "false");
    expect(screen.getByText(/Not graded yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("captains-drawer-why")).toBeNull();
  });

  it("'Why an A?' opens the real control record modal", async () => {
    complianceMock.mockReturnValue({ data: OK([]) });
    render(<CaptainsDrawer projectId="p1" />);
    await userEvent.click(screen.getByTestId("captains-drawer-why"));
    expect(await screen.findByTestId("compliance-detail-modal")).toBeInTheDocument();
  });
});

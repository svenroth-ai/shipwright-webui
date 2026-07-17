import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ComplianceGradeBadge } from "./ComplianceGradeBadge";
import type { ComplianceResponse } from "../../lib/complianceApi";

let mockResult: ComplianceResponse | undefined;
vi.mock("../../hooks/useProjectCompliance", () => ({
  useProjectCompliance: () => ({ data: mockResult }),
}));

function ok(grade: string): ComplianceResponse {
  return {
    status: "ok",
    grade,
    score: 99,
    verdict: "Under full control. Primarily capped by requirement traceability.",
    generatedAt: "2026-06-28T21:55:11.404445+00:00",
    controlVerdictMarkdown:
      "## ✅ Control Verdict\n\n| Dimension | Signal |\n|---|---|\n| Requirement traceability | 41/41 |",
    ciSecurityMarkdown: "## 🛡️ CI Security\n\n| Severity | Count |\n|---|---|\n| Critical | 0 |",
    dimensions: [],
  };
}

describe("ComplianceGradeBadge", () => {
  beforeEach(() => {
    mockResult = undefined;
  });

  // @covers FR-01.43
  it("renders nothing while loading / no data", () => {
    const { container } = render(<ComplianceGradeBadge projectId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  // @covers FR-01.43
  it("renders nothing when the dashboard is missing (AC-B)", () => {
    mockResult = { status: "missing" };
    const { container } = render(<ComplianceGradeBadge projectId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  // @covers FR-01.43
  it("renders nothing when the dashboard is invalid (AC-C)", () => {
    mockResult = { status: "invalid", reason: "no grade" };
    const { container } = render(<ComplianceGradeBadge projectId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  // @covers FR-01.43
  it("renders an A pill (emerald) with the verdict + generated date in the tooltip (AC-F)", () => {
    mockResult = ok("A");
    render(<ComplianceGradeBadge projectId="p1" />);
    const badge = screen.getByTestId("compliance-grade-p1");
    expect(badge).toHaveTextContent("A");
    expect(badge.className).toMatch(/bg-ok-tint/);
    const title = badge.getAttribute("title") ?? "";
    expect(title).toMatch(/Under full control/);
    expect(title).toMatch(/Generated: 2026-06-28/);
  });

  // @covers FR-01.43
  it("maps B → amber and C → red (AC-F)", () => {
    mockResult = ok("B");
    const { rerender } = render(<ComplianceGradeBadge projectId="p1" />);
    expect(screen.getByTestId("compliance-grade-p1").className).toMatch(/bg-warn-tint/);
    mockResult = ok("C");
    rerender(<ComplianceGradeBadge projectId="p1" />);
    expect(screen.getByTestId("compliance-grade-p1").className).toMatch(/bg-err-tint/);
  });

  // @covers FR-01.43
  it("opens the detail modal on click and renders the dimension table (AC-G)", () => {
    mockResult = ok("A");
    render(<ComplianceGradeBadge projectId="p1" />);
    // The dialog must be genuinely absent before the click (not merely
    // hidden) — a no-dialog assertion catches an always-mounted modal.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("compliance-detail-modal")).toBeNull();
    fireEvent.click(screen.getByTestId("compliance-grade-p1"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const modal = screen.getByTestId("compliance-detail-modal");
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveTextContent("Requirement traceability");
    expect(modal).toHaveTextContent("CI Security");
  });

  // @covers FR-01.43
  it("stops click propagation so a clickable parent row is not also triggered", () => {
    mockResult = ok("A");
    const onParent = vi.fn();
    render(
      <div onClick={onParent}>
        <ComplianceGradeBadge projectId="p1" />
      </div>,
    );
    fireEvent.click(screen.getByTestId("compliance-grade-p1"));
    expect(onParent).not.toHaveBeenCalled();
  });
});

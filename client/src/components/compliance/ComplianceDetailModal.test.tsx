import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ComplianceDetailModal } from "./ComplianceDetailModal";

const CONTROL =
  "## ✅ Control Verdict\n\n> **Under full control.**\n\n### Control Grade: **A** (99/100)\n\n| Dimension | Signal |\n|---|---|\n| Requirement traceability | 41/41 FRs |";
const CI = "## 🛡️ CI Security\n\n| Severity | Count |\n|---|---|\n| Critical | 0 |";

function renderModal(over: Partial<Parameters<typeof ComplianceDetailModal>[0]> = {}) {
  return render(
    <ComplianceDetailModal
      open
      onOpenChange={vi.fn()}
      grade="A"
      score={99}
      generatedAt="2026-06-28T21:55:11.404445+00:00"
      controlVerdictMarkdown={CONTROL}
      ciSecurityMarkdown={CI}
      {...over}
    />,
  );
}

describe("ComplianceDetailModal", () => {
  it("shows the grade + generated date in the header (AC-G)", () => {
    renderModal();
    const modal = screen.getByTestId("compliance-detail-modal");
    expect(modal).toHaveTextContent("Grade A (99/100)");
    expect(modal).toHaveTextContent("Generated: 2026-06-28");
  });

  it("renders the control-verdict dimension table as GFM (AC-G)", () => {
    renderModal();
    const modal = screen.getByTestId("compliance-detail-modal");
    // GFM table cell from the control-verdict slice.
    expect(modal.querySelector("table")).not.toBeNull();
    expect(modal).toHaveTextContent("Requirement traceability");
  });

  it("renders the CI-Security section too (AC-G)", () => {
    renderModal();
    expect(screen.getByTestId("compliance-detail-modal")).toHaveTextContent(
      "CI Security",
    );
  });

  it("does not crash when the CI-Security slice is empty (graceful)", () => {
    renderModal({ ciSecurityMarkdown: "" });
    const modal = screen.getByTestId("compliance-detail-modal");
    expect(modal).toHaveTextContent("Requirement traceability");
    expect(modal).not.toHaveTextContent("CI Security");
  });
});

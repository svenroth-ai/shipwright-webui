/*
 * ProofSummary staggered entrance (A20, FR-01.64 — AC1/AC2, integration).
 *
 * Proves the wiring, not a test-only list: the REAL ProofSummary applies the
 * `.motion-stagger-item` entrance to each proof line AND renders every line with
 * its content in the final DOM state. Under reduced motion the stagger is a
 * no-op (media-gated), so all lines are present and none is hidden by default —
 * a component whose lines only appeared via the animation would fail here.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ProofSummary } from "./ProofSummary";
import type { ProofLine } from "../../../lib/proofLines";

function lines(n: number): ProofLine[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `line-${i}`,
    spans: [{ kind: "plain" as const, text: `proof ${i}` }],
  }));
}

describe("ProofSummary — proof lines slide in but rest visible", () => {
  it("renders EVERY line as a staggered-entrance item (nothing gated behind motion)", () => {
    render(<ProofSummary lines={lines(12)} />);
    const items = screen
      .getByTestId("proof-summary")
      .querySelectorAll(".motion-stagger-item");
    expect(items).toHaveLength(12);
    // Content is in its final DOM state, not conditionally hidden.
    expect(screen.getByText("proof 0")).toBeInTheDocument();
    expect(screen.getByText("proof 11")).toBeInTheDocument();
  });

  it("never hides a line by default — no inline opacity:0 on any entry", () => {
    render(<ProofSummary lines={lines(6)} />);
    const items = screen
      .getByTestId("proof-summary")
      .querySelectorAll<HTMLElement>(".motion-stagger-item");
    for (const el of items) {
      expect(el.style.opacity).not.toBe("0");
    }
  });

  it("carries the CAPPED per-line stagger delay (line 30 <= --motion-slow)", () => {
    render(<ProofSummary lines={lines(31)} />);
    const items = screen
      .getByTestId("proof-summary")
      .querySelectorAll<HTMLElement>(".motion-stagger-item");
    const last = items[items.length - 1];
    // 8 * 40ms cap = 320ms, never (30 * 40ms) = 1200ms.
    expect(last.style.getPropertyValue("--stagger-delay")).toBe("320ms");
  });
});

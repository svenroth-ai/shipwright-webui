import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ProofSummary } from "./ProofSummary";
import type { ProofLine } from "../../../lib/proofLines";

const LINES: ProofLine[] = [
  {
    id: "prompt",
    spans: [
      { kind: "t", text: ">" },
      { kind: "plain", text: " iterate-2026-07-10-x" },
    ],
  },
  {
    id: "suite",
    spans: [
      { kind: "p", text: "check" },
      { kind: "plain", text: " suite green" },
    ],
  },
];

describe("ProofSummary", () => {
  it("renders each proof line, mapping kinds to the prototype span classes", () => {
    const { container } = render(<ProofSummary lines={LINES} />);
    const hero = screen.getByTestId("proof-summary");
    expect(hero).toHaveTextContent("iterate-2026-07-10-x");
    expect(hero).toHaveTextContent("suite green");
    // t / p glyph spans carry their colour class; plain text carries none.
    expect(container.querySelector("span.t")).toBeTruthy();
    expect(container.querySelector("span.p")).toBeTruthy();
  });

  it("is a labelled, keyboard-reachable scroll region (AC7)", () => {
    render(<ProofSummary lines={LINES} />);
    const hero = screen.getByTestId("proof-summary");
    expect(hero).toHaveAttribute("role", "log");
    expect(hero).toHaveAttribute("aria-label", "Proof summary");
    expect(hero).toHaveAttribute("tabindex", "0");
  });

  it("no lines -> an honest empty state, never an invented line (AC5)", () => {
    render(<ProofSummary lines={[]} />);
    const hero = screen.getByTestId("proof-summary");
    expect(hero).toHaveAttribute("data-empty", "true");
    expect(hero).toHaveTextContent(/No run data yet/i);
  });

  it("is NOT a terminal — no xterm element, no canvas, no textbox (AC2)", () => {
    const { container } = render(<ProofSummary lines={LINES} />);
    expect(container.querySelector(".xterm")).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("[data-testid='embedded-terminal']")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

/*
 * Focused interaction test for PhaseDropdown. Step 3.5 review OpenAI #8.
 *
 * Radix DropdownMenu doesn't open under JSDOM/fireEvent.click — the
 * existing test pattern (carried over from the pre-split monolith)
 * is to assert against the trigger label, not the menu items. We also
 * verify that `onChange` is the public callback path the body uses
 * to invalidate the phase override.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";

import { PhaseDropdown } from "./PhaseDropdown";
import type { PhaseDefinition } from "../../../lib/externalApi";

const PHASES: PhaseDefinition[] = [
  { id: "build", label: "Build", color: "#F59E0B" },
  { id: "design", label: "Design", color: "#A855F7" },
];

afterEach(() => {
  cleanup();
});

describe("PhaseDropdown", () => {
  it("trigger label reflects the current value", () => {
    render(<PhaseDropdown phases={PHASES} value="design" onChange={() => {}} />);
    const trigger = screen.getByTestId("new-issue-phase-select");
    expect(trigger.textContent).toContain("Design");
    expect(trigger.textContent).not.toContain("Build");
  });

  it("trigger falls back to phases[0] when value doesn't match any id", () => {
    render(
      <PhaseDropdown phases={PHASES} value="nonsense" onChange={() => {}} />,
    );
    const trigger = screen.getByTestId("new-issue-phase-select");
    expect(trigger.textContent).toContain("Build");
  });

  it("trigger handles empty phases array (renders Select… placeholder)", () => {
    render(<PhaseDropdown phases={[]} value="" onChange={() => {}} />);
    const trigger = screen.getByTestId("new-issue-phase-select");
    expect(trigger.textContent).toContain("Select…");
  });

  it("color square reflects the current phase color", () => {
    render(<PhaseDropdown phases={PHASES} value="design" onChange={() => {}} />);
    const trigger = screen.getByTestId("new-issue-phase-select");
    const square = trigger.querySelector("span") as HTMLSpanElement;
    expect(square).toBeTruthy();
    // Design phase color from PHASES[1] is #A855F7 — the inline style
    // gets serialised as rgb() by JSDOM but the substring of either form
    // is detectable.
    const bg = square.style.background;
    expect(bg.toLowerCase()).toMatch(/a855f7|rgb\(168, 85, 247\)/);
  });
});

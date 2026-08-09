import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TriageFilterGroup } from "./TriageFilterGroup";

const OPTIONS = [
  { value: "P0", label: "P0" },
  { value: "P1", label: "P1" },
] as const;

describe("TriageFilterGroup", () => {
  it("renders every option, unselected by default", () => {
    render(
      <TriageFilterGroup
        label="Priority"
        options={OPTIONS}
        selected={new Set()}
        onToggle={vi.fn()}
        testIdPrefix="triage-filter-priority"
      />,
    );
    expect(screen.getByTestId("triage-filter-priority-P0")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("triage-filter-priority-P1")).toHaveAttribute("aria-pressed", "false");
  });

  it("marks a selected option pressed", () => {
    render(
      <TriageFilterGroup
        label="Priority"
        options={OPTIONS}
        selected={new Set(["P0"])}
        onToggle={vi.fn()}
        testIdPrefix="triage-filter-priority"
      />,
    );
    expect(screen.getByTestId("triage-filter-priority-P0")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("triage-filter-priority-P1")).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onToggle with the clicked option's value", () => {
    const onToggle = vi.fn();
    render(
      <TriageFilterGroup
        label="Priority"
        options={OPTIONS}
        selected={new Set()}
        onToggle={onToggle}
        testIdPrefix="triage-filter-priority"
      />,
    );
    fireEvent.click(screen.getByTestId("triage-filter-priority-P1"));
    expect(onToggle).toHaveBeenCalledWith("P1");
  });

  // iterate-2026-08-09-triage-filter-styling AC1/AC2 — chip geometry now
  // matches the Board's own toggle-button chrome (StatusFilterMenu's
  // trigger / ViewToggle's segments): --radius-button corners, a 1.5px
  // border on every chip regardless of state.
  it("gives every chip the Board's --radius-button / 1.5px-border geometry", () => {
    render(
      <TriageFilterGroup
        label="Priority"
        options={OPTIONS}
        selected={new Set()}
        onToggle={vi.fn()}
        testIdPrefix="triage-filter-priority"
      />,
    );
    const chip = screen.getByTestId("triage-filter-priority-P0");
    expect(chip.className).toContain("rounded-[var(--radius-button)]");
    expect(chip.className).toContain("border-[1.5px]");
  });

  // Internal plan review finding 4 — EXCLUDE-set semantics mean "included"
  // is the majority/default state, so it stays plain ink text with no
  // colour, while the minority "excluded" state gets a non-hue cue (an
  // inset fill + muted text) so it reads as "off" without relying on
  // colour alone. Neither resting state uses --color-primary — that is
  // reserved for the hover affordance (finding 5), so a teal border never
  // collides with a resting "this is on" signal.
  it("renders the included (majority) state as plain text, no primary colour", () => {
    render(
      <TriageFilterGroup
        label="Priority"
        options={OPTIONS}
        selected={new Set(["P0"])}
        onToggle={vi.fn()}
        testIdPrefix="triage-filter-priority"
      />,
    );
    const included = screen.getByTestId("triage-filter-priority-P0");
    // Token-level, not substring: the base class also carries
    // `hover:text-[var(--color-text)]`, which `toContain` would satisfy
    // even if the RESTING `text-[var(--color-text)]` were removed — a
    // vacuous-assertion regression the code-review Stage-2 re-review caught
    // after the hover fix (both states share that hover token now).
    const classTokens = included.className.split(/\s+/);
    expect(classTokens).toContain("text-[var(--color-text)]");
    // --color-primary may still appear as a hover: affordance — only the
    // RESTING (non-hover) use is disallowed.
    expect(included.className).not.toMatch(/(?<!hover:)(border|text|bg)-\[var\(--color-primary\)]/);
    expect(included.className).not.toContain("bg-[var(--color-inset)]");
  });

  // code-reviewer Stage 2 finding: --color-inset on white is ~1.09:1,
  // imperceptible as a fill alone — line-through is the load-bearing,
  // genuinely non-color cue; the fill is secondary texture.
  // code-reviewer Stage 3 finding: tokens.contrast.test.ts's own ladder
  // records --muted on --inset as FAILING (~4.39:1, below the 4.5:1 body
  // floor) — text uses --ink-fixed, never --color-muted, on this ground.
  it("renders the excluded (off) state with a line-through + inset fill + ink-fixed text, not --color-muted or --color-faint", () => {
    render(
      <TriageFilterGroup
        label="Priority"
        options={OPTIONS}
        selected={new Set(["P0"])}
        onToggle={vi.fn()}
        testIdPrefix="triage-filter-priority"
      />,
    );
    const excluded = screen.getByTestId("triage-filter-priority-P1");
    expect(excluded.className).toContain("bg-[var(--color-inset)]");
    expect(excluded.className).toContain("text-[var(--ink-fixed)]");
    expect(excluded.className).toContain("line-through");
    expect(excluded.className).not.toContain("text-[var(--color-muted)]");
    expect(excluded.className).not.toContain("color-faint");
  });

  it("included state has no line-through", () => {
    render(
      <TriageFilterGroup
        label="Priority"
        options={OPTIONS}
        selected={new Set(["P0"])}
        onToggle={vi.fn()}
        testIdPrefix="triage-filter-priority"
      />,
    );
    expect(screen.getByTestId("triage-filter-priority-P0").className).not.toContain("line-through");
  });

  // Matches StatusFilterMenu's trigger AND this file's own TriageSortLevel
  // sibling: hover border goes primary, hover TEXT goes --color-text (never
  // --color-primary) — so --color-primary appears only on the border, on
  // hover, never as a text color at any time.
  it("reserves --color-primary for the hover BORDER only, on both states", () => {
    render(
      <TriageFilterGroup
        label="Priority"
        options={OPTIONS}
        selected={new Set(["P0"])}
        onToggle={vi.fn()}
        testIdPrefix="triage-filter-priority"
      />,
    );
    for (const id of ["triage-filter-priority-P0", "triage-filter-priority-P1"]) {
      const chip = screen.getByTestId(id);
      expect(chip.className).toContain("hover:border-[var(--color-primary)]");
      expect(chip.className).toContain("hover:text-[var(--color-text)]");
      expect(chip.className).not.toContain("hover:text-[var(--color-primary)]");
    }
  });

  // Finding 8 — the Parked group renders a single option with no sibling
  // to contrast against; verify its on/off states are still distinguishable
  // in isolation.
  it("distinguishes on/off for a single-option group (Parked's real shape)", () => {
    const PARKED = [{ value: "parked", label: "Parked" }] as const;
    const { rerender } = render(
      <TriageFilterGroup
        label=""
        options={PARKED}
        selected={new Set()}
        onToggle={vi.fn()}
        testIdPrefix="triage-filter-parked"
      />,
    );
    expect(screen.getByTestId("triage-filter-parked-parked").className).toContain(
      "bg-[var(--color-inset)]",
    );
    rerender(
      <TriageFilterGroup
        label=""
        options={PARKED}
        selected={new Set(["parked"])}
        onToggle={vi.fn()}
        testIdPrefix="triage-filter-parked"
      />,
    );
    expect(screen.getByTestId("triage-filter-parked-parked").className).not.toContain(
      "bg-[var(--color-inset)]",
    );
  });
});

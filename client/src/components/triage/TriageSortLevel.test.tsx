import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TriageSortLevel } from "./TriageSortLevel";

describe("TriageSortLevel", () => {
  it("renders the current key and direction", () => {
    render(
      <TriageSortLevel
        label="Primary"
        level={{ key: "modified", direction: "desc" }}
        onChange={vi.fn()}
        testIdPrefix="triage-sort-primary"
      />,
    );
    expect(screen.getByTestId("triage-sort-primary-key")).toHaveValue("modified");
    expect(screen.getByTestId("triage-sort-primary-direction")).toHaveAttribute(
      "aria-label",
      "Primary sort direction: Descending",
    );
  });

  it("distinguishes itself for assistive tech via ariaLabel, independent of the sibling level, while keeping the visible label IN the accessible name — WCAG 2.5.3 Label in Name (code-reviewer finding, tightened at re-review NEW-5)", () => {
    render(
      <TriageSortLevel
        label="then"
        ariaLabel="Secondary"
        level={{ key: "name", direction: "asc" }}
        onChange={vi.fn()}
        testIdPrefix="triage-sort-secondary"
      />,
    );
    // "Secondary" makes it distinguishable from "Primary"; "then" (the
    // visible label) stays IN the name rather than being replaced by it —
    // a voice-control user reading "then" on screen can still address
    // this control by that text.
    expect(screen.getByTestId("triage-sort-secondary-key")).toHaveAttribute(
      "aria-label",
      "Secondary — then sort key",
    );
    expect(screen.getByTestId("triage-sort-secondary-direction")).toHaveAttribute(
      "aria-label",
      "Secondary — then sort direction: Ascending",
    );
  });

  it("changes the key independently of direction", () => {
    const onChange = vi.fn();
    render(
      <TriageSortLevel
        label="Primary"
        level={{ key: "modified", direction: "desc" }}
        onChange={onChange}
        testIdPrefix="triage-sort-primary"
      />,
    );
    fireEvent.change(screen.getByTestId("triage-sort-primary-key"), { target: { value: "name" } });
    expect(onChange).toHaveBeenCalledWith({ key: "name", direction: "desc" });
  });

  it("toggles direction independently of key", () => {
    const onChange = vi.fn();
    render(
      <TriageSortLevel
        label="Primary"
        level={{ key: "modified", direction: "desc" }}
        onChange={onChange}
        testIdPrefix="triage-sort-primary"
      />,
    );
    fireEvent.click(screen.getByTestId("triage-sort-primary-direction"));
    expect(onChange).toHaveBeenCalledWith({ key: "modified", direction: "asc" });
  });
});

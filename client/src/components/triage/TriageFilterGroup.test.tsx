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
});

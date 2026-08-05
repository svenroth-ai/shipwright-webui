import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SnoozeRevisitField } from "./SnoozeRevisitField";

describe("SnoozeRevisitField", () => {
  it("renders the current value", () => {
    render(<SnoozeRevisitField value="2099-01-01" onChange={vi.fn()} />);
    expect(screen.getByTestId("triage-snooze-revisit-date")).toHaveValue("2099-01-01");
  });

  it("calls onChange with the new value", () => {
    const onChange = vi.fn();
    render(<SnoozeRevisitField value="" onChange={onChange} />);
    fireEvent.change(screen.getByTestId("triage-snooze-revisit-date"), {
      target: { value: "2099-06-15" },
    });
    expect(onChange).toHaveBeenCalledWith("2099-06-15");
  });

  it("disables the input when disabled is set", () => {
    render(<SnoozeRevisitField value="" onChange={vi.fn()} disabled />);
    expect(screen.getByTestId("triage-snooze-revisit-date")).toBeDisabled();
  });
});

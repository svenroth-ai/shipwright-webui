/*
 * RuntimeToggle — Codex Light (Spec/codex-light-webui.md §3.5).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { RuntimeToggle } from "./RuntimeToggle";

describe("RuntimeToggle (Codex Light §3.5)", () => {
  it("renders both segments", () => {
    render(<RuntimeToggle value="claude" onChange={() => {}} />);
    expect(screen.getByTestId("runtime-claude")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-codex")).toBeInTheDocument();
  });

  it("marks the current value checked via aria-checked", () => {
    render(<RuntimeToggle value="claude" onChange={() => {}} />);
    expect(screen.getByTestId("runtime-claude").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByTestId("runtime-codex").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("flips aria-checked when value is codex", () => {
    render(<RuntimeToggle value="codex" onChange={() => {}} />);
    expect(screen.getByTestId("runtime-claude").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(screen.getByTestId("runtime-codex").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("calls onChange with 'codex' when the Codex segment is clicked", async () => {
    const onChange = vi.fn();
    render(<RuntimeToggle value="claude" onChange={onChange} />);
    await userEvent.click(screen.getByTestId("runtime-codex"));
    expect(onChange).toHaveBeenCalledWith("codex");
  });

  it("calls onChange with 'claude' when the Claude segment is clicked", async () => {
    const onChange = vi.fn();
    render(<RuntimeToggle value="codex" onChange={onChange} />);
    await userEvent.click(screen.getByTestId("runtime-claude"));
    expect(onChange).toHaveBeenCalledWith("claude");
  });

  it("exposes a radiogroup for accessibility", () => {
    render(<RuntimeToggle value="claude" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Runtime" })).toBeInTheDocument();
  });
});

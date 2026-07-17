/*
 * CommandPalette — AC2 (glass), AC4 (opens/filters/runs), AC7 (clickable), AC9
 * (Launch from provided actions only).
 */
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./CommandPalette";
import type { Command } from "../../lib/commandRegistry";

function cmds(runs: Record<string, () => void> = {}): Command[] {
  return [
    { id: "open:board", group: "open", label: "Open Task Board", run: runs["open:board"] ?? vi.fn() },
    { id: "open:triage", group: "open", label: "Open Triage", run: runs["open:triage"] ?? vi.fn() },
    { id: "jump:p1", group: "jump", label: "Alpha", run: runs["jump:p1"] ?? vi.fn() },
    { id: "launch:new-iterate", group: "launch", label: "New Iterate", hint: "Run an iterate", run: runs["launch:new-iterate"] ?? vi.fn() },
  ];
}

afterEach(() => cleanup());

describe("CommandPalette", () => {
  // @covers FR-01.65
  it("renders the GLASS shell when open (AC2)", () => {
    render(<CommandPalette open onOpenChange={vi.fn()} commands={cmds()} />);
    const palette = screen.getByTestId("command-palette");
    expect(palette).toHaveClass("cmd-palette");
  });

  // @covers FR-01.65
  it("lists grouped commands", () => {
    render(<CommandPalette open onOpenChange={vi.fn()} commands={cmds()} />);
    expect(screen.getByTestId("command-item-open:board")).toBeInTheDocument();
    expect(screen.getByTestId("command-item-launch:new-iterate")).toBeInTheDocument();
  });

  // @covers FR-01.65
  it("filters on query", () => {
    render(<CommandPalette open onOpenChange={vi.fn()} commands={cmds()} />);
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "triage" },
    });
    expect(screen.getByTestId("command-item-open:triage")).toBeInTheDocument();
    expect(screen.queryByTestId("command-item-launch:new-iterate")).toBeNull();
  });

  // @covers FR-01.65
  it("shows an honest empty result for a non-match", () => {
    render(<CommandPalette open onOpenChange={vi.fn()} commands={cmds()} />);
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "zzzq" },
    });
    expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
  });

  // @covers FR-01.65
  it("runs the selected command on Enter (AC4)", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        commands={cmds({ "launch:new-iterate": run })}
      />,
    );
    // Narrow to a single deterministic result, then Enter runs it.
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "iterate" },
    });
    fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "Enter" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  // @covers FR-01.65
  it("moves the selection with ArrowDown", () => {
    render(<CommandPalette open onOpenChange={vi.fn()} commands={cmds()} />);
    const input = screen.getByTestId("command-palette-input");
    // Filter to the two Open results in a deterministic order.
    fireEvent.change(input, { target: { value: "open" } });
    expect(screen.getByTestId("command-item-open:board")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByTestId("command-item-open:triage")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // @covers FR-01.65
  it("runs a command on click (AC7 — clickable equivalent)", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        commands={cmds({ "jump:p1": run })}
      />,
    );
    fireEvent.click(screen.getByTestId("command-item-jump:p1"));
    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  // @covers FR-01.65
  it("floats recent commands into a Recent section first", () => {
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        commands={cmds()}
        recentIds={["launch:new-iterate"]}
      />,
    );
    const list = screen.getByRole("listbox");
    // The first option in the list is the recent one.
    const firstOption = within(list).getAllByRole("option")[0];
    expect(firstOption).toHaveAttribute("data-testid", "command-item-launch:new-iterate");
  });

  // @covers FR-01.65
  it("has an accessible dialog label and combobox input (AC7)", () => {
    render(<CommandPalette open onOpenChange={vi.fn()} commands={cmds()} />);
    expect(screen.getByRole("dialog", { name: /command palette/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});

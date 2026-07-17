import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { MissionSegmented, type SegmentOption } from "./MissionSegmented";

type V = "a" | "b" | "c";
const OPTIONS: SegmentOption<V>[] = [
  { value: "a", label: "Alpha", testId: "seg-a" },
  { value: "b", label: "Beta", testId: "seg-b" },
  { value: "c", label: "Gamma", testId: "seg-c" },
];

function setup(value: V = "a") {
  const onChange = vi.fn();
  const utils = render(
    <MissionSegmented options={OPTIONS} value={value} onChange={onChange} ariaLabel="Pick one" />,
  );
  return { onChange, ...utils };
}

describe("MissionSegmented", () => {
  // @covers FR-01.57
  it("is a radiogroup (NOT a tablist) so it never collides with getByRole('tab')", () => {
    setup();
    expect(screen.getByRole("radiogroup", { name: "Pick one" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    // The regression this guards: a 'Files & Terminal' tab must not match a
    // /terminal/ tab query — proven here by there being NO tab role at all.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  // @covers FR-01.57
  it("marks only the selected option checked, with roving tabindex", () => {
    setup("b");
    const a = screen.getByTestId("seg-a");
    const b = screen.getByTestId("seg-b");
    expect(b).toHaveAttribute("aria-checked", "true");
    expect(b).toHaveAttribute("tabindex", "0");
    expect(a).toHaveAttribute("aria-checked", "false");
    expect(a).toHaveAttribute("tabindex", "-1");
  });

  // @covers FR-01.57
  it("clicking an option selects it", () => {
    const { onChange } = setup("a");
    fireEvent.click(screen.getByTestId("seg-c"));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  // @covers FR-01.57
  it("ArrowRight/ArrowDown move to the next option (wrapping)", () => {
    const { onChange } = setup("c");
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("a"); // wraps c → a
  });

  // @covers FR-01.57
  it("ArrowLeft/ArrowUp move to the previous option (wrapping)", () => {
    const { onChange } = setup("a");
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("c"); // wraps a → c
  });

  // @covers FR-01.57
  it("Home/End jump to the first/last option", () => {
    const { onChange } = setup("b");
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "Home" });
    expect(onChange).toHaveBeenCalledWith("a");
    fireEvent.keyDown(group, { key: "End" });
    expect(onChange).toHaveBeenCalledWith("c");
  });

  // @covers FR-01.57
  it("the ft-seg variant adds the .ft-seg class A18 reuses", () => {
    render(
      <MissionSegmented
        options={OPTIONS}
        value="a"
        onChange={vi.fn()}
        ariaLabel="FT"
        variant="ft-seg"
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "FT" })).toHaveClass("mc-tabs", "ft-seg");
  });
});

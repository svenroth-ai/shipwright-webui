/*
 * useSplitterKeydown — keyboard contract of the three-pane splitters.
 * Extracted from TaskDetailThreePane (bloat H1, iterate-2026-10-09); these
 * tests pin the moved behavior directly instead of only through the shell.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";

import { STEP_PX } from "../../hooks/useThreePaneLayout";
import { useSplitterKeydown } from "./useSplitterKeydown";

type Layout = Parameters<typeof useSplitterKeydown>[0]["layout"];

function makeLayout(over: Partial<Layout> = {}) {
  return {
    maximized: false,
    leftCollapsed: false,
    rightCollapsed: false,
    nudgeLeft: vi.fn(),
    nudgeRight: vi.fn(),
    toggleLeftCollapsed: vi.fn(),
    toggleRightCollapsed: vi.fn(),
    ...over,
  } as unknown as Layout;
}

function key(k: string) {
  const preventDefault = vi.fn();
  return { event: { key: k, preventDefault } as unknown as KeyboardEvent, preventDefault };
}

function setup(layout: Layout, tablet = false) {
  const toggleTabletViewer = vi.fn();
  const { result } = renderHook(() => useSplitterKeydown({ layout, tablet, toggleTabletViewer }));
  return { ...result.current, toggleTabletViewer };
}

// @covers FR-01.02
describe("useSplitterKeydown — left splitter", () => {
  it("nudges by STEP_PX on arrows and toggles collapse on Enter", () => {
    const layout = makeLayout();
    const { leftSplitterKeydown } = setup(layout);
    leftSplitterKeydown(key("ArrowLeft").event);
    leftSplitterKeydown(key("ArrowRight").event);
    leftSplitterKeydown(key("Enter").event);
    expect(layout.nudgeLeft).toHaveBeenNthCalledWith(1, -STEP_PX);
    expect(layout.nudgeLeft).toHaveBeenNthCalledWith(2, STEP_PX);
    expect(layout.toggleLeftCollapsed).toHaveBeenCalledTimes(1);
  });

  it("left: Enter/Space re-open a collapsed pane, arrows do nothing", () => {
    const layout = makeLayout({ leftCollapsed: true });
    const { leftSplitterKeydown } = setup(layout);
    leftSplitterKeydown(key("ArrowLeft").event);
    leftSplitterKeydown(key(" ").event);
    expect(layout.nudgeLeft).not.toHaveBeenCalled();
    expect(layout.toggleLeftCollapsed).toHaveBeenCalledTimes(1);
  });

  it("ignores every key while focus mode (maximized) owns the widths", () => {
    const layout = makeLayout({ maximized: true });
    const { leftSplitterKeydown, rightSplitterKeydown } = setup(layout);
    const k = key("Enter");
    leftSplitterKeydown(k.event);
    rightSplitterKeydown(k.event);
    expect(k.preventDefault).not.toHaveBeenCalled();
    expect(layout.toggleLeftCollapsed).not.toHaveBeenCalled();
    expect(layout.toggleRightCollapsed).not.toHaveBeenCalled();
  });
});

// @covers FR-01.02
describe("useSplitterKeydown — right splitter", () => {
  it("nudges with inverted direction and toggles collapse on Enter", () => {
    const layout = makeLayout();
    const { rightSplitterKeydown } = setup(layout);
    rightSplitterKeydown(key("ArrowLeft").event);
    rightSplitterKeydown(key("ArrowRight").event);
    rightSplitterKeydown(key("Enter").event);
    expect(layout.nudgeRight).toHaveBeenNthCalledWith(1, STEP_PX);
    expect(layout.nudgeRight).toHaveBeenNthCalledWith(2, -STEP_PX);
    expect(layout.toggleRightCollapsed).toHaveBeenCalledTimes(1);
  });

  it("right: Enter/Space re-open a collapsed pane, arrows do nothing", () => {
    const layout = makeLayout({ rightCollapsed: true });
    const { rightSplitterKeydown } = setup(layout);
    rightSplitterKeydown(key("ArrowRight").event);
    rightSplitterKeydown(key("Enter").event);
    expect(layout.nudgeRight).not.toHaveBeenCalled();
    expect(layout.toggleRightCollapsed).toHaveBeenCalledTimes(1);
  });

  it("on the tablet band Enter toggles the transient viewer, never the persisted pref", () => {
    const layout = makeLayout();
    const { rightSplitterKeydown, toggleTabletViewer } = setup(layout, true);
    rightSplitterKeydown(key("ArrowLeft").event);
    rightSplitterKeydown(key("Enter").event);
    expect(toggleTabletViewer).toHaveBeenCalledTimes(1);
    expect(layout.toggleRightCollapsed).not.toHaveBeenCalled();
    expect(layout.nudgeRight).not.toHaveBeenCalled();
  });
});

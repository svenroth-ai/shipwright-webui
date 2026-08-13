/* Three-pane structure, persistence, keyboard, and compact-mode regression tests. */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { TaskDetailThreePane } from "./TaskDetailThreePane";
import {
  STORAGE_KEYS,
  DEFAULT_LEFT,
  DEFAULT_RIGHT,
  STEP_PX,
} from "../../hooks/useThreePaneLayout";

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

function fireKey(el: Element, key: string) {
  act(() => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true });
    el.dispatchEvent(event);
  });
}

describe("TaskDetailThreePane — structure + keyboard", () => {
  it("renders children in three slots with two splitters", () => {
    render(
      <TaskDetailThreePane
        containerWidth={1200}
        left={<div data-testid="slot-left">left</div>}
        center={<div data-testid="slot-center">center</div>}
        right={<div data-testid="slot-right">right</div>}
      />,
    );
    expect(screen.getByTestId("slot-left")).toBeTruthy();
    expect(screen.getByTestId("slot-center")).toBeTruthy();
    expect(screen.getByTestId("slot-right")).toBeTruthy();
    expect(screen.getByTestId("splitter-left")).toBeTruthy();
    expect(screen.getByTestId("splitter-right")).toBeTruthy();
  });

  it("splitter handles have role=\"separator\" + aria-valuenow synced to hook", () => {
    render(
      <TaskDetailThreePane
        containerWidth={1200}
        left={<div />}
        center={<div />}
        right={<div />}
      />,
    );
    const left = screen.getByTestId("splitter-left");
    expect(left.getAttribute("role")).toBe("separator");
    expect(left.getAttribute("aria-valuenow")).toBe(String(DEFAULT_LEFT));
    const right = screen.getByTestId("splitter-right");
    expect(right.getAttribute("role")).toBe("separator");
    expect(right.getAttribute("aria-valuenow")).toBe(String(DEFAULT_RIGHT));
  });

  it("ArrowRight on left splitter nudges leftWidth +10 px", () => {
    render(
      <TaskDetailThreePane
        containerWidth={1200}
        left={<div />}
        center={<div />}
        right={<div />}
      />,
    );
    const left = screen.getByTestId("splitter-left");
    fireKey(left, "ArrowRight");
    expect(left.getAttribute("aria-valuenow")).toBe(String(DEFAULT_LEFT + STEP_PX));
  });

  it("ArrowLeft on left splitter nudges leftWidth -10 px", () => {
    render(
      <TaskDetailThreePane
        containerWidth={1200}
        left={<div />}
        center={<div />}
        right={<div />}
      />,
    );
    const left = screen.getByTestId("splitter-left");
    fireKey(left, "ArrowLeft");
    expect(left.getAttribute("aria-valuenow")).toBe(String(DEFAULT_LEFT - STEP_PX));
  });

  it("Enter on left splitter toggles collapsed state (persists immediately)", () => {
    render(
      <TaskDetailThreePane
        containerWidth={1200}
        left={<div />}
        center={<div />}
        right={<div />}
      />,
    );
    const left = screen.getByTestId("splitter-left");
    // The initial effect must not persist a collapsed state.
    expect(localStorage.getItem(STORAGE_KEYS.leftCollapsed) ?? "false").toBe("false");
    fireKey(left, "Enter");
    expect(localStorage.getItem(STORAGE_KEYS.leftCollapsed)).toBe("true");
    fireKey(left, "Enter");
    expect(localStorage.getItem(STORAGE_KEYS.leftCollapsed)).toBe("false");
  });

  it("ArrowLeft on right splitter grows rightWidth (+STEP_PX) — the right splitter's semantic is reversed vs. left", () => {
    render(
      <TaskDetailThreePane
        containerWidth={1200}
        left={<div />}
        center={<div />}
        right={<div />}
      />,
    );
    const right = screen.getByTestId("splitter-right");
    fireKey(right, "ArrowLeft");
    expect(right.getAttribute("aria-valuenow")).toBe(String(DEFAULT_RIGHT + STEP_PX));
  });

  it("Enter on right splitter toggles rightCollapsed", () => {
    render(
      <TaskDetailThreePane
        containerWidth={1200}
        left={<div />}
        center={<div />}
        right={<div />}
      />,
    );
    const right = screen.getByTestId("splitter-right");
    fireKey(right, "Enter");
    expect(localStorage.getItem(STORAGE_KEYS.rightCollapsed)).toBe("true");
  });
});

describe("TaskDetailThreePane — collapsed rendering", () => {
  it("collapsed-left sets data-collapsed on the left pane", () => {
    localStorage.setItem(STORAGE_KEYS.leftCollapsed, "true");
    render(
      <TaskDetailThreePane
        containerWidth={1200}
        left={<div />}
        center={<div />}
        right={<div />}
      />,
    );
    expect(screen.getByTestId("pane-left").getAttribute("data-collapsed")).toBe("true");
  });

  it("collapsed-right sets data-collapsed on the right pane", () => {
    localStorage.setItem(STORAGE_KEYS.rightCollapsed, "true");
    render(
      <TaskDetailThreePane
        containerWidth={1200}
        left={<div />}
        center={<div />}
        right={<div />}
      />,
    );
    expect(screen.getByTestId("pane-right").getAttribute("data-collapsed")).toBe("true");
  });
});

describe("TaskDetailThreePane — compact (tablet ≤1023px)", () => {
  // jsdom has no matchMedia, so compact mode is explicit.
  const originalMatchMedia = window.matchMedia;

  function setCompact(compact: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: compact,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  function renderCompact() {
    setCompact(true);
    return render(
      <TaskDetailThreePane
        containerWidth={820}
        left={<div data-testid="slot-left">left</div>}
        center={<div data-testid="slot-center">center</div>}
        right={<div data-testid="slot-right">right</div>}
      />,
    );
  }

  it("renders the pane tab bar and hides the resize handles", () => {
    renderCompact();
    expect(screen.getByTestId("pane-tab-bar")).toBeTruthy();
    expect(screen.getByTestId("splitter-left").className).toContain("hidden");
    expect(screen.getByTestId("splitter-right").className).toContain("hidden");
  });

  it("keeps ALL THREE pane children mounted across tab switches (terminal never unmounts — plan-review C1/C2)", () => {
    renderCompact();
    expect(screen.getByTestId("slot-left")).toBeTruthy();
    expect(screen.getByTestId("slot-center")).toBeTruthy();
    expect(screen.getByTestId("slot-right")).toBeTruthy();
    // Switch Files → Viewer: the center (terminal) subtree must stay in the DOM.
    fireEvent.click(screen.getByTestId("pane-tab-left"));
    expect(screen.getByTestId("pane-tab-left")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("slot-left")).toBeTruthy();
    expect(screen.getByTestId("slot-center")).toBeTruthy();
    expect(screen.getByTestId("slot-right")).toBeTruthy();
    fireEvent.click(screen.getByTestId("pane-tab-right"));
    expect(screen.getByTestId("pane-tab-right")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("slot-center")).toBeTruthy();
  });

  it("renders the controlled Terminal destination and reports selection changes", () => {
    setCompact(true);
    const onActivePaneChange = vi.fn();
    render(
      <TaskDetailThreePane
        containerWidth={820}
        activePane="center"
        onActivePaneChange={onActivePaneChange}
        left={<div />}
        center={<div />}
        right={<div />}
      />,
    );
    expect(screen.getByTestId("pane-tab-terminal").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByTestId("pane-tab-left"));
    expect(onActivePaneChange).toHaveBeenCalledWith("left");
    expect(screen.getByTestId("pane-tab-terminal").getAttribute("aria-selected")).toBe("true");
  });

  it("reports outer-pane visibility so the terminal active/refit path can follow it", () => {
    setCompact(true);
    const onActivePaneChange = vi.fn();
    render(
      <TaskDetailThreePane
        containerWidth={820}
        onActivePaneChange={onActivePaneChange}
        left={<div />}
        center={<div />}
        right={<div />}
      />,
    );
    fireEvent.click(screen.getByTestId("pane-tab-right"));
    expect(screen.getByTestId("pane-tab-right")).toHaveAttribute("aria-selected", "true");
    expect(onActivePaneChange).toHaveBeenLastCalledWith("right");
    fireEvent.click(screen.getByTestId("pane-tab-terminal"));
    expect(onActivePaneChange).toHaveBeenLastCalledWith("center");
  });

  it("uses one controlled pane for sizing, tab semantics, and inactive focus suppression", () => {
    setCompact(true);
    const props = {
      containerWidth: 820,
      centerTab: "terminal" as const,
      onCenterTabChange: vi.fn(),
      onActivePaneChange: vi.fn(),
      left: <button>Left control</button>,
      center: <button>Terminal control</button>,
      right: <button>Viewer control</button>,
    };
    const view = render(<TaskDetailThreePane {...props} activePane="right" />);

    expect(screen.getByTestId("pane-tab-right")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("pane-right")).toHaveAttribute("role", "tabpanel");
    expect(screen.getByTestId("pane-right")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("pane-center")).toHaveAttribute("inert");
    expect(screen.getByTestId("pane-center")).toHaveAttribute("aria-hidden", "true");

    view.rerender(<TaskDetailThreePane {...props} activePane="center" />);
    expect(screen.getByTestId("pane-tab-terminal")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("pane-center")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("pane-right")).toHaveAttribute("inert");
  });

  it("does NOT render the tab bar on desktop (≥1024px) and keeps handles visible", () => {
    setCompact(false);
    render(
      <TaskDetailThreePane
        containerWidth={1280}
        left={<div />}
        center={<div />}
        right={<div />}
      />,
    );
    expect(screen.queryByTestId("pane-tab-bar")).toBeNull();
    expect(screen.getByTestId("splitter-left").className).not.toContain("hidden");
  });
});

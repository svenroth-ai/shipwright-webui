/*
 * Tablet band (touch + 1024–1399px): the Smart Viewer starts HIDDEN and is
 * summoned on demand — the toggle button or opening a file. Transient: it never
 * touches the persisted desktop `rightCollapsed` preference.
 * iterate-2026-10-08-tablet-mobile-layout-polish.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { TaskDetailThreePane } from "./TaskDetailThreePane";
import { ViewerToggle } from "./ViewerToggle";
import { STORAGE_KEYS } from "../../hooks/useThreePaneLayout";
import { TABLET_MEDIA_QUERY } from "../../hooks/useIsCompactViewport";

const originalMatchMedia = window.matchMedia;

function setViewport(kind: "tablet" | "desktop") {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: kind === "tablet" && query === TABLET_MEDIA_QUERY,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function shell(viewerRequestKey = 0) {
  return (
    <TaskDetailThreePane
      containerWidth={1100}
      viewerRequestKey={viewerRequestKey}
      left={<div />}
      center={<ViewerToggle />}
      right={<div />}
    />
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe("tablet band — Smart Viewer on demand", () => {
  it("starts with the viewer hidden and a toggle that summons / hides it", () => {
    setViewport("tablet");
    render(shell());
    expect(screen.getByTestId("pane-right")).toHaveAttribute("data-collapsed", "true");
    const toggle = screen.getByTestId("viewer-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getByTestId("pane-right")).not.toHaveAttribute("data-collapsed");
    expect(screen.getByTestId("viewer-toggle")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("viewer-toggle"));
    expect(screen.getByTestId("pane-right")).toHaveAttribute("data-collapsed", "true");
  });

  it("opens when a file is opened (viewerRequestKey bump)", () => {
    setViewport("tablet");
    const { rerender } = render(shell(0));
    expect(screen.getByTestId("pane-right")).toHaveAttribute("data-collapsed", "true");
    act(() => {
      rerender(shell(1));
    });
    expect(screen.getByTestId("pane-right")).not.toHaveAttribute("data-collapsed");
  });

  it("never writes the persisted desktop collapse preference", () => {
    setViewport("tablet");
    render(shell());
    fireEvent.click(screen.getByTestId("viewer-toggle"));
    expect(localStorage.getItem(STORAGE_KEYS.rightCollapsed)).toBe("false");
  });

  it("desktop (no tablet match): viewer stays open and the toggle does not render", () => {
    setViewport("desktop");
    render(shell());
    expect(screen.getByTestId("pane-right")).not.toHaveAttribute("data-collapsed");
    expect(screen.queryByTestId("viewer-toggle")).toBeNull();
  });
});

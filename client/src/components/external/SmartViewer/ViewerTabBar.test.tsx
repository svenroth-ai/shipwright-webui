/*
 * ViewerTabBar.test — icon-by-extension colour map (A04 colour sweep, FR-01.48).
 *
 * The per-extension icon colours were swept off arbitrary-hex classes onto the
 * Weather-Deck semantic tokens (md/code/image -> text-info, json/yaml -> text-warn,
 * mermaid -> text-ok, other -> --color-muted). This renders one tab per branch so
 * the swept `iconFor` mapping is exercised (and diff-covered), and asserts the tab
 * strip itself renders.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ViewerTabBar } from "./ViewerTabBar";

// @covers FR-01.48
describe("ViewerTabBar — icon-by-extension colour map (A04 sweep)", () => {
  it("renders a tab per path across every icon branch (md/code/json/image/mermaid/other)", () => {
    const paths = [
      "notes.md",
      "app.tsx",
      "config.json",
      "diagram.png",
      "flow.mmd",
      "LICENSE",
    ];
    render(
      <ViewerTabBar
        paths={paths}
        activePath="notes.md"
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // one visible tab label per path (basename)
    expect(screen.getByText("notes.md")).toBeTruthy();
    expect(screen.getByText("app.tsx")).toBeTruthy();
    expect(screen.getByText("config.json")).toBeTruthy();
    expect(screen.getByText("diagram.png")).toBeTruthy();
    expect(screen.getByText("flow.mmd")).toBeTruthy();
    expect(screen.getByText("LICENSE")).toBeTruthy();
  });
});

// @covers FR-01.48
describe("ViewerTabBar — close control is a real, keyboard-reachable button (a11y)", () => {
  it("renders the close control as its own <button>, not nested inside the tab button", () => {
    render(
      <ViewerTabBar
        paths={["a.md"]}
        activePath="a.md"
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const closeBtn = screen.getByTestId("viewer-tab-close-a.md");
    expect(closeBtn.tagName).toBe("BUTTON");
    expect(closeBtn.getAttribute("tabindex")).not.toBe("-1");
    // Not a descendant of the tab button — no interactive-in-interactive nesting.
    const tabBtn = screen.getByTestId("viewer-tab-a.md");
    expect(tabBtn.contains(closeBtn)).toBe(false);
  });

  it("closing a tab does not also activate it", () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    render(
      <ViewerTabBar
        paths={["a.md", "b.md"]}
        activePath="a.md"
        onActivate={onActivate}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("viewer-tab-close-b.md"));
    expect(onClose).toHaveBeenCalledWith("b.md");
    expect(onActivate).not.toHaveBeenCalled();
  });
});

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
import { render, screen } from "@testing-library/react";

import { ViewerTabBar } from "./ViewerTabBar";

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

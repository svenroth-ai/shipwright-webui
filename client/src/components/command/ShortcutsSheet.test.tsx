/*
 * ShortcutsSheet — AC3 (both chords, Windows-correct) + AC4 (every registry
 * entry appears — no secret shortcut).
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShortcutsSheet } from "./ShortcutsSheet";
import { KEYBOARD_SHORTCUTS } from "../../lib/commandRegistry";

afterEach(() => cleanup());

describe("ShortcutsSheet", () => {
  it("renders every KEYBOARD_SHORTCUTS entry (no secret shortcut — AC4)", () => {
    render(<ShortcutsSheet open onOpenChange={vi.fn()} />);
    for (const s of KEYBOARD_SHORTCUTS) {
      expect(screen.getByTestId(`shortcut-row-${s.id}`)).toBeInTheDocument();
      expect(screen.getByText(s.label)).toBeInTheDocument();
    }
  });

  it("shows BOTH a Windows column and a Mac column (AC3)", () => {
    render(<ShortcutsSheet open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Windows / Linux")).toBeInTheDocument();
    expect(screen.getByText("Mac")).toBeInTheDocument();
    // The palette chord: Ctrl+K on Windows, ⌘K on Mac — never a Mac-only hint.
    expect(screen.getByTestId("shortcut-win-palette")).toHaveTextContent("Ctrl+K");
    expect(screen.getByTestId("shortcut-mac-palette")).toHaveTextContent("⌘K");
  });

  it("has an accessible dialog label", () => {
    render(<ShortcutsSheet open onOpenChange={vi.fn()} />);
    expect(
      screen.getByRole("dialog", { name: /keyboard shortcuts/i }),
    ).toBeInTheDocument();
  });
});

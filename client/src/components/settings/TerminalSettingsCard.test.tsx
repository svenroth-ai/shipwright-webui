/*
 * TerminalSettingsCard.test.tsx — appearance selector
 * (iterate-2026-07-06-terminal-theme-modes, FR-01.44). The copy-on-selection
 * toggle was removed in iterate-2026-07-07-terminal-osc52-clipboard.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { TerminalSettingsCard } from "./TerminalSettingsCard";
import {
  TERMINAL_APPEARANCE_KEY,
  TERMINAL_PREFS_CHANGED_EVENT,
} from "../../lib/terminalPrefs";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("TerminalSettingsCard — appearance selector", () => {
  // @covers FR-01.44
  it("defaults to 'auto' (mirror Claude Code) when nothing is stored", () => {
    const { getByTestId } = render(<TerminalSettingsCard />);
    const select = getByTestId(
      "settings-terminal-appearance-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("auto");
  });

  // @covers FR-01.44
  it("reflects a persisted preference", () => {
    localStorage.setItem(TERMINAL_APPEARANCE_KEY, "light");
    const { getByTestId } = render(<TerminalSettingsCard />);
    expect(
      (getByTestId("settings-terminal-appearance-select") as HTMLSelectElement)
        .value,
    ).toBe("light");
  });

  // @covers FR-01.44
  it("persists + emits the same-tab change event on selection", () => {
    const onChanged = vi.fn();
    window.addEventListener(TERMINAL_PREFS_CHANGED_EVENT, onChanged);
    const { getByTestId } = render(<TerminalSettingsCard />);

    fireEvent.change(getByTestId("settings-terminal-appearance-select"), {
      target: { value: "light" },
    });

    expect(localStorage.getItem(TERMINAL_APPEARANCE_KEY)).toBe("light");
    expect(onChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener(TERMINAL_PREFS_CHANGED_EVENT, onChanged);
  });

  // @covers FR-01.44
  it("offers all four appearance options", () => {
    const { getByTestId } = render(<TerminalSettingsCard />);
    const select = getByTestId(
      "settings-terminal-appearance-select",
    ) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["auto", "system", "dark", "light"]);
  });
});

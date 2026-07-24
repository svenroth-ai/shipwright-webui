/*
 * TerminalSettingsCard.test.tsx — appearance selector
 * (iterate-2026-07-06-terminal-theme-modes, FR-01.44) + the GPU-acceleration
 * toggle (iterate-2026-07-24-terminal-scroll-atlas-smear). The
 * copy-on-selection toggle was removed in
 * iterate-2026-07-07-terminal-osc52-clipboard.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { TerminalSettingsCard } from "./TerminalSettingsCard";
import {
  TERMINAL_APPEARANCE_KEY,
  TERMINAL_PREFS_CHANGED_EVENT,
} from "../../lib/terminalPrefs";
import { RENDERER_STORAGE_KEY } from "../terminal/terminal-renderer";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("TerminalSettingsCard — appearance selector", () => {
  // @covers FR-01.28
  it("defaults to 'auto' (mirror Claude Code) when nothing is stored", () => {
    const { getByTestId } = render(<TerminalSettingsCard />);
    const select = getByTestId(
      "settings-terminal-appearance-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("auto");
  });

  // @covers FR-01.28
  it("reflects a persisted preference", () => {
    localStorage.setItem(TERMINAL_APPEARANCE_KEY, "light");
    const { getByTestId } = render(<TerminalSettingsCard />);
    expect(
      (getByTestId("settings-terminal-appearance-select") as HTMLSelectElement)
        .value,
    ).toBe("light");
  });

  // @covers FR-01.28
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

  // @covers FR-01.28
  it("offers all four appearance options", () => {
    const { getByTestId } = render(<TerminalSettingsCard />);
    const select = getByTestId(
      "settings-terminal-appearance-select",
    ) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["auto", "system", "dark", "light"]);
  });
});

/*
 * GPU acceleration (iterate-2026-07-24). The VS Code
 * `terminal.integrated.gpuAcceleration` analogue: OFF by default because the
 * WebGL glyph texture atlas is the root cause of the wrong-letter "smear"
 * class. Unlike Appearance it cannot apply live — the renderer is fixed when
 * the xterm instance is constructed — so this toggle deliberately emits NO
 * live-change event.
 */
describe("TerminalSettingsCard — GPU acceleration toggle", () => {
  // @covers FR-01.28
  it("is unchecked by default (GPU acceleration is opt-in)", () => {
    const { getByTestId } = render(<TerminalSettingsCard />);
    expect(
      (getByTestId("settings-terminal-gpu-checkbox") as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  // @covers FR-01.28
  it("reflects a persisted opt-in", () => {
    localStorage.setItem(RENDERER_STORAGE_KEY, "webgl");
    const { getByTestId } = render(<TerminalSettingsCard />);
    expect(
      (getByTestId("settings-terminal-gpu-checkbox") as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  // @covers FR-01.28
  it("persists an opt-in and an opt-out", () => {
    const { getByTestId } = render(<TerminalSettingsCard />);
    const box = getByTestId("settings-terminal-gpu-checkbox");

    fireEvent.click(box);
    expect(localStorage.getItem(RENDERER_STORAGE_KEY)).toBe("webgl");
    expect((box as HTMLInputElement).checked).toBe(true);

    fireEvent.click(box);
    expect(localStorage.getItem(RENDERER_STORAGE_KEY)).toBe("dom");
    expect((box as HTMLInputElement).checked).toBe(false);
  });

  // @covers FR-01.28
  it("emits NO live-change event — the renderer only swaps on a fresh terminal", () => {
    const onChanged = vi.fn();
    window.addEventListener(TERMINAL_PREFS_CHANGED_EVENT, onChanged);
    const { getByTestId } = render(<TerminalSettingsCard />);

    fireEvent.click(getByTestId("settings-terminal-gpu-checkbox"));

    expect(onChanged).not.toHaveBeenCalled();
    window.removeEventListener(TERMINAL_PREFS_CHANGED_EVENT, onChanged);
  });

  // @covers FR-01.28
  it("tells the user the change applies on the next terminal open", () => {
    const { getByTestId } = render(<TerminalSettingsCard />);
    expect(getByTestId("settings-terminal-gpu").textContent).toContain(
      "next time you open a terminal",
    );
  });
});

/*
 * useTerminalAppearance.test.ts — live re-theme helpers
 * (iterate-2026-07-06-terminal-theme-modes, FR-01.44).
 *
 * Covers the two exported helpers the open-terminal re-theme relies on;
 * the full hook event-wiring (fetch/storage/matchMedia/focus) is exercised
 * end-to-end by the EmbeddedTerminal mount test.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { applyAppearance, resolveAppearanceNow } from "./useTerminalAppearance";
import { TERMINAL_APPEARANCE_KEY, CLAUDE_THEME_CACHE_KEY } from "../../lib/terminalPrefs";

afterEach(() => localStorage.clear());

function fakeTerm(): {
  term: Terminal;
  refresh: ReturnType<typeof vi.fn>;
  getTheme: () => { background?: string } | undefined;
} {
  const refresh = vi.fn();
  const opts: { theme?: { background?: string } } = {};
  const term = { options: opts, rows: 30, refresh } as unknown as Terminal;
  return { term, refresh, getTheme: () => opts.theme };
}

describe("applyAppearance", () => {
  it("sets the LIGHT background + fires a refresh", () => {
    const f = fakeTerm();
    applyAppearance(f.term, "light");
    expect(f.getTheme()?.background).toBe("#ffffff");
    expect(f.refresh).toHaveBeenCalledWith(0, 29);
  });

  it("sets the DARK background (unchanged palette)", () => {
    const f = fakeTerm();
    applyAppearance(f.term, "dark");
    expect(f.getTheme()?.background).toBe("#1a1a1a");
  });

  it("assigns a FRESH theme object (reference changes → xterm onChangeColors fires)", () => {
    const f = fakeTerm();
    applyAppearance(f.term, "dark");
    const first = f.getTheme();
    applyAppearance(f.term, "light");
    expect(f.getTheme()).not.toBe(first);
  });

  it("swallows a refresh throw (renderer not ready)", () => {
    const term = {
      options: {},
      rows: 10,
      refresh: () => {
        throw new Error("not ready");
      },
    } as unknown as Terminal;
    expect(() => applyAppearance(term, "light")).not.toThrow();
  });
});

describe("resolveAppearanceNow", () => {
  it("defaults to dark (auto + no Claude cache + no matchMedia)", () => {
    expect(resolveAppearanceNow()).toBe("dark");
  });

  it("honours a manual light preference", () => {
    localStorage.setItem(TERMINAL_APPEARANCE_KEY, "light");
    expect(resolveAppearanceNow()).toBe("light");
  });

  it("auto mirrors a cached light Claude theme", () => {
    localStorage.setItem(TERMINAL_APPEARANCE_KEY, "auto");
    localStorage.setItem(CLAUDE_THEME_CACHE_KEY, "light-daltonized");
    expect(resolveAppearanceNow()).toBe("light");
  });
});

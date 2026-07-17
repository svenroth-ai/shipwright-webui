/*
 * terminalAppearance.test.ts (iterate-2026-07-06-terminal-theme-modes,
 * FR-01.44) — pure resolver: Claude-theme→family mapping + precedence.
 */

import { describe, expect, it } from "vitest";
import {
  mapClaudeThemeToFamily,
  resolveAppearance,
} from "./terminalAppearance";

describe("mapClaudeThemeToFamily", () => {
  // @covers FR-01.44
  it("maps every light* variant to light", () => {
    for (const t of ["light", "light-daltonized", "light-ansi"]) {
      expect(mapClaudeThemeToFamily(t)).toBe("light");
    }
  });
  // @covers FR-01.44
  it("maps every dark* variant to dark", () => {
    for (const t of ["dark", "dark-daltonized", "dark-ansi"]) {
      expect(mapClaudeThemeToFamily(t)).toBe("dark");
    }
  });
  // @covers FR-01.44
  it("maps auto to system (defer to OS)", () => {
    expect(mapClaudeThemeToFamily("auto")).toBe("system");
  });
  // @covers FR-01.44
  it("is case/space-insensitive", () => {
    expect(mapClaudeThemeToFamily("  LIGHT ")).toBe("light");
  });
  // @covers FR-01.44
  it("falls back to dark for custom:/unknown/null/empty", () => {
    expect(mapClaudeThemeToFamily("custom:dracula")).toBe("dark");
    expect(mapClaudeThemeToFamily("nonsense")).toBe("dark");
    expect(mapClaudeThemeToFamily(null)).toBe("dark");
    expect(mapClaudeThemeToFamily(undefined)).toBe("dark");
    expect(mapClaudeThemeToFamily("")).toBe("dark");
  });
});

describe("resolveAppearance — precedence", () => {
  const base = { claudeTheme: "dark", systemPrefersDark: true };

  // @covers FR-01.44
  it("manual dark/light win regardless of the other inputs", () => {
    expect(
      resolveAppearance({ ...base, pref: "dark", claudeTheme: "light" }),
    ).toBe("dark");
    expect(
      resolveAppearance({ ...base, pref: "light", claudeTheme: "dark" }),
    ).toBe("light");
  });

  // @covers FR-01.44
  it("system follows the OS signal", () => {
    expect(
      resolveAppearance({ pref: "system", claudeTheme: "light", systemPrefersDark: true }),
    ).toBe("dark");
    expect(
      resolveAppearance({ pref: "system", claudeTheme: "dark", systemPrefersDark: false }),
    ).toBe("light");
  });

  // @covers FR-01.44
  it("auto mirrors Claude Code: light theme → light", () => {
    expect(
      resolveAppearance({ pref: "auto", claudeTheme: "light", systemPrefersDark: true }),
    ).toBe("light");
  });

  // @covers FR-01.44
  it("auto mirrors Claude Code: dark theme → dark", () => {
    expect(
      resolveAppearance({ pref: "auto", claudeTheme: "dark-ansi", systemPrefersDark: false }),
    ).toBe("dark");
  });

  // @covers FR-01.44
  it("auto + Claude `auto` theme defers to the OS signal", () => {
    expect(
      resolveAppearance({ pref: "auto", claudeTheme: "auto", systemPrefersDark: true }),
    ).toBe("dark");
    expect(
      resolveAppearance({ pref: "auto", claudeTheme: "auto", systemPrefersDark: false }),
    ).toBe("light");
  });

  // @covers FR-01.44
  it("auto + unknown Claude theme falls back to dark", () => {
    expect(
      resolveAppearance({ pref: "auto", claudeTheme: null, systemPrefersDark: false }),
    ).toBe("dark");
  });
});

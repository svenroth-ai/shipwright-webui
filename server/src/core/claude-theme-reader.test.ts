/*
 * claude-theme-reader.test.ts (iterate-2026-07-06-terminal-theme-modes,
 * FR-01.44). Native-fs-free — readFile + homedir are injected.
 */

import { describe, expect, it } from "vitest";
import { readClaudeTheme, claudeSettingsPath } from "./claude-theme-reader.js";

const HOME = "/home/user";
const okDeps = (body: string) => ({
  homedir: () => HOME,
  readFile: async (p: string) => {
    expect(p).toBe(claudeSettingsPath(HOME));
    return body;
  },
});

describe("readClaudeTheme", () => {
  // @covers FR-01.44
  it("returns the theme string from ~/.claude/settings.json", async () => {
    expect(await readClaudeTheme(okDeps(JSON.stringify({ theme: "light" })))).toBe(
      "light",
    );
  });

  // @covers FR-01.44
  it("returns compound theme identifiers verbatim (e.g. light-daltonized, custom:x)", async () => {
    expect(
      await readClaudeTheme(okDeps(JSON.stringify({ theme: "dark-ansi" }))),
    ).toBe("dark-ansi");
    expect(
      await readClaudeTheme(okDeps(JSON.stringify({ theme: "custom:dracula" }))),
    ).toBe("custom:dracula");
  });

  // @covers FR-01.44
  it("trims surrounding whitespace", async () => {
    expect(await readClaudeTheme(okDeps(JSON.stringify({ theme: "  auto " })))).toBe(
      "auto",
    );
  });

  // @covers FR-01.44
  it("returns null when the theme key is absent", async () => {
    expect(await readClaudeTheme(okDeps(JSON.stringify({ other: 1 })))).toBeNull();
  });

  // @covers FR-01.44
  it("returns null when theme is not a string", async () => {
    expect(await readClaudeTheme(okDeps(JSON.stringify({ theme: 42 })))).toBeNull();
  });

  // @covers FR-01.44
  it("returns null for an empty theme string", async () => {
    expect(await readClaudeTheme(okDeps(JSON.stringify({ theme: "  " })))).toBeNull();
  });

  // @covers FR-01.44
  it("returns null on malformed JSON (never throws)", async () => {
    expect(await readClaudeTheme(okDeps("{ not json"))).toBeNull();
  });

  // @covers FR-01.44
  it("returns null when the file is missing (ENOENT swallowed)", async () => {
    const enoent = {
      homedir: () => HOME,
      readFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    };
    expect(await readClaudeTheme(enoent)).toBeNull();
  });

  // @covers FR-01.44
  it("builds the path under the injected home dir", () => {
    expect(claudeSettingsPath("/x")).toContain(".claude");
    expect(claudeSettingsPath("/x")).toContain("settings.json");
  });
});

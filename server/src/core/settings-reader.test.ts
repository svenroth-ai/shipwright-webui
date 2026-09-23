import { describe, expect, it } from "vitest";

import {
  readGlobalSettings,
  DEFAULT_GLOBAL_SETTINGS,
  migrateLegacyRuntimeDefault,
} from "./settings-reader.js";

describe("readGlobalSettings", () => {
  it("returns defaults when the file doesn't exist", async () => {
    const result = await readGlobalSettings("/x/settings.json", {
      existsSync: () => false,
      readFile: async () => { throw new Error("should not be called"); },
    });
    expect(result).toEqual(DEFAULT_GLOBAL_SETTINGS);
  });

  it("merges the stored fields over the defaults", async () => {
    const result = await readGlobalSettings("/x/settings.json", {
      existsSync: () => true,
      readFile: async () => JSON.stringify({ runtimeDefault: "codex", codexStallTimeoutMinutes: 20 }),
    });
    expect(result).toMatchObject({
      ...DEFAULT_GLOBAL_SETTINGS,
      runtimeDefault: "codex",
      codexStallTimeoutMinutes: 20,
    });
  });

  it("falls back to defaults on malformed JSON", async () => {
    const result = await readGlobalSettings("/x/settings.json", {
      existsSync: () => true,
      readFile: async () => "{not json",
    });
    expect(result).toEqual(DEFAULT_GLOBAL_SETTINGS);
  });

  it("migrates a pre-rename codexRuntimeDefault to runtimeDefault (PR-review finding, iterate-2026-09-23)", async () => {
    const result = await readGlobalSettings("/x/settings.json", {
      existsSync: () => true,
      readFile: async () => JSON.stringify({ codexRuntimeDefault: "codex" }),
    });
    expect(result.runtimeDefault).toBe("codex");
  });

  it("prefers a present runtimeDefault over the legacy key", async () => {
    const result = await readGlobalSettings("/x/settings.json", {
      existsSync: () => true,
      readFile: async () =>
        JSON.stringify({ codexRuntimeDefault: "codex", runtimeDefault: "claude" }),
    });
    expect(result.runtimeDefault).toBe("claude");
  });
});

describe("migrateLegacyRuntimeDefault", () => {
  it("ignores a legacy value that isn't claude/codex", () => {
    expect(migrateLegacyRuntimeDefault({ codexRuntimeDefault: "bogus" })).toEqual({
      codexRuntimeDefault: "bogus",
    });
  });

  it("is a no-op when neither field is present", () => {
    expect(migrateLegacyRuntimeDefault({ port: 3847 })).toEqual({ port: 3847 });
  });
});

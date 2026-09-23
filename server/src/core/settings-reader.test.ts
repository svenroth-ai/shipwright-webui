import { describe, expect, it } from "vitest";

import { readGlobalSettings, DEFAULT_GLOBAL_SETTINGS } from "./settings-reader.js";

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
});

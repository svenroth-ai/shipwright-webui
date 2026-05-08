/*
 * cli-compat.path-self-heal.test.ts — iterate v0.8.8 AC-3
 *
 * Boot-time PATH self-heal: when `resolveClaudeBin()` succeeds via
 * the AC-2 curated fallback (i.e. the binary exists on disk but its
 * parent dir is NOT on `process.env.PATH`), prepend the parent dir to
 * PATH so subsequent child processes the server spawns (node-pty,
 * preview-session-manager, etc.) inherit the augmented PATH and can
 * find claude + its sibling binaries (uv, gh, …) installed in the
 * same directory.
 *
 * Idempotent: if the parent dir is already in PATH, no-op.
 * No-op when bin is null (nothing to add).
 * Loud structured log on actual prepend so production operators can
 * diagnose env-var drift.
 */

import { describe, it, expect } from "vitest";
import { selfHealClaudePath } from "./cli-compat.js";

describe("AC-3 — boot-time PATH self-heal for claude bin's parent dir", () => {
  it("prepends parent dir to PATH when bin resolved but parent not in PATH (Windows)", () => {
    const env: Record<string, string | undefined> = {
      PATH: "C:\\Windows\\System32;C:\\Users\\Test\\AppData\\Local\\Microsoft\\WinGet",
    };
    const result = selfHealClaudePath({
      bin: "C:\\Users\\Test\\.local\\bin\\claude.exe",
      env,
      platform: "win32",
    });
    expect(result.augmented).toBe(true);
    expect(result.parentDir).toBe("C:\\Users\\Test\\.local\\bin");
    expect(env.PATH?.startsWith("C:\\Users\\Test\\.local\\bin;")).toBe(true);
    expect(env.PATH).toContain("C:\\Windows\\System32");
  });

  it("idempotent: no-op when parent dir is ALREADY in PATH (case-insensitive on Windows)", () => {
    const env: Record<string, string | undefined> = {
      PATH: "C:\\Windows\\System32;C:\\Users\\Test\\.LOCAL\\bin;C:\\Other",
    };
    const before = env.PATH;
    const result = selfHealClaudePath({
      bin: "C:\\Users\\Test\\.local\\bin\\claude.exe",
      env,
      platform: "win32",
    });
    expect(result.augmented).toBe(false);
    expect(env.PATH).toBe(before);
  });

  it("prepends parent dir on POSIX with `:` separator", () => {
    const env: Record<string, string | undefined> = {
      PATH: "/usr/bin:/usr/local/bin:/bin",
    };
    const result = selfHealClaudePath({
      bin: "/home/test/.local/bin/claude",
      env,
      platform: "linux",
    });
    expect(result.augmented).toBe(true);
    expect(result.parentDir).toBe("/home/test/.local/bin");
    expect(env.PATH?.startsWith("/home/test/.local/bin:")).toBe(true);
  });

  it("idempotent on POSIX (case-sensitive)", () => {
    const env: Record<string, string | undefined> = {
      PATH: "/usr/bin:/home/test/.local/bin:/usr/local/bin",
    };
    const before = env.PATH;
    const result = selfHealClaudePath({
      bin: "/home/test/.local/bin/claude",
      env,
      platform: "linux",
    });
    expect(result.augmented).toBe(false);
    expect(env.PATH).toBe(before);
  });

  it("no-op when bin is null", () => {
    const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
    const before = env.PATH;
    const result = selfHealClaudePath({
      bin: null,
      env,
      platform: "linux",
    });
    expect(result.augmented).toBe(false);
    expect(env.PATH).toBe(before);
  });

  it("handles missing PATH gracefully (uninitialized env)", () => {
    const env: Record<string, string | undefined> = {};
    const result = selfHealClaudePath({
      bin: "/home/test/.local/bin/claude",
      env,
      platform: "linux",
    });
    expect(result.augmented).toBe(true);
    expect(env.PATH).toBe("/home/test/.local/bin");
  });

  it("Windows: updates env.Path (not PATH) when only `Path` key exists (external review fix — openai medium)", () => {
    // node-pty / many spawners on Windows expose the path variable as
    // `Path` (mixed-case). If we always wrote to `env.PATH`, the
    // existing `Path` value would shadow ours and child processes
    // would inherit the un-augmented PATH. Detect existing key
    // case-insensitively and update IT.
    const env: Record<string, string | undefined> = {
      Path: "C:\\Windows\\System32;C:\\Other",
    };
    const result = selfHealClaudePath({
      bin: "C:\\Users\\Test\\.local\\bin\\claude.exe",
      env,
      platform: "win32",
    });
    expect(result.augmented).toBe(true);
    // The Path key got updated, NOT a new PATH key.
    expect(env.Path?.startsWith("C:\\Users\\Test\\.local\\bin;")).toBe(true);
    expect(env.PATH).toBeUndefined();
  });

  it("Windows: idempotent against `Path` key already containing parent dir (case-insensitive)", () => {
    const env: Record<string, string | undefined> = {
      Path: "C:\\Windows\\System32;c:\\users\\test\\.LOCAL\\BIN\\;C:\\Other",
    };
    const before = env.Path;
    const result = selfHealClaudePath({
      bin: "C:\\Users\\Test\\.local\\bin\\claude.exe",
      env,
      platform: "win32",
    });
    expect(result.augmented).toBe(false);
    expect(env.Path).toBe(before);
  });
});

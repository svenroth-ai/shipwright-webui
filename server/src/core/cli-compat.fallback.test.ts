/*
 * cli-compat.fallback.test.ts — iterate v0.8.8 AC-2
 *
 * `resolveClaudeBin()` must NOT depend exclusively on `where`/`which`
 * finding the binary on PATH. The Hono server's `process.env.PATH`
 * inherits from the launching shell; if the user installs claude into a
 * directory that wasn't on the server's initial PATH (typical:
 * `~/.local/bin/claude.exe`, npm-global, winget shim), the primary
 * lookup returns empty and the diagnostics endpoint reports "Claude
 * Code CLI not found" — even though the binary exists on disk.
 *
 * Fix: when the primary lookup fails, walk a curated list of known
 * install paths and return the first executable found. Also honor
 * `SHIPWRIGHT_CLAUDE_BIN` env override at the top of the chain so
 * operators can pin an exact path.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { resolveClaudeBinWith } from "./cli-compat.js";

const win32Env = {
  USERPROFILE: "C:\\Users\\Test",
  APPDATA: "C:\\Users\\Test\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local",
  ProgramFiles: "C:\\Program Files",
};
const posixEnv = {
  HOME: "/home/test",
};

describe("AC-2 — resolveClaudeBin() multi-strategy fallback", () => {
  it("primary: returns the .cmd shim when `where claude` finds one (Windows)", () => {
    const got = resolveClaudeBinWith({
      platform: "win32",
      spawnSync: () => ({
        status: 0,
        stdout: "C:\\Users\\Test\\.local\\bin\\claude.exe\r\nC:\\Users\\Test\\AppData\\Roaming\\npm\\claude.cmd\r\n",
      }) as never,
      existsSync: () => true,
      env: win32Env,
    });
    // Prefers .cmd over .exe on Windows (existing primary behavior).
    expect(got).toBe("C:\\Users\\Test\\AppData\\Roaming\\npm\\claude.cmd");
  });

  it("primary: returns first hit on POSIX", () => {
    const got = resolveClaudeBinWith({
      platform: "linux",
      spawnSync: () => ({ status: 0, stdout: "/usr/local/bin/claude\n" }) as never,
      existsSync: () => true,
      env: posixEnv,
    });
    expect(got).toBe("/usr/local/bin/claude");
  });

  it("env override: SHIPWRIGHT_CLAUDE_BIN takes precedence over `where`/`which`", () => {
    const got = resolveClaudeBinWith({
      platform: "win32",
      spawnSync: () => ({ status: 0, stdout: "C:\\Other\\claude.exe\r\n" }) as never,
      existsSync: (p) => p === "C:\\Custom\\claude.exe",
      env: { ...win32Env, SHIPWRIGHT_CLAUDE_BIN: "C:\\Custom\\claude.exe" },
    });
    expect(got).toBe("C:\\Custom\\claude.exe");
  });

  it("env override: missing target rejects (does NOT silently fall through to `where`)", () => {
    const got = resolveClaudeBinWith({
      platform: "win32",
      spawnSync: () => ({ status: 0, stdout: "C:\\Other\\claude.exe\r\n" }) as never,
      existsSync: () => false, // override target doesn't exist
      env: { ...win32Env, SHIPWRIGHT_CLAUDE_BIN: "C:\\Missing\\claude.exe" },
    });
    // Loud rejection: env-pinned but missing → null. The operator set
    // the env var explicitly; falling back silently would mask the
    // misconfiguration.
    expect(got).toBeNull();
  });

  it("fallback: walks curated Windows install paths when `where` returns empty", () => {
    const candidate = path.join(win32Env.USERPROFILE, ".local", "bin", "claude.exe");
    const got = resolveClaudeBinWith({
      platform: "win32",
      spawnSync: () => ({ status: 1, stdout: "" }) as never, // primary fails
      existsSync: (p) => p === candidate,
      env: win32Env,
    });
    expect(got).toBe(candidate);
  });

  it("fallback: walks curated POSIX install paths when `which` returns empty", () => {
    const candidate = path.posix.join(posixEnv.HOME, ".local", "bin", "claude");
    const got = resolveClaudeBinWith({
      platform: "linux",
      spawnSync: () => ({ status: 1, stdout: "" }) as never,
      existsSync: (p) => p === candidate,
      env: posixEnv,
    });
    expect(got).toBe(candidate);
  });

  it("returns null when neither primary nor fallback finds anything", () => {
    const got = resolveClaudeBinWith({
      platform: "win32",
      spawnSync: () => ({ status: 1, stdout: "" }) as never,
      existsSync: () => false,
      env: win32Env,
    });
    expect(got).toBeNull();
  });

  it("returns null when `where` itself is unavailable (ENOENT) — fallback still runs", () => {
    const candidate = path.join(win32Env.USERPROFILE, ".local", "bin", "claude.exe");
    const got = resolveClaudeBinWith({
      platform: "win32",
      spawnSync: () => ({ error: new Error("ENOENT"), status: null }) as never,
      existsSync: (p) => p === candidate,
      env: win32Env,
    });
    expect(got).toBe(candidate);
  });
});

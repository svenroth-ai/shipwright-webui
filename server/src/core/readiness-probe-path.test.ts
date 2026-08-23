/*
 * readiness-probe-path unit tests (FR-01.51) — the PATH-augmentation + POSIX bin
 * resolution that makes the readiness probe find a uv/claude that the installer
 * dropped into ~/.local/bin (the Mac/Windows cold-start bug,
 * iterate-2026-08-23). Verbatim mirror of bootstrapper/lib/probe-path.mjs.
 */

import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { probeEnv, resolvePosixBin } from "./readiness-probe-path.js";

describe("probeEnv — augment the lookup PATH", () => {
  // @covers FR-01.51
  it("APPENDS ~/.local/bin + Homebrew dirs on POSIX (real PATH wins, fallback last)", () => {
    const env = probeEnv("linux", "/home/sven", { PATH: "/usr/bin:/bin", FOO: "bar" });
    expect(env.PATH.split(":")).toEqual([
      "/usr/bin",
      "/bin",
      "/home/sven/.local/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ]);
    expect(env.FOO).toBe("bar");
  });

  // @covers FR-01.51
  it("does not duplicate a dir already on PATH", () => {
    const env = probeEnv("linux", "/home/sven", { PATH: "/home/sven/.local/bin:/usr/bin" });
    const parts = env.PATH.split(":");
    expect(parts.filter((p) => p === "/home/sven/.local/bin")).toHaveLength(1);
  });

  // @covers FR-01.51
  it("appends only ~/.local/bin on win32, using ; separator", () => {
    const env = probeEnv("win32", "C:\\Users\\Sven", { Path: "C:\\Windows" });
    expect(env.PATH).toBe("C:\\Windows;C:\\Users\\Sven\\.local\\bin");
  });

  // @covers FR-01.51 — case-collapse: never hand spawn both a stale Path and PATH
  it("collapses every path-cased key into a single canonical PATH (win32)", () => {
    const env = probeEnv("win32", "C:\\Users\\Sven", { Path: "C:\\a", PATH: "C:\\b" });
    // exactly one path-cased key survives, named PATH
    const pathKeys = Object.keys(env).filter((k) => k.toLowerCase() === "path");
    expect(pathKeys).toEqual(["PATH"]);
  });

  // @covers FR-01.51
  it("drops undefined env values and tolerates a missing PATH", () => {
    const env = probeEnv("linux", "/home/sven", { GONE: undefined });
    expect("GONE" in env).toBe(false);
    expect(env.PATH.split(":")).toEqual([
      "/home/sven/.local/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ]);
  });
});

describe("resolvePosixBin — resolve a bare name to an absolute exe", () => {
  // @covers FR-01.51
  it("returns a name that already contains a slash unchanged", () => {
    expect(resolvePosixBin("/usr/bin/uv", { PATH: "/whatever" })).toBe("/usr/bin/uv");
  });

  // @covers FR-01.51
  it("returns the bare name unchanged when nothing on PATH resolves", () => {
    expect(resolvePosixBin("uv", { PATH: "/no/such/dir:/also/missing" })).toBe("uv");
  });

  // @covers FR-01.51 — the fix's core: a bin present only in ~/.local/bin resolves
  it.skipIf(process.platform === "win32")(
    "resolves a bin found on the augmented PATH to its absolute path",
    () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "probe-bin-"));
      const bin = path.join(dir, "uv");
      writeFileSync(bin, "#!/bin/sh\necho uv 0.5.0\n");
      chmodSync(bin, 0o755);
      expect(resolvePosixBin("uv", { PATH: `/no/such/dir:${dir}` })).toBe(bin);
    },
  );
});

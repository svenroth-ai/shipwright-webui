import { describe, it, expect } from "vitest";
import { parseSemver, compareSemver, isWindows, installHint, MARK, MIN_NODE } from "../lib/util.mjs";

describe("util — SemVer", () => {
  it("parses MAJOR.MINOR.PATCH, tolerating a leading v", () => {
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver("v0.23.0")).toEqual([0, 23, 0]);
    expect(parseSemver("2.1.132 (Claude Code)")).toEqual([2, 1, 132]);
  });

  it("returns null for non-semver", () => {
    expect(parseSemver("nope")).toBeNull();
    expect(parseSemver(undefined)).toBeNull();
  });

  it("compares numerically (0.10.0 > 0.2.0, not lexically)", () => {
    expect(compareSemver("0.10.0", "0.2.0")).toBe(1);
    expect(compareSemver("0.22.0", "0.23.0")).toBe(-1);
    expect(compareSemver("0.23.0", "0.23.0")).toBe(0);
  });

  it("treats an unparseable side as equal (never a false swap trigger)", () => {
    expect(compareSemver("unknown", "0.23.0")).toBe(0);
  });
});

describe("util — platform hints", () => {
  it("gives platform-correct install commands", () => {
    expect(installHint("uv", "win32")).toContain("uv/install.ps1");
    expect(installHint("uv", "linux")).toContain("astral.sh/uv/install.sh");
    expect(installHint("python", "win32")).toContain("Microsoft Store");
    expect(installHint("node", "darwin")).toContain("nodejs.org");
  });

  it("MIN_NODE mirrors the packaged server engine", () => {
    expect(MIN_NODE).toBe("20.12.0");
  });

  it("MARK glyphs are ASCII (PowerShell-5.1-safe, no emoji)", () => {
    for (const g of Object.values(MARK)) expect(g).toMatch(/^\[[^\]]+\]$/);
  });

  it("isWindows is platform-parametric", () => {
    expect(isWindows("win32")).toBe(true);
    expect(isWindows("linux")).toBe(false);
  });
});

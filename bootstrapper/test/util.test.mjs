import { describe, it, expect } from "vitest";
import {
  parseSemver,
  parsePrerelease,
  compareSemver,
  compareSemverFull,
  isWindows,
  installHint,
  MARK,
  MIN_NODE,
} from "../lib/util.mjs";

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

  it("compareSemver still IGNORES the pre-release tail (the tool-floor comparator)", () => {
    // Node/Python floor checks care only about the triple — keep that contract.
    expect(compareSemver("0.24.7-next.0", "0.24.7-next.1")).toBe(0);
    expect(compareSemver("0.24.7-next.5", "0.24.7")).toBe(0);
  });
});

describe("util — SemVer pre-release (attach-vs-swap comparator)", () => {
  it("parsePrerelease extracts the dot-tail after the first '-', else null", () => {
    expect(parsePrerelease("0.24.7-next.1")).toEqual(["next", "1"]);
    expect(parsePrerelease("0.24.7")).toBeNull();
    expect(parsePrerelease("v0.24.7-rc.2")).toEqual(["rc", "2"]);
    // Trailing junk without a '-' is NOT a pre-release (Claude Code version banner).
    expect(parsePrerelease("2.1.132 (Claude Code)")).toBeNull();
    expect(parsePrerelease(undefined)).toBeNull();
  });

  it("compareSemverFull ranks two @next builds at the same triple by -next.N", () => {
    expect(compareSemverFull("0.24.7-next.0", "0.24.7-next.1")).toBe(-1);
    expect(compareSemverFull("0.24.7-next.2", "0.24.7-next.1")).toBe(1);
    expect(compareSemverFull("0.24.7-next.1", "0.24.7-next.1")).toBe(0);
  });

  it("compareSemverFull: a release outranks a pre-release of the same triple", () => {
    expect(compareSemverFull("0.24.7", "0.24.7-next.9")).toBe(1);
    expect(compareSemverFull("0.24.7-next.9", "0.24.7")).toBe(-1);
  });

  it("compareSemverFull: numeric next identifiers compare numerically, not lexically", () => {
    expect(compareSemverFull("0.24.7-next.9", "0.24.7-next.10")).toBe(-1);
  });

  it("compareSemverFull: triple still dominates the tail", () => {
    expect(compareSemverFull("0.24.6-next.99", "0.24.7-next.0")).toBe(-1);
    expect(compareSemverFull("0.25.0", "0.24.7-next.0")).toBe(1);
  });

  it("compareSemverFull: an unparseable side is equal (never a false swap trigger)", () => {
    expect(compareSemverFull("unknown", "0.24.7-next.1")).toBe(0);
    expect(compareSemverFull("0.24.7-next.1", "")).toBe(0);
  });

  it("compareSemverFull: +build metadata is ignored in precedence (§10)", () => {
    expect(parsePrerelease("0.24.7-next.1+build.5")).toEqual(["next", "1"]);
    expect(parsePrerelease("0.24.7+build.5")).toBeNull();
    expect(compareSemverFull("0.24.7-next.1+build.5", "0.24.7-next.1")).toBe(0);
    expect(compareSemverFull("0.24.7+build.5", "0.24.7")).toBe(0);
  });

  it("compareSemverFull: alphanumeric identifiers sort by ASCII", () => {
    expect(compareSemverFull("0.24.7-alpha", "0.24.7-beta")).toBe(-1);
    expect(compareSemverFull("0.24.7-rc", "0.24.7-beta")).toBe(1);
  });

  it("compareSemverFull: a longer identifier list outranks its own prefix", () => {
    expect(compareSemverFull("0.24.7-alpha", "0.24.7-alpha.1")).toBe(-1);
    expect(compareSemverFull("0.24.7-alpha.1", "0.24.7-alpha")).toBe(1);
  });

  it("compareSemverFull: a numeric identifier ranks below an alphanumeric at the same position", () => {
    expect(compareSemverFull("0.24.7-next.1", "0.24.7-next.beta")).toBe(-1);
    expect(compareSemverFull("0.24.7-next.beta", "0.24.7-next.1")).toBe(1);
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

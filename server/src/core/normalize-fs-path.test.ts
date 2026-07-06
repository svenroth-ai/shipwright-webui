import { describe, it, expect } from "vitest";
import { normalizeFsPath } from "./normalize-fs-path.js";

describe("normalizeFsPath", () => {
  it("strips a surrounding single-quote pair (the reported macOS paste)", () => {
    expect(
      normalizeFsPath("'/Users/marcelburkart/Projects/Claude Command Center'"),
    ).toBe("/Users/marcelburkart/Projects/Claude Command Center");
  });

  it("strips a surrounding double-quote pair (Windows paste)", () => {
    expect(normalizeFsPath('"C:\\Users\\me\\My Project"')).toBe(
      "C:\\Users\\me\\My Project",
    );
  });

  it("trims surrounding whitespace outside and inside the quotes", () => {
    expect(normalizeFsPath("  '/tmp/foo bar' ")).toBe("/tmp/foo bar");
  });

  it("leaves an unquoted path untouched", () => {
    expect(normalizeFsPath("/Users/me/plain")).toBe("/Users/me/plain");
  });

  it("preserves an inner apostrophe (o'brien)", () => {
    expect(normalizeFsPath("/Users/o'brien/proj")).toBe("/Users/o'brien/proj");
  });

  it("does NOT strip a lone leading or trailing quote (not a matching pair)", () => {
    expect(normalizeFsPath("'/Users/me/half")).toBe("'/Users/me/half");
    expect(normalizeFsPath("/Users/me/half'")).toBe("/Users/me/half'");
  });

  it("does not strip mismatched quote types", () => {
    expect(normalizeFsPath("'/Users/me/x\"")).toBe("'/Users/me/x\"");
  });

  it("only removes ONE balanced pair (nested wrapping left partially quoted)", () => {
    // Pathological double-paste — one pair removed, the artefact is not masked.
    expect(normalizeFsPath("''/tmp/x''")).toBe("'/tmp/x'");
  });

  it("collapses an empty / quotes-only value to the empty string", () => {
    expect(normalizeFsPath("''")).toBe("");
    expect(normalizeFsPath('   ""   ')).toBe("");
    expect(normalizeFsPath("   ")).toBe("");
  });
});

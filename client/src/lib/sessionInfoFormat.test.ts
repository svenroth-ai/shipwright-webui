import { describe, expect, it } from "vitest";
import { baseName, formatTokens, relativeToCwd, shortModel } from "./sessionInfoFormat";

describe("sessionInfoFormat", () => {
  it("formats tokens without a percentage", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(250_000)).toBe("250k");
    expect(formatTokens(1_250_000)).toBe("1.25M");
    expect(formatTokens(1234)).not.toContain("%");
  });
  it("drops a trailing date stamp from the model", () => {
    expect(shortModel("claude-opus-4-7-20260101")).toBe("claude-opus-4-7");
    expect(shortModel("claude-opus-4-7")).toBe("claude-opus-4-7");
  });
  it("relativizes under cwd (windows case-insensitive) and rejects outside/sibling paths", () => {
    expect(relativeToCwd("C:\\Dev\\app\\src\\a.ts", "c:/dev/app")).toBe("src/a.ts");
    expect(relativeToCwd("/home/u/app/x.md", "/home/u/app/")).toBe("x.md");
    expect(relativeToCwd("/home/u/app2/x.md", "/home/u/app")).toBeNull();
    expect(relativeToCwd("/home/U/app/x.md", "/home/u/app")).toBeNull();
    expect(relativeToCwd("/etc/x", "")).toBeNull();
  });
  it("rejects traversal and dot segments (Viewer-open safety)", () => {
    expect(relativeToCwd("/home/u/app/../secret.txt", "/home/u/app")).toBeNull();
    expect(relativeToCwd("/home/u/app/a/../../b", "/home/u/app")).toBeNull();
    expect(relativeToCwd("/home/u/app/./a.md", "/home/u/app")).toBeNull();
    expect(relativeToCwd("/home/u/app/", "/home/u/app")).toBeNull();
  });
  it("baseName handles both separators", () => {
    expect(baseName("C:\\a\\b.txt")).toBe("b.txt");
    expect(baseName("/a/b.txt")).toBe("b.txt");
  });
});

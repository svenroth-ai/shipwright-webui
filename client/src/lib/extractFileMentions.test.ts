import { describe, it, expect } from "vitest";
import { extractFileMentions } from "./extractFileMentions";

describe("extractFileMentions", () => {
  it("finds a bare markdown filename mentioned in prose", () => {
    const text = "architecture.md has no shipwright:architecture marker, but 1 arch-impact drop(s) exist";
    const mentions = extractFileMentions(text);
    expect(mentions.map((m) => m.path)).toEqual(["architecture.md"]);
  });

  it("finds a deep repo-relative path with a dot-prefixed directory", () => {
    const text = 'see .shipwright/compliance/audit-report.md for detail';
    const mentions = extractFileMentions(text);
    expect(mentions.map((m) => m.path)).toEqual([".shipwright/compliance/audit-report.md"]);
  });

  it("finds a client source path with an extension", () => {
    const text = "moved logic out of client/src/pages/TaskBoardPage.tsx into a hook";
    const mentions = extractFileMentions(text);
    expect(mentions.map((m) => m.path)).toEqual(["client/src/pages/TaskBoardPage.tsx"]);
  });

  it("finds multiple distinct mentions in one string", () => {
    const text = "CLAUDE.md is 270 lines; see also architecture.md and shipwright_bloat_baseline.json";
    const mentions = extractFileMentions(text);
    expect(mentions.map((m) => m.path)).toEqual([
      "CLAUDE.md",
      "architecture.md",
      "shipwright_bloat_baseline.json",
    ]);
  });

  it("does not match a semver-like version string", () => {
    const text = "14 commit(s) since v0.14.0 have no matching event";
    expect(extractFileMentions(text)).toEqual([]);
  });

  it("does not match a scheme-less URL that happens to end in a recognized extension", () => {
    const text = "see example.com/readme.md for the upstream copy";
    expect(extractFileMentions(text)).toEqual([]);
  });

  it("does not match a scheme-prefixed URL either", () => {
    const text = "see https://example.com/readme.md for the upstream copy";
    expect(extractFileMentions(text)).toEqual([]);
  });

  it("still matches a real repo path whose first segment is not a bare domain", () => {
    const text = "client/src/pages/TaskBoardPage.tsx was split";
    expect(extractFileMentions(text).map((m) => m.path)).toEqual([
      "client/src/pages/TaskBoardPage.tsx",
    ]);
  });

  it("does not match a bare commit SHA", () => {
    const text = "de956bce683e76bf8e0823ac309d6e3476473e9e (no event with this commit)";
    expect(extractFileMentions(text)).toEqual([]);
  });

  it("does not match an ADR reference without a file extension", () => {
    const text = "Heaviest: ADR-058 (129 lines), ADR-099 (123 lines)";
    expect(extractFileMentions(text)).toEqual([]);
  });

  it("does not match inside a URL-less plain sentence with no extension", () => {
    expect(extractFileMentions("nothing to see here")).toEqual([]);
  });

  it("returns the correct start/end offsets for a mention", () => {
    const text = "see CLAUDE.md now";
    const mentions = extractFileMentions(text);
    expect(mentions).toEqual([{ start: 4, end: 13, path: "CLAUDE.md" }]);
    expect(text.slice(mentions[0].start, mentions[0].end)).toBe("CLAUDE.md");
  });

  it("handles an empty string", () => {
    expect(extractFileMentions("")).toEqual([]);
  });

  it("handles null/undefined (detail is not runtime-validated at the producer)", () => {
    expect(extractFileMentions(null)).toEqual([]);
    expect(extractFileMentions(undefined)).toEqual([]);
  });

  it("still matches when the mention ends a sentence (trailing period)", () => {
    const text = "see architecture.md.";
    expect(extractFileMentions(text).map((m) => m.path)).toEqual(["architecture.md"]);
  });

  it("still matches case-insensitively", () => {
    const text = "see README.MD for detail";
    expect(extractFileMentions(text).map((m) => m.path)).toEqual(["README.MD"]);
  });

  it("does not match a real extension immediately followed by another extension-like suffix", () => {
    const text = "backed up as config.yml.bak before editing";
    expect(extractFileMentions(text)).toEqual([]);
  });

  it("known limitation: a bare package name ending in a recognized extension false-positives (e.g. next.js)", () => {
    // Documented rather than special-cased: a stop-list would need constant
    // upkeep against an open-ended set of package names. Clicking such a
    // link lands on SmartViewer's own "file not found" state, same as any
    // other stale/renamed path — not a crash.
    const text = "upgraded to next.js 15";
    expect(extractFileMentions(text).map((m) => m.path)).toEqual(["next.js"]);
  });
});

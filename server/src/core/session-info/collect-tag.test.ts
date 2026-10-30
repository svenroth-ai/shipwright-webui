import { describe, expect, it } from "vitest";

import { tag } from "./collect.js";

const BODY = [
  "<task-notification>",
  "<task-id>a846d07bfac6df8c3</task-id>",
  "<tool-use-id>toolu_01QkZZR3</tool-use-id>",
  "<status>completed</status>",
  "<summary>Agent \"x\" finished</summary>",
  "<result>multi\nline <b>text</b></result>",
  "<usage><subagent_tokens>134225</subagent_tokens><tool_uses>17</tool_uses><duration_ms>70034</duration_ms></usage>",
  "<status>second</status>",
  "</task-notification>",
].join("\n");

// Expected values are what the former `new RegExp("<name>([\s\S]*?)</name>")` extraction returned.
describe("tag (string-search extraction)", () => {
  it.each([
    ["task-id", "a846d07bfac6df8c3"],
    ["tool-use-id", "toolu_01QkZZR3"],
    ["status", "completed"],
    ["summary", "Agent \"x\" finished"],
    ["result", "multi\nline <b>text</b>"],
    ["subagent_tokens", "134225"],
    ["tool_uses", "17"],
    ["duration_ms", "70034"],
    ["usage", "<subagent_tokens>134225</subagent_tokens><tool_uses>17</tool_uses><duration_ms>70034</duration_ms>"],
    ["missing", null],
  ])("extracts <%s>", (name, expected) => {
    expect(tag(BODY, name)).toBe(expected);
  });

  it("returns the FIRST occurrence, trimmed", () => {
    expect(tag("<a>  x  </a><a>y</a>", "a")).toBe("x");
  });

  it("returns null for an unclosed tag", () => {
    expect(tag("<status>completed", "status")).toBeNull();
  });

  it("treats regex metacharacters in the tag name literally", () => {
    expect(tag("<a.b>dot</a.b><axb>x</axb>", "a.b")).toBe("dot");
    expect(tag("<axb>x</axb>", "a.b")).toBeNull();
    expect(tag("<a+(b)>p</a+(b)>", "a+(b)")).toBe("p");
    expect(tag("<[x]>q</[x]>", "[x]")).toBe("q");
  });
});

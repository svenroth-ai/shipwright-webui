import { describe, it, expect } from "vitest";

import { qCmd } from "./launcher.js";

// Regression guard for CodeQL js/incomplete-sanitization (alert #4): the old
// `"${v.replace(/"/g, '\\"')}"` left backslashes unescaped, so a trailing `\`
// could escape the closing quote and a `\` before an embedded `"` produced an
// arg that claude.exe's runtime (CommandLineToArgvW) parses incorrectly. Split
// out of launcher.test.ts (bloat baseline) — qCmd is a distinct unit concern
// from the buildCopyCommands integration tests.
describe("launcher.qCmd — cmd.exe argv quoting (CommandLineToArgvW)", () => {
  it("wraps a plain value in double quotes", () => {
    expect(qCmd("hello")).toBe('"hello"');
  });

  it("preserves an interior backslash run (path) WITHOUT doubling it", () => {
    // C:\foo\bar has no backslash before a quote → must stay byte-identical.
    expect(qCmd(String.raw`C:\foo\bar`)).toBe(String.raw`"C:\foo\bar"`);
  });

  it("doubles a trailing backslash so it cannot escape the closing quote", () => {
    // `String.raw` can't carry a trailing backslash (it escapes the backtick).
    expect(qCmd("C:\\proj\\")).toBe('"C:\\proj\\\\"');
  });

  it("escapes an embedded double quote as \\\"", () => {
    expect(qCmd('a"b')).toBe(String.raw`"a\"b"`);
  });

  it("applies the 2N+1 rule to backslashes that precede an embedded quote", () => {
    // one `\` before `"` → 2*1+1 = 3 backslashes, then the quote.
    expect(qCmd(String.raw`a\"b`)).toBe(String.raw`"a\\\"b"`);
  });

  it("doubles a pure trailing backslash run (2 → 4)", () => {
    expect(qCmd("\\\\")).toBe('"\\\\\\\\"');
  });
});

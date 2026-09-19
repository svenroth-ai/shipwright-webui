import { describe, it, expect } from "vitest";

import { qCmd, qPs, qPsMultiline } from "./shell-quote.js";

// Regression guard for CodeQL js/incomplete-sanitization (alert #4): the old
// `"${v.replace(/"/g, '\\"')}"` left backslashes unescaped, so a trailing `\`
// could escape the closing quote and a `\` before an embedded `"` produced an
// arg that claude.exe's runtime (CommandLineToArgvW) parses incorrectly.
describe("shell-quote.qCmd — cmd.exe argv quoting (CommandLineToArgvW)", () => {
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

// iterate-2026-09-19-codex-launch-powershell-chunk (bug fix): PSReadLine
// (PowerShell 7), fed a multi-line single-quoted string via pty keystroke
// injection (not a real interactive paste), corrupts its edit buffer and
// executes a trailing fragment of the string as a bare command -- reproduced
// live against a real pwsh.exe pty, independent of chunking and of bracketed
// paste. A plain `qPs()` (quote-doubling only) is correct PowerShell syntax
// but does not protect against this: the tokenizer is quote-aware, so the
// literal `'` handling is fine, yet PSReadLine's own multi-line edit buffer
// -- built from separate keystroke-like writes -- still corrupts. The only
// thing that avoided the corruption in the live repro was removing every
// literal newline from the bytes sent to the pty.
describe("shell-quote.qPsMultiline — PSReadLine multi-line-buffer-corruption-safe PowerShell arg", () => {
  it("no newline in the input → behaves exactly like qPs (plain literal, human-readable)", () => {
    expect(qPsMultiline("plain value")).toBe(qPs("plain value"));
    expect(qPsMultiline("it's fine")).toBe(qPs("it's fine"));
  });

  it("a newline in the input → the result contains no raw newline or carriage return", () => {
    const out = qPsMultiline("line one\n\nline two");
    expect(out).not.toMatch(/[\r\n]/);
  });

  it("a newline in the input → the result is a PowerShell sub-expression that decodes back to the exact original text", () => {
    const original = "line one\n\nline two\nline three";
    const out = qPsMultiline(original);
    expect(out).toMatch(/^\$\(\[System\.Text\.Encoding\]::UTF8\.GetString\(\[System\.Convert\]::FromBase64String\('[^']+'\)\)\)$/);
    const match = out.match(/FromBase64String\('([^']+)'\)/);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1], "base64").toString("utf8")).toBe(original);
  });

  it("a lone \\r (no \\n) also takes the base64-safe path", () => {
    const out = qPsMultiline("a\rb");
    expect(out).not.toMatch(/[\r\n]/);
    expect(out).toContain("FromBase64String");
  });

  it("a single quote AND a newline in the same input still round-trips exactly", () => {
    const original = "it's line one\n\nit's line two";
    const out = qPsMultiline(original);
    const match = out.match(/FromBase64String\('([^']+)'\)/);
    expect(Buffer.from(match![1], "base64").toString("utf8")).toBe(original);
  });

  // code-reviewer finding (2026-09-19, low severity): the doc comment claims
  // multi-byte UTF-8 (Buffer.from(...,"utf8") <-> .NET UTF8.GetString are
  // byte-for-byte compatible) round-trips correctly, but no fixture pinned it.
  it("multi-byte UTF-8 content (umlaut, emoji) round-trips exactly", () => {
    const original = "Prüfung läuft\n\n\u{1F680} status: done";
    const out = qPsMultiline(original);
    const match = out.match(/FromBase64String\('([^']+)'\)/);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1], "base64").toString("utf8")).toBe(original);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  endsWithoutNewline,
  splitRecords,
  parseJsonlRecords,
} from "./jsonl-records.js";

// Control characters are built from char codes rather than written as escape
// sequences: this file is dense with them (LF / CR / NBSP / VT / FF) and a
// literal-escape round-trip through an editing tool is a known corruption
// source. Building them explicitly also documents exactly which code point
// each assertion is about.
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const BS = String.fromCharCode(92); // reverse solidus
const QUOTE = String.fromCharCode(34);
const NBSP = String.fromCharCode(0x00a0);
const VTAB = String.fromCharCode(0x000b);
const FF = String.fromCharCode(0x000c);

describe("jsonl-records: splitRecords", () => {
  it("returns a single record and no remainder for a clean line", () => {
    const { records, remainder } = splitRecords('{"event":"append","id":"a"}');
    expect(records).toEqual([{ event: "append", id: "a" }]);
    expect(remainder).toBe("");
  });

  // THE headline defect: two records on one physical line must yield BOTH.
  it("recovers BOTH records from a concatenated line, in wire order", () => {
    const { records, remainder } = splitRecords('{"id":"a"}{"id":"b"}');
    expect(records).toEqual([{ id: "a" }, { id: "b" }]);
    expect(remainder).toBe("");
  });

  it("skips JSON whitespace between concatenated records", () => {
    const line = '{"id":"a"}' + TAB + " " + CR + '{"id":"b"}';
    const { records, remainder } = splitRecords(line);
    expect(records).toEqual([{ id: "a" }, { id: "b" }]);
    expect(remainder).toBe("");
  });

  it("treats a blank / whitespace-only line as formatting, not corruption", () => {
    for (const line of ["", "   ", TAB + " " + CR]) {
      const { records, remainder } = splitRecords(line);
      expect(records).toEqual([]);
      expect(remainder).toBe("");
    }
  });

  // Recovery is PARTIAL by design. All-or-nothing recovery would reproduce the
  // very bug this fixes.
  it("returns a valid record AND the unrecoverable remainder (partial recovery)", () => {
    const { records, remainder } = splitRecords('{"id":"a"}{"id":"b"');
    expect(records).toEqual([{ id: "a" }]);
    expect(remainder).toBe('{"id":"b"');
  });

  it("returns the remainder VERBATIM from the first undecodable byte", () => {
    const { records, remainder } = splitRecords('{"id":"a"}  not-json  ');
    expect(records).toEqual([{ id: "a" }]);
    expect(remainder).toBe("not-json  ");
  });

  it("does NOT resync past a malformed first record", () => {
    // Matches Python raw_decode: once decoding fails, the ENTIRE rest of the
    // line is the remainder, even though a valid object follows.
    const line = '{"id":;}{"id":"b"}';
    const { records, remainder } = splitRecords(line);
    expect(records).toEqual([]);
    expect(remainder).toBe(line);
  });

  describe("only JSON objects count as records", () => {
    it.each([
      ["a bare number", "42"],
      ["a bare string", QUOTE + "str" + QUOTE],
      ["a bare null", "null"],
      ["a bare boolean", "true"],
      ["a top-level array", '[{"id":"a"}]'],
    ])("treats %s as a fragment, not a record", (_label, line) => {
      const { records, remainder } = splitRecords(line);
      expect(records).toEqual([]);
      expect(remainder).toBe(line);
    });
  });

  // Lexical hardening (external review R5). These are the cases where naive
  // brace counting splits in the wrong place.
  describe("lexical edge cases", () => {
    it("ignores braces inside string values", () => {
      const { records, remainder } = splitRecords('{"x":"}{"}{"y":1}');
      expect(records).toEqual([{ x: "}{" }, { y: 1 }]);
      expect(remainder).toBe("");
    });

    it("handles an escaped quote inside a string value", () => {
      // {"x":"\""}{"y":1}
      const line = '{"x":"' + BS + QUOTE + '"}{"y":1}';
      const { records, remainder } = splitRecords(line);
      expect(records).toEqual([{ x: QUOTE }, { y: 1 }]);
      expect(remainder).toBe("");
    });

    it("handles a backslash run immediately before a closing quote", () => {
      // {"x":"a\\"}{"y":1}  -> value is  a\
      const line = '{"x":"a' + BS + BS + '"}{"y":1}';
      const { records, remainder } = splitRecords(line);
      expect(records).toEqual([{ x: "a" + BS }, { y: 1 }]);
      expect(remainder).toBe("");
    });

    it("handles nested objects and arrays", () => {
      const line = '{"a":[{"b":1},{"c":{"d":2}}]}{"e":3}';
      const { records, remainder } = splitRecords(line);
      expect(records).toEqual([{ a: [{ b: 1 }, { c: { d: 2 } }] }, { e: 3 }]);
      expect(remainder).toBe("");
    });

    it("treats an unterminated string as an unrecoverable fragment", () => {
      const line = '{"x":"unterminated}{"y":1}';
      const { records, remainder } = splitRecords(line);
      expect(records).toEqual([]);
      expect(remainder).toBe(line);
    });
  });

  // Explicitly JSON's whitespace set, NOT a unicode-aware test. Accepting these
  // would diverge from every other JSON consumer of the same bytes.
  describe("unicode whitespace is NOT JSON whitespace", () => {
    it.each([
      ["NBSP", NBSP],
      ["vertical tab", VTAB],
      ["form feed", FF],
    ])("does not skip %s between records", (_label, ws) => {
      const { records, remainder } = splitRecords('{"id":"a"}' + ws + '{"id":"b"}');
      expect(records).toEqual([{ id: "a" }]);
      expect(remainder).toBe(ws + '{"id":"b"}');
    });
  });

  // Slow-path work budgets (external review, medium/performance). Both must
  // degrade to "fragment" — never throw, never stall the request thread.
  describe("work budgets bound the recovery walk", () => {
    it("gives up on a line with more closing braces than the attempt budget", () => {
      // 2000 `}` inside a string value, so every candidate slice before the
      // true end fails to parse — the adversarial shape the budget exists for.
      // The trailing `{` defeats the fast path, forcing the slow walk; the true
      // end is candidate ~2001, past MAX_DECODE_ATTEMPTS (1024).
      const line = '{"a":"' + "}".repeat(2000) + '"}' + "{";
      const started = Date.now();
      const { records, remainder } = splitRecords(line);
      expect(records).toEqual([]);
      expect(remainder).toBe(line);
      // Bounded, not merely eventually-terminating.
      expect(Date.now() - started).toBeLessThan(5000);
    });

    it("refuses the slow path for an implausibly long line", () => {
      // Over MAX_RECOVERY_LINE_BYTES (1_000_000). Not a triage record by any
      // reading; hand it back verbatim rather than parse megabytes.
      const line = '{"a":"' + "x".repeat(1_100_000) + '"'; // unterminated → slow path
      const { records, remainder } = splitRecords(line);
      expect(records).toEqual([]);
      expect(remainder).toBe(line);
    });

    it("still uses the FAST path for a long but VALID single record", () => {
      // The length guard must not degrade a legitimate large record: the fast
      // path returns before the guard is ever consulted.
      const big = { a: "x".repeat(1_100_000) };
      const { records, remainder } = splitRecords(JSON.stringify(big));
      expect(records).toEqual([big]);
      expect(remainder).toBe("");
    });
  });

  // Known cross-language boundary (external review R4): Python's default
  // decoder accepts these, JSON.parse does not. Unreachable from the real
  // producers (no float fields), but must degrade safely rather than throw.
  it("degrades a non-finite numeric literal to a fragment instead of throwing", () => {
    const line = '{"a": NaN}';
    expect(() => splitRecords(line)).not.toThrow();
    const { records, remainder } = splitRecords(line);
    expect(records).toEqual([]);
    expect(remainder).toBe(line);
  });
});

describe("jsonl-records: endsWithoutNewline", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "jsonl-records-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  const at = (name: string) => path.join(workDir, name);

  it("returns false for a missing file (safely appendable)", () => {
    expect(endsWithoutNewline(at("nope.jsonl"))).toBe(false);
  });

  it("returns false for a zero-byte file (safely appendable)", () => {
    const p = at("empty.jsonl");
    writeFileSync(p, "");
    expect(endsWithoutNewline(p)).toBe(false);
  });

  it("returns false when the file already ends with LF", () => {
    const p = at("lf.jsonl");
    writeFileSync(p, '{"id":"a"}' + LF);
    expect(endsWithoutNewline(p)).toBe(false);
  });

  it("returns false when the file ends CRLF (already terminated)", () => {
    // A CRLF-terminated file ends in LF; prefixing another newline would
    // inject a blank line.
    const p = at("crlf.jsonl");
    writeFileSync(p, '{"id":"a"}' + CR + LF);
    expect(endsWithoutNewline(p)).toBe(false);
  });

  it("returns true when the final byte is not a newline", () => {
    const p = at("torn.jsonl");
    writeFileSync(p, '{"id":"a"}');
    expect(endsWithoutNewline(p)).toBe(true);
  });

  it("returns false for a directory rather than throwing", () => {
    expect(endsWithoutNewline(workDir)).toBe(false);
  });
});

describe("jsonl-records: parseJsonlRecords", () => {
  it("reads a clean multi-line blob with no corruption", () => {
    const raw = ['{"id":"a"}', '{"id":"b"}', '{"id":"c"}'].join(LF) + LF;
    const result = parseJsonlRecords(raw);
    expect(result.records).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(result.corrupt).toEqual([]);
  });

  it("recovers a concatenated line and preserves wire order across lines", () => {
    const raw = ['{"id":"a"}', '{"id":"b"}{"id":"c"}', '{"id":"d"}'].join(LF) + LF;
    const result = parseJsonlRecords(raw);
    expect(result.records).toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
      { id: "d" },
    ]);
    expect(result.corrupt).toEqual([]);
  });

  it("reports an unrecoverable fragment as data, with a 1-based line number", () => {
    const raw = ['{"id":"a"}', '{"id":"b"}garbage', '{"id":"c"}'].join(LF) + LF;
    const result = parseJsonlRecords(raw);
    expect(result.records).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(result.corrupt).toHaveLength(1);
    expect(result.corrupt[0].lineNo).toBe(2);
    expect(result.corrupt[0].text).toBe("garbage");
  });

  it("counts blank lines when numbering, and does not report them as corrupt", () => {
    const raw = ['{"id":"a"}', "", "   ", '{"id":"b"}bad'].join(LF);
    const result = parseJsonlRecords(raw);
    expect(result.records).toEqual([{ id: "a" }, { id: "b" }]);
    expect(result.corrupt).toHaveLength(1);
    expect(result.corrupt[0].lineNo).toBe(4);
  });

  it("absorbs a trailing CR so CRLF blobs round-trip unchanged", () => {
    const raw = ['{"id":"a"}', '{"id":"b"}'].join(CR + LF) + CR + LF;
    const result = parseJsonlRecords(raw);
    expect(result.records).toEqual([{ id: "a" }, { id: "b" }]);
    expect(result.corrupt).toEqual([]);
  });

  it("reports every corrupt line independently", () => {
    const raw = ['{"id":"a"}x', '{"id":"b"}', '{"id":"c"}y'].join(LF);
    const result = parseJsonlRecords(raw);
    expect(result.records).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(result.corrupt.map((c) => c.lineNo)).toEqual([1, 3]);
  });
});

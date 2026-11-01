// @covers FR-01.28
import { describe, expect, it } from "vitest";

import { findFileLinkCandidates } from "./terminalLinkMatch";

function one(text: string) {
  const found = findFileLinkCandidates(text);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe("findFileLinkCandidates", () => {
  it("finds a relative path with line and column", () => {
    const c = one("error in src/a.ts:12:5 here");
    expect(c.ref).toEqual({ path: "src/a.ts", line: 12 });
    expect("error in src/a.ts:12:5 here".slice(c.start, c.end)).toBe("src/a.ts:12:5");
  });

  it("finds ./relative, bare recognized names, POSIX absolute and Windows drive paths", () => {
    expect(one("./a.ts").ref.path).toBe("a.ts");
    expect(one("README.md").ref.path).toBe("README.md");
    expect(one("/home/u/a.py").ref.path).toBe("/home/u/a.py");
    expect(one("C:\\proj\\a.ts:3").ref).toEqual({ path: "C:\\proj\\a.ts", line: 3 });
    expect(one("C:/proj/a.ts").ref.path).toBe("C:/proj/a.ts");
  });

  it("strips surrounding punctuation, quotes, parens and box-drawing borders", () => {
    for (const t of ["see a.ts,", "see a.ts.", "see a.ts:", '"a.ts"', "'a.ts'", "`a.ts`", "(a.ts)", "@a.ts", "|a.ts|"]) {
      const c = one(t);
      expect(c.ref.path).toBe("a.ts");
      expect(t.slice(c.start, c.end)).toBe("a.ts");
    }
    expect(one("at fn (C:\\p\\a.js:10:5)").ref).toEqual({ path: "C:\\p\\a.js", line: 10 });
  });

  it("understands the tsc style a.ts(12,5)", () => {
    const t = "src/a.ts(12,5): error TS2322";
    const c = one(t);
    expect(c.ref).toEqual({ path: "src/a.ts", line: 12 });
    expect(t.slice(c.start, c.end)).toBe("src/a.ts(12,5)");
  });

  it("takes the value of --flag=path", () => {
    const t = "--file=src/a.ts";
    const c = one(t);
    expect(c.ref.path).toBe("src/a.ts");
    expect(t.slice(c.start, c.end)).toBe("src/a.ts");
  });

  it("a space always ends the path (paths with spaces are not linked as a whole)", () => {
    expect(findFileLinkCandidates(String.raw`C:\Program Files\app\a`)).toEqual([]);
    const t = "/tmp/my file.ts";
    // the tail of a spaced absolute path is never linked on its own
    expect(findFileLinkCandidates(t)).toEqual([]);
    expect(findFileLinkCandidates(String.raw`C:\Program Files\app\a.ts`)).toEqual([]);
    expect(findFileLinkCandidates("/Users/x/My Docs/a.ts")).toEqual([]);
    // more than one space: the whole tail is suppressed, not just the first fragment
    expect(findFileLinkCandidates(String.raw`C:\Program Files\My App\a.ts`)).toEqual([]);
    expect(findFileLinkCandidates("/Users/x/My Docs/Sub Dir/a.ts")).toEqual([]);
    // quoted / parenthesised / --flag= / relative heads behave like bare ones
    for (const t of [
      `open 'C:\\Users\\x\\My Docs\\a.ts'`,
      `("/Users/x/My Docs/a.ts")`,
      String.raw`--out=C:\My Docs\a.ts`,
      String.raw`"C:\Program Files\app\a.ts"`,
      "./My Docs/a.ts",
      "~/My Docs/a.ts",
    ]) {
      expect(findFileLinkCandidates(t), t).toEqual([]);
    }
    // intermediate words without a separator do not end the suppression
    expect(findFileLinkCandidates("/Users/x/My Long Docs/a.ts")).toEqual([]);
    // wrapping punctuation on a complete path does not turn it into a "head"
    expect(findFileLinkCandidates(String.raw`(C:\p\a.js) src/b.ts`).map((x) => x.ref.path)).toEqual([String.raw`C:\p\a.js`, "src/b.ts"]);
    expect(findFileLinkCandidates(String.raw`"C:\p\a.js" b/c.ts`).map((x) => x.ref.path)).toEqual([String.raw`C:\p\a.js`, "b/c.ts"]);
    // VAR=value with a spaced path: the tail is suppressed, later paths still link
    expect(findFileLinkCandidates(String.raw`VAR=C:\some dir\a.ts b/c.ts`).map((x) => x.ref.path)).toEqual(["b/c.ts"]);
    // a complete file path before a space does not poison the next token
    expect(findFileLinkCandidates("/x/a.ts b.md").map((x) => x.ref.path)).toEqual(["/x/a.ts", "b.md"]);
  });

  it("does not link code, versions, URLs, file:, UNC, traversal or ~", () => {
    for (const t of [
      "console.log",
      "process.env",
      "v1.2.3",
      "https://h.test/x/a.ts",
      "http://h.test/a.ts",
      "file:///x/a.ts",
      "\\\\srv\\share\\a.ts",
      "../a.ts",
      "a/../b.ts",
      "~/a.ts",
      "e.g.",
      "javascript:alert(1)",
      "/home/u/proj/../secrets.txt",
      "--url=https://h.test/src/a.ts",
    ]) {
      expect(findFileLinkCandidates(t), t).toEqual([]);
    }
  });

  it("finds several candidates in one line with correct offsets", () => {
    const t = "a.ts b/c.md";
    const found = findFileLinkCandidates(t);
    expect(found.map((x) => t.slice(x.start, x.end))).toEqual(["a.ts", "b/c.md"]);
  });
});

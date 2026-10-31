import { describe, expect, it } from "vitest";

import { fullPathOf, parseFileRef, resolveViewerTarget, targetFromText } from "./viewerTarget";

const ROOT = "C:\\dev\\app";

// @covers FR-01.66
describe("parseFileRef", () => {
  it("accepts relative and absolute paths with an optional :line / #L suffix", () => {
    expect(parseFileRef("client/src/a.ts")).toEqual({ path: "client/src/a.ts" });
    expect(parseFileRef("./client/src/a.ts:98")).toEqual({ path: "client/src/a.ts", line: 98 });
    expect(parseFileRef("src/a.ts:98:5")).toEqual({ path: "src/a.ts", line: 98 });
    expect(parseFileRef("src/a.ts#L12-L20")).toEqual({ path: "src/a.ts", line: 12 });
    expect(parseFileRef("C:\\dev\\app\\src\\a.ts:3")).toEqual({ path: "C:\\dev\\app\\src\\a.ts", line: 3 });
    expect(parseFileRef("/home/u/x.md")).toEqual({ path: "/home/u/x.md" });
    expect(parseFileRef("README.md")).toEqual({ path: "README.md" });
  });

  it("handles file:// URLs and percent-encoded hrefs", () => {
    expect(parseFileRef("file:///C:/dev/app/a%20b.md")).toEqual({ path: "C:/dev/app/a b.md" });
    expect(parseFileRef("docs/a%20b.md", { decode: true })).toEqual({ path: "docs/a b.md" });
  });

  it("rejects URLs, anchors, code-looking names, traversal, UNC and non-files", () => {
    for (const s of [
      "https://example.com/a.md",
      "mailto:a@b.co",
      "#section",
      "console.log",
      "process.env",
      "v1.2.3",
      "../secret.ts",
      "a/../b.ts",
      "\\\\server\\share\\a.txt",
      "src/folder",
      "/tmp/../secret.md",
      "C:\\dev\\app\\..\\secret.md",
      "file://server/share/a.txt",
      "run the tests.ts now",
      "",
    ]) {
      expect(parseFileRef(s), s).toBeNull();
    }
  });
});

// @covers FR-01.66
describe("resolveViewerTarget", () => {
  it("absolute path under the project root becomes a root-relative project path", () => {
    expect(resolveViewerTarget({ path: "c:\\dev\\app\\src\\a.ts" }, ROOT)).toEqual({ path: "src/a.ts", outside: false });
  });
  it("absolute path elsewhere is an outside (session) target, line kept", () => {
    expect(resolveViewerTarget({ path: "D:\\other\\x.md", line: 4 }, ROOT)).toEqual({ path: "D:\\other\\x.md", outside: true, line: 4 });
    expect(resolveViewerTarget({ path: "/tmp/x.json" }, null)).toEqual({ path: "/tmp/x.json", outside: true });
  });
  it("relative path is relative to the SESSION cwd (subfolder task, iterate worktree), not the project root", () => {
    const sub = ROOT + "\\client";
    expect(resolveViewerTarget({ path: "src/lib/x.ts", line: 3 }, ROOT, sub)).toEqual({ path: "client/src/lib/x.ts", outside: false, line: 3 });
    // a worktree task: its files are NOT the main tree's copy -> served via the session route, absolute
    const wt = "C:\\dev\\app-wt\\iter-1";
    expect(resolveViewerTarget({ path: "src/a.ts" }, ROOT, wt)).toEqual({ path: wt + "\\src\\a.ts", outside: true });
    // no project (unassigned) but a cwd: an absolute session-route target
    expect(resolveViewerTarget({ path: "notes/a.md" }, null, "/home/u/work")).toEqual({ path: "/home/u/work/notes/a.md", outside: true });
    // cwd outside the root
    expect(resolveViewerTarget({ path: "a.ts" }, ROOT, "D:\\elsewhere")).toEqual({ path: "D:\\elsewhere\\a.ts", outside: true });
    // absolute paths are unchanged by cwd
    expect(resolveViewerTarget({ path: "C:\\dev\\app\\src\\a.ts" }, ROOT, sub)).toEqual({ path: "src/a.ts", outside: false });
  });
  it("decoded and drive-stream tricks never become chips", () => {
    expect(parseFileRef("docs/a%0Ab.md", { decode: true })).toBeNull();
    expect(parseFileRef("docs/a%00.md", { decode: true })).toBeNull();
    expect(parseFileRef("C:\\dev\\app\\a.txt:hidden")).toBeNull();
    expect(parseFileRef("src/a.ts:stream:$DATA")).toBeNull();
    expect(parseFileRef("C:\\dev\\app\\a.ts:12")).toEqual({ path: "C:\\dev\\app\\a.ts", line: 12 });
  });
  it("relative path needs a project root", () => {
    expect(resolveViewerTarget({ path: "src/a.ts" }, ROOT)).toEqual({ path: "src/a.ts", outside: false });
    expect(resolveViewerTarget({ path: "src/a.ts" }, null)).toBeNull();
  });
  it("targetFromText chains both", () => {
    expect(targetFromText("`x`", ROOT)).toBeNull();
    expect(targetFromText("src/a.ts:9", ROOT)).toEqual({ path: "src/a.ts", outside: false, line: 9 });
  });
});

// @covers FR-01.66
describe("fullPathOf", () => {
  it("joins an inside path onto the root in the root's own separator style; outside stays absolute", () => {
    expect(fullPathOf({ path: "client/src/a.ts", outside: false }, ROOT + "\\")).toBe(ROOT + "\\client\\src\\a.ts");
    expect(fullPathOf({ path: "a/b.ts", outside: false }, "/home/u/app")).toBe("/home/u/app/a/b.ts");
    expect(fullPathOf({ path: "D:\\o\\x.md", outside: true }, ROOT)).toBe("D:\\o\\x.md");
    expect(fullPathOf({ path: "a.ts", outside: false }, null)).toBe("a.ts");
  });
});

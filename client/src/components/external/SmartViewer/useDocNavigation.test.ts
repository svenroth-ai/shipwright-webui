/*
 * useDocNavigation specs — iterate-2026-05-30-smartviewer-render-ux (AC8
 * cross-file follow-up). Pins the relative-path resolution, including the
 * exact RTM link shape that the real-data check surfaced.
 */

import { describe, it, expect } from "vitest";

import { resolveDocPath } from "./useDocNavigation";

describe("resolveDocPath", () => {
  it("resolves the real RTM cross-file link (../../…/spec.md#fr-0101)", () => {
    expect(
      resolveDocPath(
        ".shipwright/compliance/traceability-matrix.md",
        "../../.shipwright/planning/01-adopted/spec.md#fr-0101",
      ),
    ).toEqual({ path: ".shipwright/planning/01-adopted/spec.md", fragment: "fr-0101" });
  });

  it("resolves a sibling link relative to the current file's directory", () => {
    expect(resolveDocPath("docs/guide.md", "api.md")).toEqual({
      path: "docs/api.md",
      fragment: null,
    });
  });

  it("resolves a parent-dir link + fragment", () => {
    expect(resolveDocPath("docs/sub/page.md", "../intro.md#start")).toEqual({
      path: "docs/intro.md",
      fragment: "start",
    });
  });

  it("clamps `../` at the project root (cannot escape above it)", () => {
    expect(resolveDocPath("a.md", "../../../etc/passwd.md").path).toBe("etc/passwd.md");
  });

  // @covers FR-01.02
  it("hops between sibling sub-folders and handles ./ (the VS Code-style case)", () => {
    expect(resolveDocPath("docs/a/one.md", "../b/two.md").path).toBe("docs/b/two.md");
    expect(resolveDocPath("docs/a/one.md", "./sub/../three.md").path).toBe("docs/a/three.md");
  });

  // @covers FR-01.02
  it("decodes %20 once (no double-encoding) and tolerates a malformed escape", () => {
    expect(resolveDocPath("docs/one.md", "../My%20Notes/a%20b.md").path).toBe("My Notes/a b.md");
    expect(resolveDocPath("docs/one.md", "x%ZZ.md#100%")).toEqual({ path: "docs/x%ZZ.md", fragment: "100%" });
  });

  // @covers FR-01.02
  it("ignores a ?query and resolves a leading / against the project root", () => {
    expect(resolveDocPath("docs/one.md", "two.md?plain=1#top")).toEqual({ path: "docs/two.md", fragment: "top" });
    expect(resolveDocPath("docs/deep/one.md", "/README.md").path).toBe("README.md");
  });

  // @covers FR-01.02
  it("resolves non-markdown targets and fragment-only links", () => {
    expect(resolveDocPath("docs/one.md", "../src/app.ts").path).toBe("src/app.ts");
    expect(resolveDocPath("docs/one.md", "#sec")).toEqual({ path: "docs/one.md", fragment: "sec" });
  });

  // @covers FR-01.02
  it("resolves against an OUTSIDE absolute path (drive / posix / UNC) and clamps at its root", () => {
    expect(resolveDocPath("C:\\work\\docs\\a.md", "../b/c.md").path).toBe("C:/work/b/c.md");
    expect(resolveDocPath("C:/work/a.md", "../../../x.md").path).toBe("C:/x.md");
    expect(resolveDocPath("/home/u/docs/a.md", "../b.md").path).toBe("/home/u/b.md");
    expect(resolveDocPath("//srv/share/docs/a.md", "../../../b.md").path).toBe("//srv/share/b.md");
  });
});

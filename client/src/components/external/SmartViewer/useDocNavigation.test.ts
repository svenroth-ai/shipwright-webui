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
});

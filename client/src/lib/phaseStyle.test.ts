import { describe, it, expect } from "vitest";
import { getPhaseStyle, derivePhaseFromTitle } from "./phaseStyle";

describe("getPhaseStyle", () => {
  it("returns the right palette for each canonical phase id", () => {
    expect(getPhaseStyle("compliance").dot).toContain("#0EA5E9");
    expect(getPhaseStyle("build").dot).toContain("#F59E0B");
    expect(getPhaseStyle("security").dot).toContain("#DC2626");
    expect(getPhaseStyle("adopt").dot).toContain("#64748B");
  });

  it("is case-insensitive on phase id", () => {
    expect(getPhaseStyle("Compliance")).toEqual(getPhaseStyle("compliance"));
    expect(getPhaseStyle("BUILD")).toEqual(getPhaseStyle("build"));
  });

  it("falls back to the build palette for unknown phase ids", () => {
    expect(getPhaseStyle("future-unknown")).toEqual(getPhaseStyle("build"));
    expect(getPhaseStyle("")).toEqual(getPhaseStyle("build"));
  });

  it("falls back to build when phase id is undefined", () => {
    expect(getPhaseStyle(undefined)).toEqual(getPhaseStyle("build"));
  });
});

describe("derivePhaseFromTitle (v0.3.1 — shared TaskCard / TaskDetailHeader fallback)", () => {
  it("returns build for build/implement/fix keywords", () => {
    expect(derivePhaseFromTitle("Build login flow")?.id).toBe("build");
    expect(derivePhaseFromTitle("Implement login")?.id).toBe("build");
    expect(derivePhaseFromTitle("Fix login bug")?.id).toBe("build");
    expect(derivePhaseFromTitle("Build login flow")?.label).toBe("Build");
  });

  it("returns plan for plan keyword", () => {
    expect(derivePhaseFromTitle("Plan the auth architecture")?.id).toBe("plan");
  });

  it("returns design for design/ui/mockup keywords", () => {
    expect(derivePhaseFromTitle("Design the dashboard")?.id).toBe("design");
    expect(derivePhaseFromTitle("UI for settings page")?.id).toBe("design");
    expect(derivePhaseFromTitle("Mockup approval")?.id).toBe("design");
  });

  it("returns test for test/qa/e2e keywords", () => {
    expect(derivePhaseFromTitle("Test the login flow")?.id).toBe("test");
    expect(derivePhaseFromTitle("QA pass")?.id).toBe("test");
    expect(derivePhaseFromTitle("e2e cleanup")?.id).toBe("test");
  });

  // v0.4.1 regression — pre-fix the "suite" / "webui" substrings of "ui"
  // would mis-match the design regex. Word-boundary `\bui\b` fixes it.
  it("v0.4.1 — does NOT match design when 'ui' is a substring (suite, webui, …)", () => {
    expect(derivePhaseFromTitle("e2e suite cleanup")?.id).toBe("test");
    expect(derivePhaseFromTitle("WebUI Repo Adopten")?.id).toBe("adopt");
    expect(derivePhaseFromTitle("Refactor webui rendering")?.id).toBeUndefined;
    // "Refactor webui rendering" has no plan/build/etc keywords as
    // standalone words → null.
    expect(derivePhaseFromTitle("Refactor webui rendering")).toBeNull();
  });

  it("v0.4.1 — adopt branch matches Adopt-titled tasks", () => {
    expect(derivePhaseFromTitle("Adopt the legacy repo")?.id).toBe("adopt");
    expect(derivePhaseFromTitle("WebUI Repo Adopten")?.id).toBe("adopt");
    expect(derivePhaseFromTitle("adopt")?.id).toBe("adopt");
    // Word-boundary: "adoption" should NOT match (substring guard).
    expect(derivePhaseFromTitle("Adoption strategy")).toBeNull();
  });

  it("returns iterate for iterate keyword", () => {
    expect(derivePhaseFromTitle("Iterate on auth flow")?.id).toBe("iterate");
  });

  it("returns null for titles with no recognized keyword", () => {
    expect(derivePhaseFromTitle("Random title")).toBeNull();
    expect(derivePhaseFromTitle(undefined)).toBeNull();
    expect(derivePhaseFromTitle("")).toBeNull();
  });

  it("plan takes precedence over build/test in mixed titles (matches TaskDetailHeader order)", () => {
    expect(derivePhaseFromTitle("Plan and implement auth")?.id).toBe("plan");
  });

  it("adopt takes precedence over other keywords (highest priority)", () => {
    expect(derivePhaseFromTitle("Adopt and plan auth")?.id).toBe("adopt");
    expect(derivePhaseFromTitle("Build adopt fixture")?.id).toBe("adopt");
  });
});

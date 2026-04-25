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

  // Regression: "suite" contains "ui" which collides with the design
  // regex. The current heuristic picks design over test for that input.
  // Documented as a known limitation — title-based fallback is best-effort
  // only; authoritative source is `task.phase` set on launch.
  it("documents the suite/ui false-positive (heuristic limitation)", () => {
    expect(derivePhaseFromTitle("e2e suite cleanup")?.id).toBe("design");
  });

  it("returns iterate for iterate keyword", () => {
    expect(derivePhaseFromTitle("Iterate on auth UX")?.id).toBe("iterate");
  });

  it("returns null for titles with no recognized keyword", () => {
    expect(derivePhaseFromTitle("Random title")).toBeNull();
    expect(derivePhaseFromTitle(undefined)).toBeNull();
    expect(derivePhaseFromTitle("")).toBeNull();
  });

  it("plan takes precedence over build/test in mixed titles (matches TaskDetailHeader order)", () => {
    expect(derivePhaseFromTitle("Plan and implement auth")?.id).toBe("plan");
  });
});

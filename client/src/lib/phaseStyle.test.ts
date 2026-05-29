import { describe, it, expect } from "vitest";
import { getPhaseStyle, derivePhaseFromTitle, resolveTaskPhase } from "./phaseStyle";

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

describe("resolveTaskPhase (2026-05-27 — actionId-aware phase resolution)", () => {
  it("returns null for new-plain regardless of title", () => {
    expect(
      resolveTaskPhase({ actionId: "new-plain", title: "Build login flow" }),
    ).toBeNull();
  });

  it("prefers persisted phase + phaseLabel pair", () => {
    expect(
      resolveTaskPhase({
        actionId: "new-task",
        phase: "compliance",
        phaseLabel: "Compliance",
        title: "audit drift",
      }),
    ).toEqual({ id: "compliance", label: "Compliance" });
  });

  // Regression: iterate-2026-05-27-fix-phase-pill-iterate-title-fallback.
  // Pre-fix, a new-iterate task with no persisted phase and title starting
  // with "Fix …" matched the build regex → showed a Build pill. new-iterate
  // tasks must always resolve to the iterate phase when no phase is
  // persisted, since the action and the phase share an axis and iterate
  // titles are free-form bug/feature descriptions.
  it("resolves new-iterate without persisted phase to iterate (never title-derived)", () => {
    expect(
      resolveTaskPhase({
        actionId: "new-iterate",
        title: "Fix for SBOM: 2 undeclared license(s) in plugins/...",
      }),
    ).toEqual({ id: "iterate", label: "Iterate" });
    expect(
      resolveTaskPhase({
        actionId: "new-iterate",
        title: "Implement new dashboard layout",
      }),
    ).toEqual({ id: "iterate", label: "Iterate" });
    expect(
      resolveTaskPhase({ actionId: "new-iterate", title: "Plan the rewrite" }),
    ).toEqual({ id: "iterate", label: "Iterate" });
  });

  it("server-persisted phase still wins for new-iterate tasks", () => {
    // If the iterate skill ever decides to persist a different phase
    // (currently it doesn't, but the contract should hold), respect it.
    expect(
      resolveTaskPhase({
        actionId: "new-iterate",
        phase: "build",
        phaseLabel: "Build",
        title: "anything",
      }),
    ).toEqual({ id: "build", label: "Build" });
  });

  it("falls back to title-keyword derivation for non-iterate, non-plain actions", () => {
    expect(
      resolveTaskPhase({ actionId: "new-task", title: "Plan the rewrite" }),
    ).toEqual({ id: "plan", label: "Plan" });
    expect(
      resolveTaskPhase({ actionId: "new-task", title: "Random title" }),
    ).toBeNull();
  });

  it("requires both phase + phaseLabel for the persisted path (matches TaskDetailHeader semantics)", () => {
    // Only phase, no label → falls through to actionId/title logic.
    expect(
      resolveTaskPhase({
        actionId: "new-iterate",
        phase: "build",
        title: "anything",
      }),
    ).toEqual({ id: "iterate", label: "Iterate" });
  });
});

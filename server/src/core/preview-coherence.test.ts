import { describe, it, expect } from "vitest";
import {
  profileDeclaresFrontend,
  evaluatePreviewCoherence,
  type PreviewCoherenceProfile,
} from "./preview-coherence.js";

describe("profileDeclaresFrontend (F32 — boot coherence frontend classification)", () => {
  it("treats an intentionally-empty stack.frontend {} as backend-only", () => {
    // The bundled python-plugin-monorepo profile ships
    // `stack.frontend: {}` + `dev_server: null`. The pre-fix predicate
    // used `Boolean({})` (=== true), classifying it as frontend-present
    // and warning on every boot. An empty object is backend-only by
    // design — this assertion is RED against the old `Boolean(...)` logic.
    expect(profileDeclaresFrontend({})).toBe(false);
  });

  it("treats a populated stack.frontend as frontend-declared", () => {
    expect(profileDeclaresFrontend({ framework: "react" })).toBe(true);
  });

  it("treats absent / null frontend as backend-only", () => {
    expect(profileDeclaresFrontend(undefined)).toBe(false);
    expect(profileDeclaresFrontend(null)).toBe(false);
  });

  it("keeps pre-fix Boolean semantics for non-object values (narrows only {})", () => {
    // The fix narrows ONLY the empty-object case; non-object values keep
    // their old truthiness so no unrelated profile shape changes behavior.
    expect(profileDeclaresFrontend("react")).toBe(true);
    expect(profileDeclaresFrontend(0)).toBe(false);
    expect(profileDeclaresFrontend(false)).toBe(false);
  });

  it("treats an empty array as backend-only, a non-empty array as declared", () => {
    expect(profileDeclaresFrontend([])).toBe(false);
    expect(profileDeclaresFrontend(["react"])).toBe(true);
  });
});

describe("evaluatePreviewCoherence (plan § 2.1 warn matrix)", () => {
  it("does NOT warn for a backend-only stack (frontend:{}, dev_server:null) — F32 regression", () => {
    // Exact bundled python-plugin-monorepo shape from the F32 audit:
    // `"stack": { "frontend": {} }` paired with `"dev_server": null`.
    const prof: PreviewCoherenceProfile = {
      stack: { frontend: {} },
      dev_server: null,
    };
    expect(evaluatePreviewCoherence("p1", "python-plugin-monorepo", prof)).toBeNull();
  });

  it("also stays quiet when dev_server is absent (undefined) for an empty frontend", () => {
    const prof: PreviewCoherenceProfile = {
      stack: { frontend: {} },
      dev_server: undefined,
    };
    expect(evaluatePreviewCoherence("p1b", "backend-only-undef", prof)).toBeNull();
  });

  it("warns when a populated frontend has no dev_server.command (preview stays hidden) — regression pin", () => {
    const prof: PreviewCoherenceProfile = {
      stack: { frontend: { framework: "react" } },
      dev_server: undefined,
    };
    const w = evaluatePreviewCoherence("p2", "some-frontend", prof);
    expect(w?.level).toBe("warn");
    expect(w?.message).toContain("no dev_server.command");
    expect(w?.projectId).toBe("p2");
    expect(w?.profile).toBe("some-frontend");
  });

  it("warns when dev_server.command exists but no frontend is declared (ADR-036)", () => {
    const prof: PreviewCoherenceProfile = {
      stack: { frontend: {} },
      dev_server: { command: "npm run dev", port: 5173 },
    };
    const w = evaluatePreviewCoherence("p3", "backend-with-devserver", prof);
    expect(w?.message).toContain("no stack.frontend");
  });

  it("does NOT warn for a fully-wired frontend stack", () => {
    const prof: PreviewCoherenceProfile = {
      stack: { frontend: { framework: "react" } },
      dev_server: { command: "npm run dev", port: 5173 },
    };
    expect(evaluatePreviewCoherence("p4", "react-node", prof)).toBeNull();
  });

  it("does NOT warn for a backend-only stack with no stack key at all", () => {
    const prof: PreviewCoherenceProfile = { dev_server: undefined };
    expect(evaluatePreviewCoherence("p5", "pure-backend", prof)).toBeNull();
  });
});

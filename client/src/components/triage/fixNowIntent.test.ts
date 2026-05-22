/*
 * fixNowIntent.test.ts — drift protection for the source-only
 * Fix-now discriminator (iterate-2026-05-21-triage-fix-now-and-phase-slash).
 *
 * Lives in its own test file so the discriminator is exercised in
 * isolation from TriageDetailModal's render tree. If a future
 * iterate widens or narrows the SECURITY_SOURCES set, these tests
 * fail loudly with the exact discriminator behaviour.
 */
import { describe, it, expect } from "vitest";

import { buildFixNowIntent, isSecuritySource } from "./fixNowIntent";
import type { TriageItem } from "../../lib/triageApi";
import type { ResolvedProjectActions } from "../../lib/externalApi";

const catalog: ResolvedProjectActions = {
  actions: [
    {
      id: "new-task",
      label: "New task",
      kind: "external_launch",
    },
    {
      id: "new-iterate",
      label: "New iterate",
      kind: "external_launch",
    },
  ],
  phases: [{ id: "security", label: "Security", color: "#DC2626" }],
  defaults: { autonomy: "guided" },
  preview: {
    enabled: false,
    command: null,
    port: null,
    ready_path: null,
    ready_timeout_seconds: null,
  },
  diagnostics: [],
};

function makeItem(over: Partial<TriageItem> = {}): TriageItem {
  return {
    id: "trg-test",
    ts: "2026-05-21T08:00:00Z",
    originalTs: "2026-05-21T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    title: "Example",
    detail: "Detail",
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: null,
    status: "triage",
    suggestedPriority: "P2",
    suggestedDomain: "engineering",
    statusBy: null,
    statusReason: null,
    promotedTaskId: null,
    ...over,
  };
}

describe("isSecuritySource", () => {
  it("returns true for source=github", () => {
    expect(isSecuritySource(makeItem({ source: "github" }))).toBe(true);
  });

  it("returns false for source=iterate (regression guard — iterate is iterate-flow)", () => {
    expect(isSecuritySource(makeItem({ source: "iterate" }))).toBe(false);
  });

  it("returns false for source=phaseQuality", () => {
    expect(isSecuritySource(makeItem({ source: "phaseQuality" }))).toBe(false);
  });

  it("returns false for source=compliance (regression guard — compliance is iterate-flow per Sven UAT 2026-05-21)", () => {
    expect(isSecuritySource(makeItem({ source: "compliance" }))).toBe(false);
  });
});

describe("buildFixNowIntent", () => {
  it("github source → new-task + phase=security + 'Fix for' title prefix", () => {
    const result = buildFixNowIntent(
      makeItem({
        source: "github",
        title: "GitHub security: 35 shipwright-security finding(s) (high)",
        detail: "Detail body",
        suggestedPriority: "P1",
        suggestedDomain: "engineering",
      }),
      catalog,
      "proj-test",
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.intent.action.id).toBe("new-task");
    expect(result.intent.initialPhaseId).toBe("security");
    expect(result.intent.initialTitle).toBe(
      "Fix for GitHub security: 35 shipwright-security finding(s) (high)",
    );
    expect(result.intent.initialDescription).toBe("Detail body");
    expect(result.intent.initialPriority).toBe("P1");
    expect(result.intent.initialDomain).toBe("engineering");
  });

  it("non-github source → new-iterate, no phase pre-fill", () => {
    const result = buildFixNowIntent(
      makeItem({
        source: "iterate",
        title: "Some change",
        suggestedPriority: "P3",
        suggestedDomain: "platform",
      }),
      catalog,
      "proj-test",
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.intent.action.id).toBe("new-iterate");
    expect(result.intent.initialPhaseId).toBeUndefined();
    expect(result.intent.initialTitle).toBe("Fix for Some change");
    expect(result.intent.initialPriority).toBe("P3");
    expect(result.intent.initialDomain).toBe("platform");
  });

  it("returns failed when catalog is undefined (not loaded yet)", () => {
    const result = buildFixNowIntent(
      makeItem({ source: "github" }),
      undefined,
      "proj-test",
    );
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.message).toContain("catalog not loaded");
  });

  it("returns failed when the resolved actionId is missing from the catalog", () => {
    const partialCatalog: ResolvedProjectActions = {
      ...catalog,
      actions: catalog.actions.filter((a) => a.id !== "new-task"),
    };
    const result = buildFixNowIntent(
      makeItem({ source: "github" }),
      partialCatalog,
      "proj-test",
    );
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.message).toContain("new-task");
  });

  // iterate-2026-05-22-triage-fix-now-project-preselect — the project the
  // triage item belongs to MUST round-trip through the intent so the
  // parent (TriagePage) can pre-select the right project in the spawned
  // NewIssueModal. Before this iterate the project was silently dropped
  // and the modal fell back to realProjects[0] / sidebar filter.
  it("intent carries projectId so the modal pre-selects the right project (github source)", () => {
    const result = buildFixNowIntent(
      makeItem({ source: "github" }),
      catalog,
      "proj-zzz",
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.intent.projectId).toBe("proj-zzz");
  });

  it("intent carries projectId for non-github sources too (new-iterate route)", () => {
    const result = buildFixNowIntent(
      makeItem({ source: "iterate" }),
      catalog,
      "proj-abc",
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.intent.projectId).toBe("proj-abc");
  });
});

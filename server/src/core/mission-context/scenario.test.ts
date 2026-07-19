/*
 * scenario.test.ts — the §4 ordered precedence table + its conflict cases (AC4).
 *
 * The two conflicts named in the CONTRACT test strategy are the reason the
 * table is ordered at all:
 *   - a STALE pointer under a custom-actions project must not resurrect Mission;
 *   - a `campaign:` TITLE without a record is not a campaign.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { detectScenario, isValidatedCustomActions, type ScenarioInputs } from "./scenario.js";
import type { ReadPointerResult } from "./pointer.js";

const okPointer: ReadPointerResult = {
  status: "ok",
  pointer: {
    runId: "iterate-2026-07-18-demo",
    slug: "demo",
    branch: "iterate/demo",
    worktreePath: null,
    mainRoot: "/p",
    sessionId: "3c9e3e11-4b53-424e-8062-f9f5a24f6b68",
    createdAt: null,
  },
};

function inputs(over: Partial<ScenarioInputs> = {}): ScenarioInputs {
  return {
    pointer: { status: "absent" },
    actions: { fromUser: false, hasDiagnostics: false, actionIds: ["new-task", "new-iterate"] },
    runConfigStatus: "missing",
    phaseTaskId: null,
    taskRunId: null,
    campaignSlug: null,
    hasCampaignRecord: false,
    ...over,
  };
}

describe("isValidatedCustomActions", () => {
  const custom = {
    fromUser: true,
    hasDiagnostics: false,
    actionIds: ["new-content-orchestrator", "publish-post"],
  };

  it("is true for an explicit, clean, non-SDLC catalog with no run-config", () => {
    expect(isValidatedCustomActions(inputs({ actions: custom }))).toBe(true);
  });

  it("is FALSE when the file merely exists but is the bundled default", () => {
    expect(isValidatedCustomActions(inputs({ actions: { ...custom, fromUser: false } }))).toBe(false);
  });

  it("is FALSE for a MALFORMED actions file (ambiguous → never hide a tab)", () => {
    expect(isValidatedCustomActions(inputs({ actions: { ...custom, hasDiagnostics: true } }))).toBe(false);
  });

  it("is FALSE in DUAL mode (a builtin SDLC action survives alongside customs)", () => {
    expect(
      isValidatedCustomActions(
        inputs({ actions: { ...custom, actionIds: ["publish-post", "new-iterate"] } }),
      ),
    ).toBe(false);
  });

  it("is FALSE when the project has a valid SDLC run-config", () => {
    expect(isValidatedCustomActions(inputs({ actions: custom, runConfigStatus: "ok" }))).toBe(false);
  });

  it("is FALSE when nothing resolved at all", () => {
    expect(isValidatedCustomActions(inputs({ actions: { ...custom, actionIds: [] } }))).toBe(false);
  });
});

describe("detectScenario precedence", () => {
  const customActions = {
    fromUser: true,
    hasDiagnostics: false,
    actionIds: ["new-content-orchestrator"],
  };

  it("1 — a validated custom-actions project HIDES the Mission tab", () => {
    const d = detectScenario(inputs({ actions: customActions }));
    expect(d.scenario).toBe("custom_actions");
    expect(d.missionTabVisible).toBe(false);
  });

  it("1 beats 2 — a STALE pointer does NOT resurrect Mission there (AC4)", () => {
    const d = detectScenario(inputs({ actions: customActions, pointer: okPointer }));
    expect(d.scenario).toBe("custom_actions");
    expect(d.missionTabVisible).toBe(false);
    expect(d.runId).toBeNull();
  });

  it("2 — a validated pointer resolves as an iterate and carries its run_id", () => {
    const d = detectScenario(inputs({ pointer: okPointer }));
    expect(d.scenario).toBe("iterate");
    expect(d.runId).toBe("iterate-2026-07-18-demo");
  });

  it("2 outranks 3 — an iterate pointer wins over phase-task linkage", () => {
    const d = detectScenario(
      inputs({ pointer: okPointer, phaseTaskId: "ptk-1", taskRunId: "run-abc12345" }),
    );
    expect(d.scenario).toBe("iterate");
  });

  it("3 — pipeline needs BOTH phaseTaskId and runId", () => {
    expect(detectScenario(inputs({ phaseTaskId: "ptk-1", taskRunId: "run-abc12345" })).scenario).toBe(
      "pipeline",
    );
    expect(detectScenario(inputs({ phaseTaskId: "ptk-1" })).scenario).toBe("plain");
  });

  it("4 — a `campaign:` title WITHOUT a record is not a campaign (AC4)", () => {
    expect(detectScenario(inputs({ campaignSlug: "some-slug" })).scenario).toBe("plain");
    expect(
      detectScenario(inputs({ campaignSlug: "some-slug", hasCampaignRecord: true })).scenario,
    ).toBe("campaign");
  });

  it("5 — a bare session is plain, with the tab visible", () => {
    const d = detectScenario(inputs());
    expect(d.scenario).toBe("plain");
    expect(d.missionTabVisible).toBe(true);
  });

  it("an INVALID pointer does not make an iterate, but is remembered for `unavailable`", () => {
    const d = detectScenario(inputs({ pointer: { status: "invalid", reason: "session_mismatch" } }));
    expect(d.scenario).toBe("plain");
    expect(d.runId).toBeNull();
    expect(d.pointerInvalidReason).toBe("session_mismatch");
  });

  it("an invalid pointer still lets pipeline/campaign win their own slots", () => {
    const d = detectScenario(
      inputs({
        pointer: { status: "invalid", reason: "main_root_mismatch" },
        phaseTaskId: "ptk-9",
        taskRunId: "run-deadbeef",
      }),
    );
    expect(d.scenario).toBe("pipeline");
    expect(d.pointerInvalidReason).toBe("main_root_mismatch");
  });
});

/*
 * External plan review (openai #2, 2026-07-18) — HIGH.
 *
 * The pointer is PRUNED once the worktree is gone, so after Finalize it can
 * never identify the run again. Without an association fallback the resolver
 * answers `plain` for every finished iterate — reintroducing exactly the data
 * loss the association exists to close, and breaking AC2.
 */
describe("association fallback after the pointer is pruned", () => {
  const association = {
    kind: "iterate" as const,
    runId: "iterate-2026-07-18-demo",
    observedAt: "2026-07-18T10:00:00.000Z",
    source: "iterate_active_pointer" as const,
  };

  it("resolves as an ITERATE when the pointer is gone but the run was observed", () => {
    const d = detectScenario(inputs({ pointer: { status: "absent" }, association }));
    expect(d.scenario).toBe("iterate");
    expect(d.runId).toBe("iterate-2026-07-18-demo");
  });

  it("prefers a LIVE pointer over the stored association (fresher, has the worktree)", () => {
    const d = detectScenario(inputs({ pointer: okPointer, association }));
    expect(d.scenario).toBe("iterate");
    expect(d.runId).toBe("iterate-2026-07-18-demo");
  });

  it("still HIDES the tab for a validated custom-actions project (precedence 1 holds)", () => {
    const d = detectScenario(
      inputs({
        pointer: { status: "absent" },
        association,
        actions: { fromUser: true, hasDiagnostics: false, actionIds: ["publish-post"] },
      }),
    );
    expect(d.scenario).toBe("custom_actions");
    expect(d.missionTabVisible).toBe(false);
  });

  it("outranks pipeline/campaign — a task that ran an iterate IS an iterate", () => {
    const d = detectScenario(
      inputs({
        pointer: { status: "absent" },
        association,
        phaseTaskId: "ptk-1",
        taskRunId: "run-abc12345",
      }),
    );
    expect(d.scenario).toBe("iterate");
  });

  it("does NOT rescue an INVALID pointer — a failed validation must stay visible", () => {
    const d = detectScenario(
      inputs({ pointer: { status: "invalid", reason: "session_mismatch" }, association }),
    );
    expect(d.scenario).toBe("plain");
    expect(d.pointerInvalidReason).toBe("session_mismatch");
  });

  it("is plain when neither a pointer nor an association exists (never fabricated)", () => {
    const d = detectScenario(inputs({ pointer: { status: "absent" }, association: null }));
    expect(d.scenario).toBe("plain");
    expect(d.runId).toBeNull();
  });
});

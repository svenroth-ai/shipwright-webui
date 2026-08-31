/*
 * scenario.supersession.test.ts — rule 2b superseding a STALE association
 * with a fresher, corroborated transcript recovery (iterate-2026-08-31-
 * mission-feed-gaps).
 *
 * Split out of scenario.test.ts (which was already at 300+ LOC) to stay
 * under the file-size convention — same pattern recovery-schedule.test.ts
 * already uses for the same reason.
 *
 * Root cause this pins: the association is only ever refreshed by catching a
 * LIVE pointer (rule 2), a window that only exists while a worktree is up. A
 * task whose Mission tab is never open during that window keeps whatever
 * association it last caught FOREVER — even after several more iterates
 * finish (production evidence: a `new-plain` task with one caught
 * association from weeks earlier and 9+ completed PRs since, none reflected
 * in the Mission tab). `recoverTranscriptRunId` is corroborated against the
 * project's OWN completed-run records (run-id-recovery.ts) — the same
 * evidence rule 5 already trusts enough to identify a run with NO
 * association at all — so a recovered value that DIFFERS from the stored
 * association is proof of a newer finished run, not "quoted text" the old
 * rule-5-only design dismissed it as.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { detectScenario, type ScenarioInputs } from "./scenario.js";

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

const staleAssociation = {
  kind: "iterate" as const,
  runId: "iterate-2026-08-13-changelog-manifest-config",
  observedAt: "2026-08-13T12:47:59.854Z",
  source: "iterate_active_pointer" as const,
};

describe("rule 2b — transcript recovery supersedes a stale association", () => {
  it("SUPERSEDES the association when the transcript corroborates a DIFFERENT, newer run", () => {
    const d = detectScenario(
      inputs({
        association: staleAssociation,
        recoverTranscriptRunId: () => "iterate-2026-08-27-readiness-gate-fixes",
      }),
    );
    expect(d.scenario).toBe("iterate");
    expect(d.runId).toBe("iterate-2026-08-27-readiness-gate-fixes");
    expect(d.runIdSource).toBe("transcript");
  });

  it("keeps the association when the transcript confirms the SAME run (no supersession, no churn)", () => {
    const d = detectScenario(
      inputs({
        association: staleAssociation,
        recoverTranscriptRunId: () => staleAssociation.runId,
      }),
    );
    expect(d.runId).toBe(staleAssociation.runId);
    expect(d.runIdSource).toBe("association");
  });

  it("keeps the association when recovery finds nothing this poll (transcript unread / no marker)", () => {
    const d = detectScenario(
      inputs({ association: staleAssociation, recoverTranscriptRunId: () => null }),
    );
    expect(d.runId).toBe(staleAssociation.runId);
    expect(d.runIdSource).toBe("association");
  });

  it("keeps the association when no recovery thunk is wired at all (defensive default)", () => {
    const d = detectScenario(inputs({ association: staleAssociation }));
    expect(d.runId).toBe(staleAssociation.runId);
    expect(d.runIdSource).toBe("association");
  });

  it("does NOT supersede with an OLDER run, even a different, corroborated one (external code review, openai MEDIUM)", () => {
    // The disclosed limitation this pins: a turn that merely NARRATES an
    // older run's footer in prose can survive stripUserTypeLines and be
    // picked as "last" — without a recency check that would downgrade a
    // correct, server-observed association to that older run.
    const d = detectScenario(
      inputs({
        association: staleAssociation,
        recoverTranscriptRunId: () => "iterate-2026-07-01-earlier-run",
      }),
    );
    expect(d.runId).toBe(staleAssociation.runId);
    expect(d.runIdSource).toBe("association");
  });

  it("does NOT supersede with a SAME-DAY run — a tie is not proof of order", () => {
    const d = detectScenario(
      inputs({
        association: staleAssociation,
        recoverTranscriptRunId: () => "iterate-2026-08-13-a-same-day-run",
      }),
    );
    expect(d.runId).toBe(staleAssociation.runId);
    expect(d.runIdSource).toBe("association");
  });
});

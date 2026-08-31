/*
 * recovery-schedule.test.ts — WHEN the transcript recovery is paid, and what the
 * ordered table reports about WHO identified the run
 * (iterate-2026-07-21-mission-recovery-memo-perf).
 *
 * The defect these pin (internal code review of PR #309, PERF): the scan ran
 * BEFORE `detectScenario`, and the memo is written only when NO candidate is
 * found. So a campaign- or pipeline-resolved session whose transcript quotes a
 * CORROBORATED footer never reached rule 5, never persisted, and therefore
 * re-ran the regex and the record lookup on every poll, forever — making the
 * prior ADR's "paid once per task, not once per poll" false for that class.
 *
 * The fix is to defer, not to memoize harder: the footer is consulted at the
 * point the ordered table actually uses it. These tests observe the REAL scan
 * counter, because asserting the same answer twice passes whether or not any
 * work was skipped.
 *
 * Kept in its own file rather than grown into `scenario.test.ts` (294 LOC) or
 * `run-id-recovery.test.ts` (292 LOC) — both are one edit from the size rule.
 *
 * Extended 2026-08-31: rule 2b now ALSO consults the thunk to check for a
 * supersession, throttled by `resolveMissionContext` via a transcript-content
 * memo (resolver-parts.ts) — table-level cases in scenario.supersession.test.ts.
 *
 * Part B (end-to-end `resolveMissionContext` coverage against the real scan
 * counter) split out to recovery-schedule.resolver.test.ts (2026-08-31) —
 * this file was one line from the 300-line limit and the split runs the
 * exact precedent this comment already describes.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { detectScenario, type ScenarioInputs } from "./scenario.js";
import type { ReadPointerResult } from "./pointer.js";

const UUID = "3c9e3e11-4b53-424e-8062-f9f5a24f6b68";
const RUN_ID = "iterate-2026-07-20-recovered";

// ---------------------------------------------------------------------------
// Part A — the ordered table pays for the footer only when it reaches rule 5.
// ---------------------------------------------------------------------------

const okPointer: ReadPointerResult = {
  status: "ok",
  pointer: {
    runId: "iterate-2026-07-18-demo",
    slug: "demo",
    branch: "iterate/demo",
    worktreePath: null,
    mainRoot: "/p",
    sessionId: UUID,
    createdAt: null,
  },
};

const association = {
  kind: "iterate" as const,
  runId: "iterate-2026-07-18-demo",
  observedAt: "2026-07-18T10:00:00.000Z",
  source: "iterate_active_pointer" as const,
};

/** A thunk that records how often the table asked for the footer. */
function counting(runId: string | null = RUN_ID) {
  const calls = { n: 0 };
  return {
    calls,
    recoverTranscriptRunId: () => {
      calls.n++;
      return runId;
    },
  };
}

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

describe("detectScenario — the footer is consulted lazily", () => {
  const customActions = {
    fromUser: true,
    hasDiagnostics: false,
    actionIds: ["publish-post"],
  };

  it.each([
    ["1 custom_actions", { actions: customActions }, "custom_actions"],
    ["2 a live pointer", { pointer: okPointer }, "iterate"],
    ["3 pipeline", { phaseTaskId: "ptk-1", taskRunId: "run-abc12345" }, "pipeline"],
    [
      "4 campaign",
      { campaignSlug: "2026-07-18-mission-artifacts", hasCampaignRecord: true },
      "campaign",
    ],
  ])("is NOT paid when rule %s matches first", (_name, over, scenario) => {
    const { calls, recoverTranscriptRunId } = counting();
    const d = detectScenario(inputs({ ...(over as Partial<ScenarioInputs>), recoverTranscriptRunId }));
    expect(d.scenario).toBe(scenario);
    expect(calls.n).toBe(0);
  });

  // 2b now DOES consult the thunk (iterate-2026-08-31-mission-feed-gaps) — to
  // check whether a fresher, corroborated run supersedes the stored
  // association — moved out of the table above since its expectation
  // (paid, not skipped) differs from every other row. The resolver, not this
  // table, is what keeps that consultation from being an every-poll cost —
  // see the `resolveMissionContext` describe block below.
  it("2b DOES consult the thunk — checking whether it supersedes the stored association", () => {
    const { calls, recoverTranscriptRunId } = counting();
    const d = detectScenario(inputs({ association, recoverTranscriptRunId }));
    expect(d.scenario).toBe("iterate");
    expect(calls.n).toBe(1);
  });

  it("is paid EXACTLY ONCE when rules 1-4 all miss", () => {
    const { calls, recoverTranscriptRunId } = counting();
    const d = detectScenario(inputs({ recoverTranscriptRunId }));
    expect(d.scenario).toBe("iterate");
    expect(d.runId).toBe(RUN_ID);
    // The count, not just the answer. This is the ONLY thing standing between a
    // future rule that consults the footer twice and a silent return of the
    // per-poll cost — the resolver deliberately carries no memo guard, because a
    // guard would absorb that mistake instead of reporting it.
    expect(calls.n).toBe(1);
  });

  it("is NOT paid for an INVALID pointer — that asymmetry is deliberate", () => {
    const { calls, recoverTranscriptRunId } = counting();
    const d = detectScenario(
      inputs({ pointer: { status: "invalid", reason: "bad_run_id" }, recoverTranscriptRunId }),
    );
    expect(d.scenario).toBe("plain");
    expect(calls.n).toBe(0);
  });

  it("reports WHICH source identified the run, per ordered rule", () => {
    const { recoverTranscriptRunId } = counting();
    const src = (over: Partial<ScenarioInputs>) =>
      detectScenario(inputs({ ...over, recoverTranscriptRunId })).runIdSource;

    expect(src({ actions: customActions })).toBeNull();
    expect(src({ pointer: okPointer })).toBe("pointer");
    // The default thunk recovers a DIFFERENT run than `association`, so this
    // is now a supersession, not a plain association read — see
    // scenario.supersession.test.ts for the "same run → association" case.
    expect(src({ association })).toBe("transcript");
    expect(src({ phaseTaskId: "ptk-1", taskRunId: "run-abc12345" })).toBeNull();
    expect(src({ campaignSlug: "c", hasCampaignRecord: true })).toBeNull();
    expect(src({})).toBe("transcript");
    expect(detectScenario(inputs()).runIdSource).toBeNull(); // 6 plain, no thunk at all
  });
});

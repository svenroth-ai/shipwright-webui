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
 * @covers FR-01.66
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectScenario, type ScenarioInputs } from "./scenario.js";
import { _clearEventIndexCache } from "./iterate-record.js";
import { _clearRecoveryMemo, _recoveryScanCount } from "./run-id-recovery.js";
import { _clearResolverCache, resolveMissionContext } from "./resolver.js";
import { _clearRootsCache } from "./worktree-roots.js";
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
    ["2b the stored association", { association }, "iterate"],
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
    expect(src({ association })).toBe("association");
    expect(src({ phaseTaskId: "ptk-1", taskRunId: "run-abc12345" })).toBeNull();
    expect(src({ campaignSlug: "c", hasCampaignRecord: true })).toBeNull();
    expect(src({})).toBe("transcript");
    expect(detectScenario(inputs()).runIdSource).toBeNull(); // 6 plain, no thunk at all
  });
});

// ---------------------------------------------------------------------------
// Part B — end-to-end through the resolver, against the REAL scan counter.
// ---------------------------------------------------------------------------

/** The F6 footer exactly as it appears inside a JSONL record. */
const FOOTER = `{"text":"feat: x\\n\\nRun-ID: ${RUN_ID}\\nCo-Authored-By: Claude <n@a.com>"}`;

let roots: string[] = [];

/** A project whose OWN records corroborate `RUN_ID` — no pointer, no worktree. */
function corroboratingProject(): string {
  const root = mkdtempSync(join(tmpdir(), "mc-sched-"));
  roots.push(root);
  mkdirSync(join(root, ".shipwright", "iterate_active"), { recursive: true });
  writeFileSync(
    join(root, "shipwright_events.jsonl"),
    `${JSON.stringify({
      v: 1,
      type: "work_completed",
      id: RUN_ID,
      adr_id: RUN_ID,
      ts: "2026-07-20T10:00:00Z",
      summary: "Did the thing",
      commit: "a".repeat(40),
    })}\n`,
    "utf-8",
  );
  return root;
}

function resolve(projectRoot: string, over: Record<string, unknown> = {}) {
  return resolveMissionContext({
    taskId: "task-1",
    sessionUuid: UUID,
    projectId: "proj-1",
    projectRoot,
    transcript: FOOTER,
    phaseTaskId: null,
    taskRunId: null,
    campaignSlug: null,
    hasCampaignRecord: false,
    actions: null,
    runConfigStatus: "ok",
    ...over,
  });
}

describe("resolveMissionContext — the scan is paid once per task, not per poll", () => {
  beforeEach(() => {
    _clearResolverCache();
    _clearEventIndexCache();
    _clearRootsCache();
    _clearRecoveryMemo();
  });
  afterEach(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
    roots = [];
  });

  it("a CAMPAIGN session quoting a corroborated footer never scans at all", async () => {
    const root = corroboratingProject();
    const campaign = { campaignSlug: "2026-07-18-mission-artifacts", hasCampaignRecord: true };

    for (let poll = 0; poll < 3; poll++) {
      const r = await resolve(root, campaign);
      // The footer is real and corroborated — it just is not what identifies
      // THIS session, so it must never be looked for.
      expect(r.context.scenario).toBe("campaign");
      expect(r.associateRunId).toBeNull();
    }
    expect(_recoveryScanCount()).toBe(0);
  });

  it("a PIPELINE session quoting a corroborated footer never scans at all", async () => {
    const root = corroboratingProject();
    for (let poll = 0; poll < 3; poll++) {
      const r = await resolve(root, { phaseTaskId: "ptk-1", taskRunId: "run-abc12345" });
      expect(r.context.scenario).toBe("pipeline");
    }
    expect(_recoveryScanCount()).toBe(0);
  });

  it("an already-ASSOCIATED task never scans", async () => {
    const root = corroboratingProject();
    const r = await resolve(root, {
      association: { ...association, runId: RUN_ID, source: "transcript_run_id" },
    });
    expect(r.context.runId).toBe(RUN_ID);
    // Already identified, so nothing to recover — and nothing to re-persist.
    expect(r.associateRunId).toBeNull();
    expect(_recoveryScanCount()).toBe(0);
  });

  it("an unidentified session scans ONCE and reports the footer as the source", async () => {
    const root = corroboratingProject();
    const r = await resolve(root);
    expect(r.context.scenario).toBe("iterate");
    expect(r.context.runId).toBe(RUN_ID);
    expect(r.associateRunId).toBe(RUN_ID);
    expect(r.associateSource).toBe("transcript_run_id");
    // ONE scan for the whole resolve. There is no memo guard in the resolver;
    // this count and the table-level one above are what hold that line.
    expect(_recoveryScanCount()).toBe(1);
  });
});

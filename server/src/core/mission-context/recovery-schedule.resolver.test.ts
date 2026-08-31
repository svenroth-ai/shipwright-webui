/*
 * recovery-schedule.resolver.test.ts — Part B of recovery-schedule.test.ts,
 * split out 2026-08-31 to stay under the 300-line file-size limit (the same
 * reason recovery-schedule.test.ts was itself split out of scenario.test.ts).
 *
 * End-to-end coverage of `resolveMissionContext`, against the REAL scan
 * counter (`_recoveryScanCount`), proving the footer scan is paid once per
 * task — not once per poll — even after rule 2b started consulting the
 * thunk for supersession checks (iterate-2026-08-31-mission-feed-gaps).
 * Part A (the ordered-table-level "is the thunk consulted" cases) stays in
 * recovery-schedule.test.ts.
 *
 * @covers FR-01.66
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _clearEventIndexCache } from "./iterate-record.js";
import { _clearRecoveryMemo, _recoveryScanCount } from "./run-id-recovery.js";
import { _clearResolverCache, _clearSupersessionMemo, resolveMissionContext } from "./resolver.js";
import { _clearRootsCache } from "./worktree-roots.js";

const UUID = "3c9e3e11-4b53-424e-8062-f9f5a24f6b68";
const RUN_ID = "iterate-2026-07-20-recovered";

const association = {
  kind: "iterate" as const,
  runId: "iterate-2026-07-18-demo",
  observedAt: "2026-07-18T10:00:00.000Z",
  source: "iterate_active_pointer" as const,
};

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
    _clearSupersessionMemo();
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

  it("an already-ASSOCIATED task checks freshness ONCE per poll cycle, not forever (iterate-2026-08-31-mission-feed-gaps)", async () => {
    const root = corroboratingProject();
    const assoc = { ...association, runId: RUN_ID, source: "transcript_run_id" as const };

    // First poll: the association already matches what the transcript
    // corroborates, so it checks freshness (one scan) and finds nothing to
    // change.
    const r1 = await resolve(root, { association: assoc });
    expect(r1.context.runId).toBe(RUN_ID);
    expect(r1.associateRunId).toBeNull(); // already known — nothing to re-persist
    expect(_recoveryScanCount()).toBe(1);

    // Second poll, SAME transcript content: the content-fingerprinted memo
    // skips the scan entirely — this is what keeps a stable association from
    // re-paying the cost every ~1s poll forever.
    const r2 = await resolve(root, { association: assoc });
    expect(r2.context.runId).toBe(RUN_ID);
    expect(_recoveryScanCount()).toBe(1);
  });

  it("a STALE association is SUPERSEDED once the transcript corroborates a newer run", async () => {
    const root = corroboratingProject();
    const staleAssociation = {
      kind: "iterate" as const,
      runId: "iterate-2026-07-01-older-run",
      observedAt: "2026-07-01T10:00:00.000Z",
      source: "iterate_active_pointer" as const,
    };

    const r = await resolve(root, { association: staleAssociation });
    expect(r.context.scenario).toBe("iterate");
    // The transcript corroborates RUN_ID, which differs from the stale
    // association, so it supersedes — and the resolver reports a fresh
    // association to persist.
    expect(r.context.runId).toBe(RUN_ID);
    expect(r.associateRunId).toBe(RUN_ID);
    expect(r.associateSource).toBe("transcript_run_id");
    expect(_recoveryScanCount()).toBe(1);
  });

  it("a SECOND poll with the SAME stale association still reports the superseding run, not a reverted fallback (external code review, openai HIGH)", async () => {
    const root = corroboratingProject();
    const staleAssociation = {
      kind: "iterate" as const,
      runId: "iterate-2026-07-01-older-run",
      observedAt: "2026-07-01T10:00:00.000Z",
      source: "iterate_active_pointer" as const,
    };

    // Poll 1 finds the supersession and reports the fresh association to
    // persist — but the CALLER (the route) persists it, not this resolve, so
    // a second poll can genuinely land again with the exact same stale
    // `association` before that write completes (or if it fails outright).
    const r1 = await resolve(root, { association: staleAssociation });
    expect(r1.context.runId).toBe(RUN_ID);
    expect(r1.associateRunId).toBe(RUN_ID);

    // Poll 2: SAME stale association, SAME transcript content. The memo must
    // replay the ALREADY-FOUND result, not a bare `null` that would make rule
    // 2b fall back to the stale association it just superseded.
    const r2 = await resolve(root, { association: staleAssociation });
    expect(r2.context.runId).toBe(RUN_ID);
    expect(r2.context.scenario).toBe("iterate");
    expect(r2.associateRunId).toBe(RUN_ID);
    expect(r2.associateSource).toBe("transcript_run_id");
    // Still ONE scan — the memo replays its cached result, it does not re-scan.
    expect(_recoveryScanCount()).toBe(1);
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

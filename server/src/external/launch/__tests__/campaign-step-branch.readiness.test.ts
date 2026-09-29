/*
 * The scheduler-readiness guard on the single-sub-iterate launch branch
 * (card trg-e542ce03). A hand-launch of a unit the monorepo scheduler reports
 * BLOCKED is refused (409); when no verdict can be had the launch proceeds
 * fail-OPEN but the result says so (`readinessChecked:false`); "no loop
 * running" is not a failure and carries no notice.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  applyCampaignStepBranch,
  STEP_READINESS_MAX_AGE_MS,
  STEP_READINESS_MAX_WAIT_MS,
} from "../campaign-step-branch.js";
import type { ReadinessOutcome } from "../../../core/campaign-readiness.js";
import type { ReadinessReport } from "../../../core/campaign-readiness-schema.js";

const SLUG = "2026-09-29-dag";
const CAMPAIGN_MD = `---
campaign: ${SLUG}
status: active
---

# Campaign: ${SLUG}

## Intent

x

## Sub-Iterates

| ID | Slug | Title | Depends on | Status |
|---|---|---|---|---|
| A | first | First | | pending |
| B | second | Second | A | pending |
`;

function report(units: ReadinessReport["units"]): ReadinessOutcome {
  return {
    status: "report",
    report: {
      schema_version: "1.0", loop_id: "L", branch_strategy: "independent", base_branch: "main",
      supported: true, finalized: false, ready_ids: units.filter((u) => u.ready).map((u) => u.id), units,
    },
  };
}

describe("applyCampaignStepBranch — scheduler readiness guard", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "step-readiness-"));
    const dir = path.join(projectRoot, ".shipwright", "planning", "iterate", "campaigns", SLUG);
    mkdirSync(path.join(dir, "sub-iterates"), { recursive: true });
    writeFileSync(path.join(dir, "campaign.md"), CAMPAIGN_MD, "utf-8");
    for (const [id, s] of [["A", "first"], ["B", "second"]]) {
      writeFileSync(path.join(dir, "sub-iterates", `${id}-${s}.md`), `# ${id}\n`, "utf-8");
    }
  });
  afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

  async function launch(stepId: string, verdict: ReadinessOutcome | "timeout" | (() => never), seen?: unknown[]) {
    return applyCampaignStepBranch({
      task: { taskId: "t1", projectId: "p1", sessionUuid: "11111111-1111-4111-8111-111111111111", cwd: projectRoot, pluginDirs: [], title: "T" } as never,
      parsed: { campaignStep: { slug: SLUG, stepId } } as never,
      effectivelyFreshStart: true,
      getProjectById: () => ({ id: "p1", path: projectRoot }) as never,
      getReadinessFn: (async (...args: unknown[]) => {
        seen?.push(args);
        if (typeof verdict === "function") verdict();
        return verdict;
      }) as never,
    });
  }

  const blockedB = { id: "B", state: "pending", ready: false, blocked_by: [{ id: "A", reason: "not_merged", detail: "A has status 'pending'" }] };
  const readyA = { id: "A", state: "pending", ready: true, blocked_by: [] };

  it("REFUSES a unit the scheduler reports blocked (409, with the blockers)", async () => {
    const res = await launch("B", report([readyA, blockedB]));
    expect(res).toEqual({
      error: { error: "campaign_step_not_ready", detail: "B", blocked_by: blockedB.blocked_by },
      status: 409,
    });
  });

  it("launches a unit the scheduler reports ready — no unchecked notice", async () => {
    const res = await launch("A", report([readyA, blockedB]));
    expect(res).toMatchObject({ commands: expect.anything() });
    expect(res).not.toHaveProperty("readinessChecked");
  });

  it("asks the scheduler bridge with the bounded cache/wait budget", async () => {
    const seen: unknown[][] = [];
    await launch("A", report([readyA]), seen as unknown[]);
    expect(seen[0][0]).toEqual({ projectRoot: expect.any(String), slug: SLUG });
    expect(seen[0][2]).toEqual({ maxAgeMs: STEP_READINESS_MAX_AGE_MS, maxWaitMs: STEP_READINESS_MAX_WAIT_MS });
    expect(STEP_READINESS_MAX_AGE_MS).toBe(15_000);
    expect(STEP_READINESS_MAX_WAIT_MS).toBe(10_000);
  });

  it("no loop running → launches, and that is NOT flagged unchecked", async () => {
    const res = await launch("B", { status: "no-loop" });
    expect(res).toMatchObject({ commands: expect.anything() });
    expect(res).not.toHaveProperty("readinessChecked");
  });

  it.each<[string, ReadinessOutcome | "timeout"]>([
    ["timeout", "timeout"],
    ["engine unavailable", { status: "engine-unavailable", reason: "no uv", repairCommand: "x" }],
    ["failed", { status: "failed", reason: "boom" }],
    ["unsupported version", { status: "unsupported-version", version: "2.0" }],
  ])("FAILS OPEN but loudly when the verdict is unavailable (%s)", async (_n, verdict) => {
    const res = await launch("B", verdict);
    expect(res).toMatchObject({ commands: expect.anything(), readinessChecked: false });
  });

  it("a campaign-level gate (blocker id:null) does NOT refuse a hand-launch — launched, flagged unchecked", async () => {
    const gated = { id: "B", state: "pending", ready: false, blocked_by: [{ id: null, reason: "unsupported_strategy", detail: "x" }] };
    const res = await launch("B", report([gated]));
    expect(res).toMatchObject({ commands: expect.anything(), readinessChecked: false });
  });

  it("re-checks UNCACHED before refusing: a cached 'waiting' that is now ready launches", async () => {
    const calls: Array<{ maxAgeMs?: number }> = [];
    const res = await applyCampaignStepBranch({
      task: { taskId: "t1", projectId: "p1", sessionUuid: "11111111-1111-4111-8111-111111111111", cwd: projectRoot, pluginDirs: [], title: "T" } as never,
      parsed: { campaignStep: { slug: SLUG, stepId: "B" } } as never,
      effectivelyFreshStart: true,
      getProjectById: () => ({ id: "p1", path: projectRoot }) as never,
      getReadinessFn: (async (_i: unknown, _d: unknown, opts: { maxAgeMs?: number }) => {
        calls.push(opts);
        return report(calls.length === 1 ? [readyA, blockedB] : [readyA, { ...blockedB, ready: true, blocked_by: [] }]);
      }) as never,
    });
    expect(res).toMatchObject({ commands: expect.anything() });
    expect(res).not.toHaveProperty("readinessChecked");
    expect(calls[1].maxAgeMs).toBe(0);
  });

  it("a THROWING readiness check fails open, flagged unchecked (never a 500)", async () => {
    const res = await launch("B", () => {
      throw new Error("spawn exploded");
    });
    expect(res).toMatchObject({ commands: expect.anything(), readinessChecked: false });
  });

  it("a unit absent from the report is launched but flagged unchecked", async () => {
    const res = await launch("B", report([readyA]));
    expect(res).toMatchObject({ commands: expect.anything(), readinessChecked: false });
  });

  it("only a PENDING unit can be refused — a non-pending unit (e.g. a failed retry) is not the scheduler's to block", async () => {
    const res = await launch("B", report([readyA, { id: "B", state: "failed", ready: false, blocked_by: [] }]));
    expect(res).toMatchObject({ commands: expect.anything() });
    expect(res).not.toHaveProperty("readinessChecked");
  });

  it("matches the step id case-insensitively (the scheduler's own lookup folds case)", async () => {
    const res = await launch("B", report([readyA, { ...blockedB, id: "b" }]));
    expect(res).toMatchObject({ status: 409 });
  });
});

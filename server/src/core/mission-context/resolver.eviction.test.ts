/*
 * resolver.eviction.test.ts — the Mission artifacts must survive the
 * `iterates/<run_id>.json` retention window (trg-92c0c36b).
 *
 * `append_iterate_entry` keeps a bounded 50-entry recency window, so a consumer
 * that reads only that directory silently caps at the 50 newest runs. Full
 * history lives in the append-only `shipwright_events.jsonl` (`work_completed`,
 * never evicted). MEASURED ON THIS REPO 2026-07-21: 214 iterate runs in the
 * event log vs 54 surviving agent-docs — 75% already evicted.
 *
 * Every case below therefore runs the resolver with **no agent-doc at all**,
 * which is the steady state for the overwhelming majority of real runs:
 *
 *   1. Requirement still resolves its FRs from the event log. This is the
 *      behaviour the triage item asked for; it already held, and was UNPINNED —
 *      a refactor that made the agent-doc primary again would have been caught
 *      by nothing. Now it is pinned.
 *   2. Spec still resolves for a campaign sub-iterate, rebuilt from the event's
 *      `campaign` + `sub_iterate_id`. This one did NOT hold before: the path
 *      came only from the agent-doc's `spec` hint, so it died with the doc.
 *
 * @covers FR-01.66
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { _clearEventIndexCache, EVENTS_FILE } from "./iterate-record.js";
import { _clearResolverCache, resolveMissionContext } from "./resolver.js";
import type { MissionContextAssociation } from "./types.js";

const RUN_ID = "iterate-2026-07-09-w1-mode-aware-config";
const CAMPAIGN = "webui-pipeline-convergence";
const SPEC_FILE = "W1-mode-aware-config.md";

/**
 * A project whose agent-doc for RUN_ID is ABSENT — i.e. evicted — while the
 * event log still carries the run. No `iterates/` directory is created at all.
 */
function evictedProject(event: Record<string, unknown>, withCampaignSpec: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "mc-evicted-"));
  writeFileSync(join(root, EVENTS_FILE), JSON.stringify(event) + "\n");
  if (withCampaignSpec) {
    const dir = join(root, ".shipwright", "planning", "iterate", "campaigns", CAMPAIGN, "sub-iterates");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SPEC_FILE), "# W1 — mode-aware config\n\nThe plan for this run.\n");
  }
  return root;
}

const ASSOCIATION: MissionContextAssociation = {
  kind: "iterate",
  runId: RUN_ID,
  observedAt: "2026-07-09T10:00:00.000Z",
  source: "iterate_active_pointer",
};

function resolve(projectRoot: string) {
  return resolveMissionContext(
    {
      taskId: "task-1",
      sessionUuid: "11111111-2222-4333-8444-555555555555",
      projectId: "proj-1",
      projectRoot,
      transcript: "",
      phaseTaskId: null,
      taskRunId: null,
      campaignSlug: null,
      hasCampaignRecord: false,
      actions: null,
      runConfigStatus: "ok",
      association: ASSOCIATION,
    },
    // No worktrees: the roots probe degrades to the project root alone, which
    // is what a post-Finalize run (worktree already removed) looks like anyway.
    { git: () => "" },
  );
}

const BASE_EVENT = {
  id: "evt-1",
  type: "work_completed",
  ts: "2026-07-09T12:00:00Z",
  adr_id: RUN_ID,
  source: "iterate",
  commit: "abc1234",
  campaign: CAMPAIGN,
  sub_iterate_id: "W1",
};

describe("Mission artifacts survive the iterates/ retention window", () => {
  beforeEach(() => {
    _clearResolverCache();
    _clearEventIndexCache();
  });

  it("resolves the Requirement's FRs from the event log with NO agent-doc present", async () => {
    const root = evictedProject(
      { ...BASE_EVENT, affected_frs: ["FR-01.28"], spec_impact: "modify" },
      false,
    );
    try {
      const { context } = await resolve(root);
      expect(context.scenario).toBe("iterate");
      expect(context.runId).toBe(RUN_ID);

      const requirement = context.artifacts.find((a) => a.kind === "requirement");
      expect(requirement?.state).toBe("available");
      expect(requirement?.receipt).toContain("FR-01.28");
      // Not merely "some FR" — the one the EVENT recorded, since no other
      // source for it exists in this fixture.
      expect(context.servesFrId).toBe("FR-01.28");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves a campaign sub-iterate's Spec from the event log with NO agent-doc present", async () => {
    const root = evictedProject(BASE_EVENT, true);
    try {
      const { context } = await resolve(root);
      const spec = context.artifacts.find((a) => a.kind === "spec");
      expect(spec?.state).toBe("available");
      // The document is titled by the candidate that actually matched — proof
      // the campaign path (not a known-layout guess) is what resolved.
      expect(spec?.detail).toBeTruthy();
      expect(JSON.stringify(spec)).toContain(SPEC_FILE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT invent a Spec when the campaign document is genuinely gone", async () => {
    const root = evictedProject(BASE_EVENT, false);
    try {
      const { context } = await resolve(root);
      const spec = context.artifacts.find((a) => a.kind === "spec");
      // Honest absence, not a fabricated pointer to a file that is not there.
      expect(spec?.state).not.toBe("available");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores campaign fields that fail the id grammar (no traversal via the log)", async () => {
    const root = evictedProject(
      { ...BASE_EVENT, campaign: "../../../etc", sub_iterate_id: "../W1" },
      true,
    );
    try {
      const { context } = await resolve(root);
      const spec = context.artifacts.find((a) => a.kind === "spec");
      expect(spec?.state).not.toBe("available");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/*
 * resolver.tests-gate.test.ts — `resolveMissionContext`'s OWN construction of
 * `MissionContext.tests` (iterate-2026-08-08-tests-total-skip-contract).
 *
 * `resolver.ts` is a THIRD server-side site that builds the `{passed, total,
 * skipped, gate}` shape (alongside `run-data-join.ts` and
 * `mission-context/artifacts-tests.ts`) — found via `tsc --noEmit` during
 * Build, not anticipated by the mini-plan. It had NO test coverage of its own
 * `tests`/`gate` construction before this file: every existing resolver test
 * exercises Requirement/Spec, never `context.tests`. This pins the exact
 * discriminating shape the whole run exists to fix: a post-reversal
 * host-gated skip (`passed !== total` numerically) must still resolve to
 * `gate: "pass"`, and the pre-reversal reading of the SAME numbers must stay
 * `"fail"` — the event's own `ts` disambiguates, never a coincidence of the
 * numbers alone.
 *
 * @covers FR-01.66
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { _clearEventIndexCache, EVENTS_FILE } from "./iterate-record.js";
import { _clearResolverCache, resolveMissionContext } from "./resolver.js";
import type { MissionContextAssociation } from "./types.js";

const RUN_ID = "iterate-2026-08-08-resolver-gate-fixture";

function projectWithEvent(event: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "mc-resolver-gate-"));
  writeFileSync(join(root, EVENTS_FILE), JSON.stringify(event) + "\n");
  return root;
}

const ASSOCIATION: MissionContextAssociation = {
  kind: "iterate",
  runId: RUN_ID,
  observedAt: "2026-08-08T10:00:00.000Z",
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
    { git: () => "" },
  );
}

const BASE_EVENT = {
  id: "evt-1",
  type: "work_completed",
  adr_id: RUN_ID,
  source: "iterate",
  commit: "abc1234",
};

describe("resolveMissionContext — context.tests is gate-resolved, not raw-compared", () => {
  beforeEach(() => {
    _clearResolverCache();
    _clearEventIndexCache();
  });

  it("post-reversal host-gated skip resolves to gate:'pass' even though passed !== total (discriminating case)", async () => {
    const root = projectWithEvent({
      ...BASE_EVENT,
      ts: "2026-08-08T12:00:00Z",
      tests: { passed: 9, total: 10, skipped: 1 },
    });
    try {
      const { context } = await resolve(root);
      expect(context.tests).toEqual({ passed: 9, total: 10, skipped: 1, gate: "pass" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the SAME numbers read gate:'fail' pre-reversal — the epoch, not the numbers, disambiguates", async () => {
    const root = projectWithEvent({
      ...BASE_EVENT,
      ts: "2026-07-14T12:00:00Z",
      tests: { passed: 9, total: 10, skipped: 1 },
    });
    try {
      const { context } = await resolve(root);
      expect(context.tests).toEqual({ passed: 9, total: 10, skipped: 1, gate: "fail" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("no tests recorded -> context.tests is null, not a fabricated gate", async () => {
    const root = projectWithEvent({ ...BASE_EVENT, ts: "2026-08-08T12:00:00Z" });
    try {
      const { context } = await resolve(root);
      expect(context.tests).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

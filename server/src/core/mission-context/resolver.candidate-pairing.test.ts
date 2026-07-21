/*
 * resolver.candidate-pairing.test.ts — the resolved Spec must be titled by the
 * candidate that ACTUALLY matched, at whatever index that is.
 *
 * This invariant became load-bearing when the eviction-proof campaign candidate
 * was appended (trg-92c0c36b): it resolves at index 4+, well past the
 * known-layout entries, so anything that re-derived "which candidate won" by
 * inspecting the resolved path — rather than using the index `resolveFirstDoc`
 * returns — would title and fingerprint the document from the WRONG candidate.
 *
 * Scope note, verified rather than assumed: the previous suffix-compare form
 * was NOT observably broken. `realPathGuard` uses plain `realpathSync`, which
 * does not canonicalise leaf case, so the compare always matched. These cases
 * pin the invariant itself, not a repaired defect.
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
const DATE_SLUG = RUN_ID.slice("iterate-".length);
const CAMPAIGN = "webui-pipeline-convergence";

const ASSOCIATION: MissionContextAssociation = {
  kind: "iterate",
  runId: RUN_ID,
  observedAt: "2026-07-09T10:00:00.000Z",
  source: "iterate_active_pointer",
};

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "mc-pairing-"));
  writeFileSync(
    join(root, EVENTS_FILE),
    JSON.stringify({
      id: "evt-1",
      type: "work_completed",
      ts: "2026-07-09T12:00:00Z",
      adr_id: RUN_ID,
      commit: "abc1234",
      campaign: CAMPAIGN,
      sub_iterate_id: "W1",
    }) + "\n",
  );
  return root;
}

function writeDoc(root: string, ...relParts: string[]): void {
  const abs = join(root, ...relParts);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, "# the real plan for this run\n");
}

async function specTitleOf(root: string): Promise<string | undefined> {
  const { context } = await resolveMissionContext(
    {
      taskId: "task-1",
      sessionUuid: "11111111-2222-4333-8444-555555555555",
      projectId: "proj-1",
      projectRoot: root,
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
  const spec = context.artifacts.find((a) => a.kind === "spec");
  return spec?.state === "available" ? (spec.receipt ?? undefined) : undefined;
}

describe("the resolved Spec is titled by the candidate that matched", () => {
  beforeEach(() => {
    _clearResolverCache();
    _clearEventIndexCache();
  });

  it("uses a mid-list known-layout candidate, not candidates[0]", async () => {
    // `<date-slug>.md` is index 3; `<run_id>/mini-plan.md` is index 0 and absent.
    const root = project();
    writeDoc(root, ".shipwright", "planning", "iterate", `${DATE_SLUG}.md`);
    try {
      expect(await specTitleOf(root)).toBe(`${DATE_SLUG}.md`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the appended campaign candidate, which sits past every known-layout entry", async () => {
    const root = project();
    writeDoc(
      root,
      ".shipwright", "planning", "iterate", "campaigns", CAMPAIGN, "sub-iterates",
      "W1-mode-aware-config.md",
    );
    try {
      expect(await specTitleOf(root)).toBe("W1-mode-aware-config.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers the EARLIER candidate when both a known-layout and a campaign doc exist", async () => {
    const root = project();
    writeDoc(root, ".shipwright", "planning", "iterate", `${DATE_SLUG}.md`);
    writeDoc(
      root,
      ".shipwright", "planning", "iterate", "campaigns", CAMPAIGN, "sub-iterates",
      "W1-mode-aware-config.md",
    );
    try {
      // Preference order is unchanged by the append — the known layout still wins.
      expect(await specTitleOf(root)).toBe(`${DATE_SLUG}.md`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

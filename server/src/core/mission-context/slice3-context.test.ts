/*
 * slice3-context.test.ts — S3: the resolver's NON-ITERATE branch.
 *
 * Split from `slice3-sources.test.ts` (size rule). That file proves the document
 * paths resolve; this one proves the branch assembles the right rail for each
 * scenario — and, most importantly, that a scenario whose fact never arrived
 * degrades to a VISIBLE `unavailable` rather than to an empty rail. A wiring
 * mistake that looks like "no data" is the failure this campaign keeps having
 * to re-fix.
 *
 * @covers FR-01.66
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildNonIterateContext } from "./slice3-sources.js";
import type { CampaignFact } from "./campaign-artifacts.js";
import type { PipelineFact } from "./pipeline-artifacts.js";
import type { ArtifactDescriptor } from "./types.js";

const SLUG = "2026-07-18-mission-artifacts";
const CAMPAIGN_REL = [".shipwright", "planning", "iterate", "campaigns", SLUG];
const SUB_SPEC_REL = `${CAMPAIGN_REL.join("/")}/sub-iterates/S2-tests.md`;

function write(root: string, rel: string, body: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf-8");
}

function project(): string {
  const root = mkdtempSync(path.join(tmpdir(), "s3-ctx-"));
  write(root, ".shipwright/planning/01-adopted/spec.md", "# Spec\n");
  write(root, `${CAMPAIGN_REL.join("/")}/campaign.md`, "# Campaign\n");
  write(root, `${CAMPAIGN_REL.join("/")}/RUNBOOK.md`, "# Runbook\n");
  write(root, SUB_SPEC_REL, "# S2\n");
  return root;
}

function campaignFact(): CampaignFact {
  return {
    status: "ok",
    campaign: {
      slug: SLUG,
      intent: "Make Mission answer what a change did.",
      lifecycle: "active",
      branchStrategy: "serial",
      done: 1,
      total: 2,
      steps: [
        { id: "S1", title: "resolver", status: "complete", statusSource: "status_json", specPath: null, commit: "66e275ae", branch: "iterate/S1", testsPassed: 5107, testsTotal: 5108 },
        { id: "S2", title: "tests", status: "in_progress", statusSource: "status_json", specPath: SUB_SPEC_REL, commit: null, branch: null, testsPassed: null, testsTotal: null },
      ],
      provenance: { statusSource: "status_json", degraded: false },
    },
  };
}

function byKind(list: ArtifactDescriptor[], kind: string): ArtifactDescriptor | undefined {
  return list.find((a) => a.kind === kind);
}

describe("buildNonIterateContext", () => {
  const base = (root: string) => ({
    taskId: "task-1",
    sessionUuid: "3c9e3e11-4b53-424e-8062-f9f5a24f6b68",
    projectRoot: root,
    baseRevPaths: [],
    pipeline: null as PipelineFact | null,
    campaign: null as CampaignFact | null,
    campaignSlug: null as string | null,
  });

  it("a pipeline scenario emits the phase + spec rail and carries the run id", () => {
    const root = project();
    const ctx = buildNonIterateContext({
      ...base(root),
      scenario: "pipeline",
      missionTabVisible: true,
      pipeline: {
        status: "ok",
        runId: "run-a1b2c3d4",
        task: {
          phaseTaskId: "ptk-aaaa", phase: "build", splitId: "01-core", status: "done",
          slashCommand: "/shipwright-build", title: "t", description: null,
          startedAt: null, completedAt: null, executionCount: 1, errors: [], outputs: [],
        },
      },
    });
    expect(ctx.scenario).toBe("pipeline");
    expect(ctx.runId).toBe("run-a1b2c3d4");
    expect(ctx.artifacts.map((a) => a.kind)).toEqual(["phase", "spec"]);
    expect(byKind(ctx.artifacts, "spec")?.state).toBe("available");
    rmSync(root, { recursive: true, force: true });
  });

  it("a campaign scenario emits all four campaign artifacts", () => {
    const root = project();
    const ctx = buildNonIterateContext({
      ...base(root),
      scenario: "campaign",
      missionTabVisible: true,
      campaignSlug: SLUG,
      campaign: campaignFact(),
    });
    expect(ctx.artifacts.map((a) => a.kind)).toEqual([
      "spec",
      "campaign_runbook",
      "campaign_progress",
      "sub_iterate",
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("a MISSING fact degrades to `unavailable`, never to an empty rail", () => {
    // A wiring mistake must stay visible rather than looking like "no data".
    const root = project();
    const ctx = buildNonIterateContext({
      ...base(root),
      scenario: "pipeline",
      missionTabVisible: true,
      pipeline: null,
    });
    expect(byKind(ctx.artifacts, "phase")?.state).toBe("unavailable");
    rmSync(root, { recursive: true, force: true });
  });

  it("plain and custom_actions carry NO rail at all", () => {
    const root = project();
    for (const scenario of ["plain", "custom_actions"] as const) {
      const ctx = buildNonIterateContext({
        ...base(root),
        scenario,
        missionTabVisible: scenario !== "custom_actions",
      });
      expect(ctx.artifacts).toEqual([]);
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("a campaign scenario WITHOUT a slug falls through to the empty rail", () => {
    const root = project();
    const ctx = buildNonIterateContext({
      ...base(root),
      scenario: "campaign",
      missionTabVisible: true,
      campaignSlug: null,
    });
    expect(ctx.artifacts).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});

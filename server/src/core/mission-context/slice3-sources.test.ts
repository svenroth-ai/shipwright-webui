/*
 * slice3-sources.test.ts — S3 AC1/AC3 over a REAL temp project tree.
 *
 * The unit tests next door prove the descriptor shapes. This file proves the
 * thing they cannot: that the paths actually resolve on a real filesystem, that
 * a minted id only ever exists for a document that is really there (AC3, "no
 * dead links"), and that a source which changes DURING a run changes the
 * revision.
 *
 * That last property is here because this campaign has already shipped its
 * opposite once: S1 cached a time-varying field outside the revision and froze
 * it forever. `status.json` and `shipwright_run_config.json` both change mid-run,
 * so both are asserted — including while ABSENT, since a file that appears later
 * must invalidate too.
 *
 * @covers FR-01.66
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildCampaignArtifacts,
  buildNonIterateContext,
  campaignRevPaths,
  pipelineRevPaths,
} from "./slice3-sources.js";
import { computeSourceRev } from "./resolver-parts.js";
import { parseDocId } from "./doc-ids.js";
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

/** A project tree with an adopted spec, a campaign brief, a runbook and a unit spec. */
function project(opts: { runbook?: boolean; subSpec?: boolean; adoptedSpec?: boolean } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "s3-slice3-"));
  if (opts.adoptedSpec !== false) {
    write(root, ".shipwright/planning/01-adopted/spec.md", "# Spec\n\n| FR-01.66 | TSK |\n");
  }
  write(root, `${CAMPAIGN_REL.join("/")}/campaign.md`, "# Campaign\n");
  if (opts.runbook !== false) write(root, `${CAMPAIGN_REL.join("/")}/RUNBOOK.md`, "# Runbook\n");
  if (opts.subSpec !== false) write(root, SUB_SPEC_REL, "# S2\n");
  return root;
}

const CTX = (projectRoot: string) => ({
  taskId: "task-1",
  sessionUuid: "3c9e3e11-4b53-424e-8062-f9f5a24f6b68",
  projectRoot,
  rev: "rev0",
});

function campaignFact(over: Partial<CampaignFact> = {}): CampaignFact {
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
        {
          id: "S1", title: "resolver", status: "complete",
          specPath: null, commit: "66e275ae", branch: "iterate/S1",
          testsPassed: 5107, testsTotal: 5108,
        },
        {
          id: "S2", title: "tests", status: "in_progress",
          specPath: SUB_SPEC_REL, commit: null, branch: null,
          testsPassed: null, testsTotal: null,
        },
      ],
    },
    ...(over as object),
  } as CampaignFact;
}

function byKind(list: ArtifactDescriptor[], kind: string): ArtifactDescriptor | undefined {
  return list.find((a) => a.kind === kind);
}

/** Every documentId on the rail, whatever kind carries it. */
function documentIds(list: ArtifactDescriptor[]): string[] {
  const out: string[] = [];
  for (const a of list) {
    const d = a.detail as { documentId?: unknown } | null;
    if (d && typeof d.documentId === "string") out.push(d.documentId);
  }
  return out;
}

describe("campaign artifacts over a real tree", () => {
  it("resolves brief, runbook and the ACTIVE unit's own spec to real documents", () => {
    const root = project();
    const list = buildCampaignArtifacts(CTX(root), SLUG, campaignFact());

    const brief = byKind(list, "spec");
    const runbook = byKind(list, "campaign_runbook");
    const sub = byKind(list, "sub_iterate");

    expect(brief?.state).toBe("available");
    expect(runbook?.state).toBe("available");
    expect(sub?.state).toBe("available");

    // The active unit is S2, so the doc must be S2's spec — not S1's, not the brief's.
    const subDetail = sub?.detail as { documentTitle: string | null; id: string } | null;
    expect(subDetail?.id).toBe("S2");
    expect(subDetail?.documentTitle).toBe("S2-tests.md");
    rmSync(root, { recursive: true, force: true });
  });

  it("mints ids that decode back to the RIGHT file — no descriptor/read drift", () => {
    const root = project();
    const list = buildCampaignArtifacts(CTX(root), SLUG, campaignFact());

    const briefId = (byKind(list, "spec")?.detail as { documentId: string }).documentId;
    const payload = parseDocId(briefId);
    expect(payload?.rel).toBe(`${CAMPAIGN_REL.join("/")}/campaign.md`);
    expect(payload?.t).toBe("task-1");
    expect(payload?.root).toBe(root);
    rmSync(root, { recursive: true, force: true });
  });

  it("AC3 — mints NO id for a document that is not on disk (no dead links)", () => {
    const root = project({ runbook: false, subSpec: false });
    const list = buildCampaignArtifacts(CTX(root), SLUG, campaignFact());

    expect(byKind(list, "campaign_runbook")?.state).toBe("not_applicable");
    // The unit is still a real fact and stays visible — only its link is absent.
    const sub = byKind(list, "sub_iterate");
    expect(sub?.state).toBe("available");
    expect((sub?.detail as { documentId: string | null }).documentId).toBeNull();

    // Exactly one link survives: the brief.
    expect(documentIds(list)).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a traversal slug — NO link of any kind is minted from it", () => {
    const root = project();
    const list = buildCampaignArtifacts(CTX(root), "../../../etc", campaignFact());

    // Every document path in this scenario is anchored on the slug, so an
    // unusable slug yields no links at all: the campaign-level ones are refused
    // outright, and the unit spec is pinned to the SAME slug rather than being
    // accepted on a generic `campaigns/` prefix.
    expect(byKind(list, "spec")?.detail).toBeNull();
    expect(byKind(list, "campaign_runbook")?.detail).toBeNull();
    expect(documentIds(list)).toHaveLength(0);

    // The units themselves remain real facts — only their documents are withheld.
    expect(byKind(list, "campaign_progress")?.state).toBe("available");
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a unit specPath belonging to a DIFFERENT campaign", () => {
    // External code review (openai, MEDIUM). A prefix check that only requires
    // "somewhere under campaigns/" lets one campaign's record point the current
    // campaign's "own unit spec" at another campaign's document — the exact
    // campaign-level/unit-level confusion this slice exists to prevent, and it
    // would look completely normal on screen.
    const root = project();
    write(root, `${[".shipwright", "planning", "iterate", "campaigns"].join("/")}/other-campaign/sub-iterates/S9-other.md`, "# Someone else's unit\n");

    const crossed = campaignFact();
    if (crossed.status === "ok") {
      crossed.campaign.steps[1].specPath =
        ".shipwright/planning/iterate/campaigns/other-campaign/sub-iterates/S9-other.md";
    }
    const list = buildCampaignArtifacts(CTX(root), SLUG, crossed);
    const sub = byKind(list, "sub_iterate");

    expect((sub?.detail as { documentId: string | null }).documentId).toBeNull();
    // The unit itself is still a real fact; only its document is withheld.
    expect(sub?.state).toBe("available");
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a unit specPath outside the campaign's sub-iterates dir", () => {
    const root = project();
    write(root, `${CAMPAIGN_REL.join("/")}/RUNBOOK.md`, "# Runbook\n");
    const crossed = campaignFact();
    if (crossed.status === "ok") {
      crossed.campaign.steps[1].specPath = `${CAMPAIGN_REL.join("/")}/RUNBOOK.md`;
    }
    const list = buildCampaignArtifacts(CTX(root), SLUG, crossed);
    expect((byKind(list, "sub_iterate")?.detail as { documentId: string | null }).documentId).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a unit specPath that escapes the campaigns layout", () => {
    const root = project();
    const escaped = campaignFact();
    if (escaped.status === "ok") {
      escaped.campaign.steps[1].specPath = "../../../../etc/passwd.md";
    }
    const list = buildCampaignArtifacts(CTX(root), SLUG, escaped);
    expect((byKind(list, "sub_iterate")?.detail as { documentId: string | null }).documentId).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  it("an unreadable store yields four VISIBLE unavailable artifacts and no links", () => {
    const root = project();
    const list = buildCampaignArtifacts(CTX(root), SLUG, { status: "unavailable" });
    expect(list).toHaveLength(4);
    expect(list.every((a) => a.state === "unavailable")).toBe(true);
    expect(documentIds(list)).toHaveLength(0);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("revision covers every source that changes DURING a run", () => {
  it("a status.json write changes the campaign revision", () => {
    const root = project();
    const paths = campaignRevPaths(root, SLUG);
    write(root, `${CAMPAIGN_REL.join("/")}/status.json`, '{"status":"active"}');
    const before = computeSourceRev(paths, []);
    write(root, `${CAMPAIGN_REL.join("/")}/status.json`, '{"status":"complete"}');
    expect(computeSourceRev(paths, [])).not.toBe(before);
    rmSync(root, { recursive: true, force: true });
  });

  it("a status.json that did not exist YET still invalidates once created", () => {
    // The S1 failure shape: a source outside the revision is frozen forever, and
    // a not-yet-written file is the easiest one to forget.
    const root = project();
    const paths = campaignRevPaths(root, SLUG);
    const before = computeSourceRev(paths, []);
    write(root, `${CAMPAIGN_REL.join("/")}/status.json`, '{"status":"active"}');
    expect(computeSourceRev(paths, [])).not.toBe(before);
    rmSync(root, { recursive: true, force: true });
  });

  it("a run-config write changes the pipeline revision", () => {
    const root = project();
    const paths = pipelineRevPaths(root);
    const before = computeSourceRev(paths, []);
    write(root, "shipwright_run_config.json", '{"schemaVersion":2}');
    expect(computeSourceRev(paths, [])).not.toBe(before);
    rmSync(root, { recursive: true, force: true });
  });

  it("registers status.json for the campaign — the file most likely to move", () => {
    const root = project();
    expect(campaignRevPaths(root, SLUG).some((p) => p.endsWith("status.json"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("emits no rev paths for an unsafe slug rather than joining it into one", () => {
    expect(campaignRevPaths("/p", "../../etc")).toEqual([]);
    expect(campaignRevPaths("/p", null)).toEqual([]);
  });
});

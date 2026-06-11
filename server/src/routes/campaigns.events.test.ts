import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createCampaignsRoutes, type CampaignProjectMeta } from "./campaigns.js";

// Tracked-events projection for GET /api/campaigns/:projectId (FR-01.31) — the
// deployed-board path: campaign dirs are gitignored/local-only, so progress is
// projected from the tracked <projectRoot>/shipwright_events.jsonl. Split out of
// campaigns.test.ts for the 300-LOC ceiling (sibling of campaigns.attached-run).

const SEGMENTS = [".shipwright", "planning", "iterate", "campaigns"];

const CAMPAIGN_MD = `---
campaign: 2026-06-02-hook
branch_strategy: stacked
---

# Campaign: 2026-06-02-hook

## Intent

Collapse hooks

## Sub-Iterates

| ID | Slug | Title | Status |
|---|---|---|---|
| B0 | alpha | Alpha | complete |
| B1 | beta | Beta | pending |
`;

describe("routes/campaigns: GET events.jsonl projection", () => {
  let workDir: string;
  let projectRoot: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "campaigns-events-route-"));
    const proj = path.join(workDir, "project");
    mkdirSync(proj, { recursive: true });
    projectRoot = realpathSync(proj);
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function appFor(projects: Record<string, CampaignProjectMeta | undefined>) {
    return createCampaignsRoutes({
      getProjectById: (id) => projects[id],
      lock: async () => async () => {},
    });
  }

  function seedEvents(lines: object[]): void {
    writeFileSync(
      path.join(projectRoot, "shipwright_events.jsonl"),
      lines.map((l) => JSON.stringify(l)).join("\n"),
      "utf-8",
    );
  }

  it("overlays an event-confirmed completion onto a stale dir-sourced step", async () => {
    const dir = path.join(projectRoot, ...SEGMENTS, "2026-06-02-hook");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "campaign.md"), CAMPAIGN_MD, "utf-8");
    // The skeleton has B1 pending; the tracked event says B1 finished.
    seedEvents([
      { type: "work_completed", campaign: "2026-06-02-hook", sub_iterate_id: "B1", commit: "deadbeef" },
    ]);

    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const body = (await (await app.request("/api/campaigns/p1")).json()) as {
      campaigns: Array<{
        slug: string;
        done: number;
        total: number;
        nextPending: unknown;
        steps: Array<{ id: string; status: string; commit: string | null }>;
      }>;
    };
    const c = body.campaigns.find((x) => x.slug === "2026-06-02-hook")!;
    expect(c.steps.find((s) => s.id === "B1")!.status).toBe("complete");
    expect(c.steps.find((s) => s.id === "B1")!.commit).toBe("deadbeef");
    expect(c.done).toBe(2);
    expect(c.nextPending).toBeNull();
  });

  it("synthesizes a derivedFromEvents campaign when the planning dir is absent (a clone)", async () => {
    // No campaigns dir at all — only the tracked event log exists.
    seedEvents([
      { type: "work_completed", campaign: "2026-06-11-ghost", sub_iterate_id: "C1", commit: "aaa" },
      { type: "work_completed", campaign: "2026-06-11-ghost", sub_iterate_id: "C2", commit: "bbb" },
    ]);
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const body = (await (await app.request("/api/campaigns/p1")).json()) as {
      campaigns: Array<{
        slug: string;
        derivedFromEvents?: boolean;
        done: number;
        total: number;
        status: string | null;
        steps: Array<{ id: string; status: string; specPath: string | null }>;
      }>;
    };
    expect(body.campaigns).toHaveLength(1);
    const g = body.campaigns[0];
    expect(g.slug).toBe("2026-06-11-ghost");
    expect(g.derivedFromEvents).toBe(true);
    expect(g.status).toBeNull();
    expect(g.done).toBe(2);
    expect(g.total).toBe(2);
    expect(g.steps.map((s) => s.id)).toEqual(["C1", "C2"]);
    expect(g.steps.every((s) => s.status === "complete" && s.specPath === null)).toBe(true);
  });

  it("a missing event log leaves dir-sourced campaigns unchanged", async () => {
    const dir = path.join(projectRoot, ...SEGMENTS, "2026-06-02-hook");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "campaign.md"), CAMPAIGN_MD, "utf-8");
    // No shipwright_events.jsonl written.
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const body = (await (await app.request("/api/campaigns/p1")).json()) as {
      campaigns: Array<{ slug: string; done: number; derivedFromEvents?: boolean; steps: Array<{ id: string; status: string }> }>;
    };
    const c = body.campaigns.find((x) => x.slug === "2026-06-02-hook")!;
    expect(c.done).toBe(1); // B0 complete, B1 still pending
    expect(c.derivedFromEvents).toBeFalsy();
    expect(c.steps.find((s) => s.id === "B1")!.status).toBe("pending");
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createCampaignsRoutes, type CampaignProjectMeta } from "./campaigns.js";
import * as loopStateModule from "../core/campaign-loop-state.js";

/*
 * GET /api/campaigns loop_state-driven annotation tests — split out of
 * campaigns.test.ts (bloat ceiling, iterate-2026-06-09-campaign-board-live-progress).
 * One cohesive concern: how `.shipwright/loop_state.json` annotates the resolved
 * campaign view — the campaign-level `attachedRun` double-launch guard
 * (iterate-2026-06-08) PLUS the per-step `in_progress` overlay (this iterate).
 * The base read shape + the POST /start lifecycle stay in campaigns.test.ts.
 */

const SEGMENTS = [".shipwright", "planning", "iterate", "campaigns"];

describe("routes/campaigns: GET annotation (attachedRun + live in_progress overlay)", () => {
  let workDir: string;
  let projectRoot: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "campaigns-annot-"));
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
      lock: async () => async () => {}, // in-process no-op lock for tests
    });
  }

  function seedCampaign(
    slug: string,
    opts: { statusJson?: unknown; md?: string },
  ): void {
    const dir = path.join(projectRoot, ...SEGMENTS, slug);
    mkdirSync(dir, { recursive: true });
    if (opts.statusJson !== undefined) {
      writeFileSync(path.join(dir, "status.json"), JSON.stringify(opts.statusJson, null, 2), "utf-8");
    }
    if (opts.md !== undefined) {
      writeFileSync(path.join(dir, "campaign.md"), opts.md, "utf-8");
    }
  }

  function seedLoopState(state: unknown): void {
    const dir = path.join(projectRoot, ".shipwright");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "loop_state.json"),
      typeof state === "string" ? state : JSON.stringify(state, null, 2),
      "utf-8",
    );
  }

  // ---- attachedRun annotation (double-launch guard, AC-3) ----

  it("AC-3: attachedRun=true when a live loop_state unit runs for the campaign", async () => {
    seedCampaign("2026-06-08-foo", {
      statusJson: { status: "active", sub_iterates: [{ id: "D1", slug: "x", status: "pending" }] },
    });
    seedLoopState({
      loop_id: "sub_iterate-x",
      kind: "sub_iterate",
      units: [
        {
          id: "D1",
          status: "in_progress",
          spec_path:
            ".shipwright/planning/iterate/campaigns/2026-06-08-foo/sub-iterates/D1-x.md",
          started_at: new Date().toISOString(),
        },
      ],
    });
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const body = (await (await app.request("/api/campaigns/p1")).json()) as {
      campaigns: Array<{ slug: string; attachedRun?: boolean }>;
    };
    expect(body.campaigns.find((c) => c.slug === "2026-06-08-foo")?.attachedRun).toBe(true);
  });

  it("AC-3: attachedRun=true when a status.json step is in_progress (no loop_state)", async () => {
    seedCampaign("2026-06-08-bar", {
      statusJson: { status: "active", sub_iterates: [{ id: "D1", slug: "x", status: "in_progress" }] },
    });
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const body = (await (await app.request("/api/campaigns/p1")).json()) as {
      campaigns: Array<{ slug: string; attachedRun?: boolean }>;
    };
    expect(body.campaigns.find((c) => c.slug === "2026-06-08-bar")?.attachedRun).toBe(true);
  });

  it("AC-3: attachedRun=false for an idle campaign with no loop + no in_progress step", async () => {
    seedCampaign("2026-06-08-idle", {
      statusJson: { status: "active", sub_iterates: [{ id: "D1", slug: "x", status: "pending" }] },
    });
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const body = (await (await app.request("/api/campaigns/p1")).json()) as {
      campaigns: Array<{ slug: string; attachedRun?: boolean }>;
    };
    expect(body.campaigns.find((c) => c.slug === "2026-06-08-idle")?.attachedRun).toBe(false);
  });

  // ---- per-step in_progress overlay (live board feedback, AC-3/AC-4/AC-5) ----

  const LIVE_MD = `---
campaign: 2026-06-09-live
branch_strategy: stacked
---

# Campaign: 2026-06-09-live

## Intent

x

## Sub-Iterates

| ID | Slug | Title | Status |
|---|---|---|---|
| B0 | alpha | Alpha | complete |
| B1 | beta | Beta | pending |
`;

  it("AC-3: overlays in_progress onto the pending step a live loop unit names", async () => {
    seedCampaign("2026-06-09-live", {
      md: LIVE_MD,
      statusJson: {
        status: "active",
        sub_iterates: [
          { id: "B0", slug: "alpha", status: "complete" },
          { id: "B1", slug: "beta", status: "pending" },
        ],
      },
    });
    seedLoopState({
      loop_id: "sub_iterate-x",
      kind: "sub_iterate",
      units: [
        {
          id: "B1",
          status: "in_progress",
          spec_path:
            ".shipwright/planning/iterate/campaigns/2026-06-09-live/sub-iterates/B1-beta.md",
          started_at: new Date().toISOString(),
        },
      ],
    });
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const body = (await (await app.request("/api/campaigns/p1")).json()) as {
      campaigns: Array<{
        slug: string;
        done: number;
        total: number;
        attachedRun?: boolean;
        nextPending: { id: string } | null;
        steps: Array<{ id: string; status: string }>;
      }>;
    };
    const c = body.campaigns.find((x) => x.slug === "2026-06-09-live")!;
    expect(c.steps.find((s) => s.id === "B1")?.status).toBe("in_progress");
    expect(c.steps.find((s) => s.id === "B0")?.status).toBe("complete");
    // counts + nextPending are unchanged — in_progress is not complete.
    expect(c.done).toBe(1);
    expect(c.total).toBe(2);
    expect(c.nextPending?.id).toBe("B1");
    expect(c.attachedRun).toBe(true);
  });

  it("AC-4: overlay never downgrades an authoritative non-pending step", async () => {
    // status.json says B0 complete; a stale loop unit wrongly names B0 → must
    // stay complete (status.json is authoritative; only pending → in_progress).
    seedCampaign("2026-06-09-auth", {
      md: LIVE_MD.replace("2026-06-09-live", "2026-06-09-auth"),
      statusJson: {
        status: "active",
        sub_iterates: [
          { id: "B0", slug: "alpha", status: "complete" },
          { id: "B1", slug: "beta", status: "pending" },
        ],
      },
    });
    seedLoopState({
      loop_id: "sub_iterate-x",
      kind: "sub_iterate",
      units: [
        {
          id: "B0",
          status: "in_progress",
          spec_path:
            ".shipwright/planning/iterate/campaigns/2026-06-09-auth/sub-iterates/B0-alpha.md",
          started_at: new Date().toISOString(),
        },
      ],
    });
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const body = (await (await app.request("/api/campaigns/p1")).json()) as {
      campaigns: Array<{ slug: string; steps: Array<{ id: string; status: string }> }>;
    };
    const c = body.campaigns.find((x) => x.slug === "2026-06-09-auth")!;
    expect(c.steps.find((s) => s.id === "B0")?.status).toBe("complete");
    // B1 was not named by the loop → stays pending.
    expect(c.steps.find((s) => s.id === "B1")?.status).toBe("pending");
  });

  it("consistency: reads loop_state exactly ONCE per request (guard + overlay share one snapshot)", async () => {
    // The chosen plan rejects the two-reader alternative precisely because a
    // double read admits a torn-snapshot disagreement window. Pin the property:
    // the route must call the combined reader exactly once, never per-campaign.
    seedCampaign("2026-06-09-once-a", {
      statusJson: { status: "active", sub_iterates: [{ id: "D1", slug: "x", status: "pending" }] },
    });
    seedCampaign("2026-06-09-once-b", {
      statusJson: { status: "active", sub_iterates: [{ id: "E1", slug: "y", status: "pending" }] },
    });
    const spy = vi.spyOn(loopStateModule, "readLoopRunState");
    try {
      const app = appFor({ p1: { id: "p1", path: projectRoot } });
      const res = await app.request("/api/campaigns/p1");
      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1); // ONE combined read for ALL campaigns
    } finally {
      spy.mockRestore();
    }
  });

  it("AC-3: a torn loop_state.json never 500s the route (attachedRun=false)", async () => {
    seedCampaign("2026-06-08-torn", {
      statusJson: { status: "active", sub_iterates: [{ id: "D1", slug: "x", status: "pending" }] },
    });
    seedLoopState("{ half-written not json");
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const res = await app.request("/api/campaigns/p1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      campaigns: Array<{ slug: string; attachedRun?: boolean }>;
    };
    expect(body.campaigns.find((c) => c.slug === "2026-06-08-torn")?.attachedRun).toBe(false);
  });
});

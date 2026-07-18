import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createCampaignsRoutes, type CampaignProjectMeta } from "./campaigns.js";

// GET loop_state-driven annotation tests (attachedRun + per-step in_progress
// overlay) live in campaigns.attached-run.test.ts (bloat split).

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

describe("routes/campaigns: GET /api/campaigns/:projectId", () => {
  let workDir: string;
  let projectRoot: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "campaigns-route-"));
    // Project is a SUBDIR of workDir so the traversal test's escape target
    // (workDir/escape) is a genuine sibling OUTSIDE the project root.
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

  // @covers FR-01.33
  it("404s an unknown project id", async () => {
    const app = appFor({});
    const res = await app.request("/api/campaigns/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "project_not_found" });
  });

  // @covers FR-01.33
  it("404s a synthesized project (getProjectById returns undefined)", async () => {
    const app = appFor({ unassigned: undefined });
    const res = await app.request("/api/campaigns/unassigned");
    expect(res.status).toBe(404);
  });

  // @covers FR-01.33
  it("404s when getProjectById returns a synthesized:true row", async () => {
    const app = appFor({
      unassigned: { id: "unassigned", path: projectRoot, synthesized: true },
    });
    const res = await app.request("/api/campaigns/unassigned");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "project_not_found" });
  });

  // @covers FR-01.33
  it("403s when the campaigns dir is a symlink escaping the project root", async () => {
    const escapeDir = path.join(workDir, "escape");
    mkdirSync(path.join(escapeDir, "planning", "iterate", "campaigns"), {
      recursive: true,
    });
    try {
      symlinkSync(escapeDir, path.join(projectRoot, ".shipwright"), "junction");
    } catch (err) {
      // Windows junctions may need admin — skip (Linux CI covers it).
      if (
        err instanceof Error &&
        ["EPERM", "EACCES", "EEXIST", "ENOSYS"].includes(
          (err as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        return;
      }
      throw err;
    }
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const res = await app.request("/api/campaigns/p1");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "path_traversal_rejected" });
  });

  // @covers FR-01.33
  it("200 + {campaigns:[]} for a registered project with no campaigns dir", async () => {
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const res = await app.request("/api/campaigns/p1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ campaigns: [] });
  });

  // @covers FR-01.33
  it("200 + the resolved campaign shape for a project with a campaign", async () => {
    const dir = path.join(projectRoot, ...SEGMENTS, "2026-06-02-hook");
    const subDir = path.join(dir, "sub-iterates");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(path.join(dir, "campaign.md"), CAMPAIGN_MD, "utf-8");
    writeFileSync(path.join(subDir, "B1-beta.md"), "# spec\n", "utf-8");

    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const res = await app.request("/api/campaigns/p1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      campaigns: Array<{
        slug: string;
        done: number;
        total: number;
        nextPending: { id: string; specPath: string | null } | null;
        steps: Array<{ id: string; status: string; specPath: string | null }>;
      }>;
    };
    expect(body.campaigns).toHaveLength(1);
    const c = body.campaigns[0];
    expect(c.slug).toBe("2026-06-02-hook");
    expect(c.done).toBe(1);
    expect(c.total).toBe(2);
    expect(c.nextPending?.id).toBe("B1");
    expect(c.nextPending?.specPath).toBe(
      ".shipwright/planning/iterate/campaigns/2026-06-02-hook/sub-iterates/B1-beta.md",
    );
    expect(c.steps[0]).toMatchObject({ id: "B0", status: "complete" });
  });

  // GET events.jsonl projection tests (overlay + synthesize, FR-01.31) live in
  // campaigns.events.test.ts (bloat split).

  // ---- POST /api/campaigns/:projectId/:slug/start (FR-01.33) ----

  // @covers FR-01.33
  it("starts a draft campaign (status.json) → 200 active, reflected by GET", async () => {
    seedCampaign("2026-06-03-x", {
      statusJson: { status: "draft", sub_iterates: [{ id: "B0", slug: "a", status: "pending" }] },
    });
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const res = await app.request("/api/campaigns/p1/2026-06-03-x/start", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: "2026-06-03-x", status: "active" });
    const get = (await (await app.request("/api/campaigns/p1")).json()) as {
      campaigns: Array<{ slug: string; status: string }>;
    };
    expect(get.campaigns.find((c) => c.slug === "2026-06-03-x")?.status).toBe("active");
  });

  // @covers FR-01.33
  it("starts a frontmatter-only draft campaign (no status.json) → 200 active", async () => {
    seedCampaign("2026-06-03-fm", { md: "---\ncampaign: c\nstatus: draft\n---\n\n# c\n" });
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const res = await app.request("/api/campaigns/p1/2026-06-03-fm/start", { method: "POST" });
    expect(res.status).toBe(200);
  });

  // @covers FR-01.33
  it("is idempotent when already active (200)", async () => {
    seedCampaign("2026-06-03-act", { statusJson: { status: "active", sub_iterates: [] } });
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const res = await app.request("/api/campaigns/p1/2026-06-03-act/start", { method: "POST" });
    expect(res.status).toBe(200);
  });

  // @covers FR-01.33
  it("rejects starting a complete campaign with 409 (no revert)", async () => {
    seedCampaign("2026-06-03-done", {
      statusJson: { status: "complete", sub_iterates: [{ id: "B0", slug: "a", status: "complete" }] },
    });
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const res = await app.request("/api/campaigns/p1/2026-06-03-done/start", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "campaign_already_complete" });
  });

  // @covers FR-01.33
  it("404s starting under an unknown project", async () => {
    const app = appFor({});
    const res = await app.request("/api/campaigns/nope/whatever/start", { method: "POST" });
    expect(res.status).toBe(404);
  });

  // @covers FR-01.33
  it("404s starting an unknown slug", async () => {
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const res = await app.request("/api/campaigns/p1/does-not-exist/start", { method: "POST" });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "campaign_not_found" });
  });

  // @covers FR-01.33
  it("403s starting a slug dir that symlinks outside the campaigns root", async () => {
    const outside = path.join(workDir, "outside-campaign");
    mkdirSync(outside, { recursive: true });
    const campaignsRoot = path.join(projectRoot, ...SEGMENTS);
    mkdirSync(campaignsRoot, { recursive: true });
    try {
      symlinkSync(outside, path.join(campaignsRoot, "evil"), "junction");
    } catch (err) {
      // Windows junctions may need admin — skip (Linux CI covers it).
      if (
        err instanceof Error &&
        ["EPERM", "EACCES", "EEXIST", "ENOSYS"].includes(
          (err as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        return;
      }
      throw err;
    }
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const res = await app.request("/api/campaigns/p1/evil/start", {
      method: "POST",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "path_traversal_rejected" });
  });

  // @covers FR-01.33
  it("422s when the campaign has no writable status target", async () => {
    seedCampaign("2026-06-03-bare", { md: "# c\n\nno frontmatter\n" });
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const res = await app.request("/api/campaigns/p1/2026-06-03-bare/start", { method: "POST" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "no_writable_status_target" });
  });

  // @covers FR-01.33
  it("503s when the campaign lock is contended (ELOCKED)", async () => {
    seedCampaign("2026-06-03-busy", {
      statusJson: { status: "draft", sub_iterates: [] },
    });
    const app = createCampaignsRoutes({
      getProjectById: () => ({ id: "p1", path: projectRoot }),
      lock: async () => {
        throw Object.assign(new Error("locked"), { code: "ELOCKED" });
      },
    });
    const res = await app.request("/api/campaigns/p1/2026-06-03-busy/start", {
      method: "POST",
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "lock_unavailable" });
  });
});

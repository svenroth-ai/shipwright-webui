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
    });
  }

  it("404s an unknown project id", async () => {
    const app = appFor({});
    const res = await app.request("/api/campaigns/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "project_not_found" });
  });

  it("404s a synthesized project (getProjectById returns undefined)", async () => {
    const app = appFor({ unassigned: undefined });
    const res = await app.request("/api/campaigns/unassigned");
    expect(res.status).toBe(404);
  });

  it("404s when getProjectById returns a synthesized:true row", async () => {
    const app = appFor({
      unassigned: { id: "unassigned", path: projectRoot, synthesized: true },
    });
    const res = await app.request("/api/campaigns/unassigned");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "project_not_found" });
  });

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

  it("200 + {campaigns:[]} for a registered project with no campaigns dir", async () => {
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const res = await app.request("/api/campaigns/p1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ campaigns: [] });
  });

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
});

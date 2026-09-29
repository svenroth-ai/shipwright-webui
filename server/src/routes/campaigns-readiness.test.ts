import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createCampaignReadinessRoutes } from "./campaigns-readiness.js";
import { resetReadinessCache } from "../core/campaign-readiness.js";

const REPORT = {
  schema_version: "1.0", loop_id: "L", branch_strategy: "independent", base_branch: "main",
  supported: true, finalized: false, ready_ids: ["A"],
  units: [{ id: "A", state: "pending", ready: true, blocked_by: [] }],
};

describe("GET /api/campaigns/:projectId/:slug/readiness", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "readiness-route-")));
    resetReadinessCache();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const app = (spawn?: () => Promise<{ code: number; stdout: string; stderr: string }>) =>
    createCampaignReadinessRoutes({
      getProjectById: (id) => (id === "p1" ? { id: "p1", path: root } : id === "syn" ? { id, path: root, synthesized: true } : undefined),
      readiness: {
        run: async () => ({ ok: true, stdout: "uv", stderr: "" }),
        scriptOverride: __filename,
        spawn: spawn ?? (async () => ({ code: 0, stdout: JSON.stringify(REPORT), stderr: "" })),
      },
    });

  function seedWorktree(slug: string): void {
    const dir = path.join(root, ".worktrees", `campaign-${slug}`, ".shipwright");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "loop_state.json"), JSON.stringify({ kind: "sub_iterate", units: [] }));
  }

  it("passes the scheduler's verdict through verbatim", async () => {
    seedWorktree("demo");
    const res = await app().request("/api/campaigns/p1/demo/readiness");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "report", report: REPORT });
  });

  it("no loop running is a 200 state, not an error", async () => {
    const res = await app().request("/api/campaigns/p1/demo/readiness");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "no-loop" });
  });

  it("engine failures are 200 states too (the UI renders them)", async () => {
    seedWorktree("demo");
    const res = await app(async () => ({ code: 1, stdout: "", stderr: "boom" })).request("/api/campaigns/p1/demo/readiness");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "failed", reason: "boom" });
  });

  it("a throwing scheduler bridge is a 200 'failed' state, not a 500", async () => {
    seedWorktree("demo");
    const res = await app(async () => {
      throw new Error("spawn exploded");
    }).request("/api/campaigns/p1/demo/readiness");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "failed" });
  });

  it("404 for an unknown or synthesized project", async () => {
    expect((await app().request("/api/campaigns/nope/demo/readiness")).status).toBe(404);
    expect((await app().request("/api/campaigns/syn/demo/readiness")).status).toBe(404);
  });

  it("400 for a malformed slug", async () => {
    expect((await app().request("/api/campaigns/p1/a%20b/readiness")).status).toBe(400);
    expect((await app().request("/api/campaigns/p1/a..b/readiness")).status).toBe(400);
  });
});

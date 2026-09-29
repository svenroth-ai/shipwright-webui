/*
 * Through the real launch router: when the campaign has a loop in its own
 * worktree but the scheduler cannot answer (its script is missing), a guided
 * launch still goes ahead (fail-OPEN) and the HTTP response SAYS it was not
 * checked — `readinessChecked:false` — instead of skipping silently. A campaign
 * with no loop at all is not flagged (nothing to check against).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLaunchRouter } from "../routes.js";
import { SdkSessionsStore, type SdkSessionsStoreDeps } from "../../../core/sdk-sessions-store.js";
import { resetReadinessCache } from "../../../core/campaign-readiness.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => void existing.add(p),
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

const SLUG = "2026-09-29-failopen";
const MD = `---\ncampaign: ${SLUG}\nstatus: active\n---\n\n## Sub-Iterates\n\n| ID | Slug | Title | Depends on | Status |\n|---|---|---|---|---|\n| B | beta | Beta | | pending |\n`;

describe("launch campaignStep — readiness fail-open is reported, not silent", () => {
  let projectRoot: string;
  let app: Hono;
  let taskId: string;
  const prevScript = process.env.SHIPWRIGHT_LOOP_CLAIM_SCRIPT;

  beforeEach(async () => {
    resetReadinessCache();
    process.env.SHIPWRIGHT_LOOP_CLAIM_SCRIPT = path.join(tmpdir(), "definitely-missing", "loop_claim.py");
    projectRoot = mkdtempSync(path.join(tmpdir(), "step-failopen-"));
    const dir = path.join(projectRoot, ".shipwright", "planning", "iterate", "campaigns", SLUG);
    mkdirSync(path.join(dir, "sub-iterates"), { recursive: true });
    writeFileSync(path.join(dir, "campaign.md"), MD, "utf-8");
    writeFileSync(path.join(dir, "sub-iterates", "B-beta.md"), "# B\n", "utf-8");

    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    taskId = store.create({ title: "t", cwd: projectRoot, pluginDirs: [], projectId: "p-1" }).taskId;
    app = new Hono();
    app.route(
      "/",
      createLaunchRouter({
        store,
        ptyManager: { get: () => undefined },
        getProjectById: (id) => (id === "p-1" ? { id: "p-1", name: "p1", path: projectRoot } : undefined),
        runConfigReader: async () => ({ status: "missing" }),
      }),
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    if (prevScript === undefined) delete process.env.SHIPWRIGHT_LOOP_CLAIM_SCRIPT;
    else process.env.SHIPWRIGHT_LOOP_CLAIM_SCRIPT = prevScript;
    resetReadinessCache();
  });

  const launch = async (dryRun: boolean) => {
    const res = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignStep: { slug: SLUG, stepId: "B" }, dryRun }),
    });
    return { res, json: (await res.json()) as Record<string, unknown> };
  };
  const seedWorktreeLoop = () => {
    const wt = path.join(projectRoot, ".worktrees", `campaign-${SLUG}`, ".shipwright");
    mkdirSync(wt, { recursive: true });
    writeFileSync(path.join(wt, "loop_state.json"), JSON.stringify({ kind: "sub_iterate", units: [{ id: "B", status: "pending" }] }));
  };

  it("loop present + scheduler unavailable → launched, response carries readinessChecked:false", async () => {
    seedWorktreeLoop();
    for (const dryRun of [true, false]) {
      resetReadinessCache();
      const { res, json } = await launch(dryRun);
      expect(res.status).toBe(200);
      expect(json.readinessChecked).toBe(false);
      expect(json.commands).toBeTruthy();
    }
  });

  it("no loop at all → launched and NOT flagged (nothing to check against)", async () => {
    const { res, json } = await launch(true);
    expect(res.status).toBe(200);
    expect(json).not.toHaveProperty("readinessChecked");
  });
});

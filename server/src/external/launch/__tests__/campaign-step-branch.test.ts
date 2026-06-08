/*
 * external/launch/__tests__/campaign-step-branch.test.ts — POST /launch with
 * `{ campaignStep: { slug, stepId } }` (FR-01.36). One-click launch of a single
 * campaign sub-iterate: the client sends only slug + stepId; the server resolves
 * the step's specPath (via readCampaigns — identical to the board) and builds
 * `/shipwright-iterate "<specPath>"` ENTIRELY server-side (Architecture rule 1 /
 * regression guard #19).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLaunchRouter } from "../routes.js";
import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../../../core/sdk-sessions-store.js";

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
    mkdirSync: (p) => {
      existing.add(p);
    },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

const SLUG = "2026-06-02-hook-consolidation";
const CAMPAIGN_MD = `---
campaign: ${SLUG}
branch_strategy: stacked
status: active
---

# Campaign: ${SLUG}

## Intent

x

## Sub-Iterates

| ID | Slug | Title | Status |
|---|---|---|---|
| B0 | phase-resolver | Resolver | pending |
| B1 | no-spec | No spec file | pending |
`;
// Project-root-relative POSIX spec path the server must resolve for B0.
const B0_SPEC = `.shipwright/planning/iterate/campaigns/${SLUG}/sub-iterates/B0-phase-resolver.md`;

describe("launch campaign-step branch — POST /launch { campaignStep }", () => {
  let projectRoot: string;
  let store: SdkSessionsStore;
  let app: Hono;
  let taskId: string;

  beforeEach(async () => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "campaign-step-launch-"));
    const campaignDir = path.join(
      projectRoot, ".shipwright", "planning", "iterate", "campaigns", SLUG,
    );
    mkdirSync(path.join(campaignDir, "sub-iterates"), { recursive: true });
    writeFileSync(path.join(campaignDir, "campaign.md"), CAMPAIGN_MD, "utf-8");
    // B0 has a spec file; B1 deliberately does NOT (→ spec_missing).
    writeFileSync(
      path.join(campaignDir, "sub-iterates", "B0-phase-resolver.md"),
      "# Sub-Iterate: B0\n",
      "utf-8",
    );

    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const t = store.create({
      title: "campaign: " + SLUG,
      cwd: projectRoot,
      pluginDirs: [],
      projectId: "p-1",
    });
    taskId = t.taskId;
    app = new Hono();
    app.route(
      "/",
      createLaunchRouter({
        store,
        ptyManager: { get: () => undefined },
        getProjectById: (id) =>
          id === "p-1" ? { id: "p-1", name: "p1", path: projectRoot } : undefined,
        runConfigReader: async () => ({ status: "missing" }),
      }),
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  async function launch(body: Record<string, unknown>) {
    const res = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, json: (await res.json()) as Record<string, unknown> };
  }

  it("AC1: builds /shipwright-iterate \"<specPath>\" as one positional, no --resume", async () => {
    const { res, json } = await launch({
      campaignStep: { slug: SLUG, stepId: "B0" },
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const cmds = json.commands as { powershell: string; cmd: string; posix: string };
    const expectedArg = `/shipwright-iterate "${B0_SPEC}"`;
    // POSIX + pwsh single-quote the whole positional, preserving the inner
    // double-quotes around the path verbatim.
    expect(cmds.posix).toContain(`'${expectedArg}'`);
    expect(cmds.posix).toContain("--session-id");
    expect(cmds.posix).not.toContain("--resume");
    expect(cmds.powershell).toContain(`'${expectedArg}'`);
    // cmd double-quotes + backslash-escapes the inner quotes; assert robustly on
    // the command name + the verbatim (unescaped) spec path.
    expect(cmds.cmd).toContain("/shipwright-iterate");
    expect(cmds.cmd).toContain(B0_SPEC);
  });

  it("double-launch guard: 409 campaign_run_already_attached when a live loop unit runs for the campaign", async () => {
    // A live autonomous loop is attached → a manual single-step launch would
    // race it. Note B0 status.json is pending; the signal is loop_state only.
    writeFileSync(
      path.join(projectRoot, ".shipwright", "loop_state.json"),
      JSON.stringify({
        loop_id: "sub_iterate-x",
        kind: "sub_iterate",
        units: [
          {
            id: "B0",
            status: "in_progress",
            spec_path: B0_SPEC,
            started_at: new Date().toISOString(),
          },
        ],
      }),
      "utf-8",
    );
    const { res, json } = await launch({
      campaignStep: { slug: SLUG, stepId: "B0" },
      dryRun: true,
    });
    expect(res.status).toBe(409);
    expect(json.error).toBe("campaign_run_already_attached");
  });

  it("AC2: 400 invalid_campaign_slug for a shell-/path-hostile slug", async () => {
    const { res, json } = await launch({
      campaignStep: { slug: "../escape", stepId: "B0" },
      dryRun: true,
    });
    expect(res.status).toBe(400);
    expect(json.error).toBe("invalid_campaign_slug");
  });

  it("AC2: 400 invalid_campaign_step_id for a hostile stepId", async () => {
    for (const stepId of ["has space", "a/b", "x;y", "..", "z".repeat(65)]) {
      const { res, json } = await launch({
        campaignStep: { slug: SLUG, stepId },
        dryRun: true,
      });
      expect(res.status, `stepId=${JSON.stringify(stepId)}`).toBe(400);
      expect(json.error).toBe("invalid_campaign_step_id");
    }
  });

  it("AC2: 400 campaign_step_not_found for an unknown stepId", async () => {
    const { res, json } = await launch({
      campaignStep: { slug: SLUG, stepId: "ZZ" },
      dryRun: true,
    });
    expect(res.status).toBe(400);
    expect(json.error).toBe("campaign_step_not_found");
  });

  it("AC2: 400 campaign_step_spec_missing when the step has no spec file", async () => {
    const { res, json } = await launch({
      campaignStep: { slug: SLUG, stepId: "B1" },
      dryRun: true,
    });
    expect(res.status).toBe(400);
    expect(json.error).toBe("campaign_step_spec_missing");
  });

  it("AC2: 400 campaign_not_found when the slug has no campaign dir", async () => {
    const { res, json } = await launch({
      campaignStep: { slug: "2099-01-01-nope", stepId: "B0" },
      dryRun: true,
    });
    expect(res.status).toBe(400);
    expect(json.error).toBe("campaign_not_found");
  });

  it("AC3: 400 mixed_launch_intents when campaignStep + actionId", async () => {
    const { res, json } = await launch({
      campaignStep: { slug: SLUG, stepId: "B0" },
      actionId: "new-plain",
    });
    expect(res.status).toBe(400);
    expect(json.error).toBe("mixed_launch_intents");
  });

  it("AC3: 400 mixed_launch_intents when campaignStep + phaseTaskRef", async () => {
    const { res, json } = await launch({
      campaignStep: { slug: SLUG, stepId: "B0" },
      phaseTaskRef: { phaseTaskId: "ptk-1234" },
    });
    expect(res.status).toBe(400);
    expect(json.error).toBe("mixed_launch_intents");
  });

  it("AC3: 400 mixed_launch_intents when campaignStep + campaignSlug", async () => {
    const { res, json } = await launch({
      campaignStep: { slug: SLUG, stepId: "B0" },
      campaignSlug: SLUG,
    });
    expect(res.status).toBe(400);
    expect(json.error).toBe("mixed_launch_intents");
  });

  it("AC5: persists awaiting_external_start + launchedAt on a real (non-dryRun) launch", async () => {
    const { res } = await launch({ campaignStep: { slug: SLUG, stepId: "B0" } });
    expect(res.status).toBe(200);
    const t = store.get(taskId)!;
    expect(t.state).toBe("awaiting_external_start");
    expect(typeof t.launchedAt).toBe("string");
  });
});

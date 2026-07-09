/*
 * external/launch/__tests__/master-run-branch.test.ts — POST /launch with
 * `{ masterRun: true }` (campaign webui-pipeline-convergence W2). The master-run
 * branch builds the single-session master launch command server-side; the client
 * only ever sends the boolean intent (Architecture rule 1 / regression guard #19
 * — command built EXCLUSIVELY by core/launcher.ts). The untrusted→trusted
 * boundary is a readable single_session run_config (WebUI only READS it —
 * CLAUDE.md rule 12).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import { createLaunchRouter } from "../routes.js";
import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../../../core/sdk-sessions-store.js";
import type { RunConfigReadResult } from "../../../core/run-config-reader.js";
import type { RunConfigV2 } from "../../../types/run-config-v2.js";

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

/** A minimal-but-valid v2 run_config read result. `resolveRunMode` only reads
 *  `config.mode`; the rest is filler so the "ok" shape type-checks. */
function okConfig(mode?: "single_session" | "multi_session"): RunConfigReadResult {
  const config = {
    schemaVersion: 2,
    runId: "run-a1b2c3d4",
    scope: "full_app",
    autonomy: "guided",
    deploy_target: "none",
    pipeline: ["project"],
    runConditions: {
      securityEnabled: false,
      splitMode: null,
      aikidoClientIdPresent: false,
    },
    splits_frozen: [],
    status: "in_progress",
    completed_phase_task_ids: [],
    phase_tasks: [],
    created_at: "2026-07-09T00:00:00.000Z",
    ...(mode ? { mode } : {}),
  } as RunConfigV2;
  return {
    status: "ok",
    config,
    diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
  };
}

describe("launch master-run branch — POST /launch { masterRun }", () => {
  let store: SdkSessionsStore;
  let app: Hono;
  let taskId: string;
  // Per-test knobs.
  let readerResult: RunConfigReadResult;
  let projectResolvable: boolean;

  beforeEach(async () => {
    readerResult = okConfig("single_session");
    projectResolvable = true;
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const t = store.create({
      title: "Run-a1b2 master",
      cwd: "/proj/root",
      pluginDirs: [],
      projectId: "p-1",
      runId: "run-a1b2c3d4",
      parentRunMaster: true,
    });
    taskId = t.taskId;
    app = new Hono();
    app.route(
      "/",
      createLaunchRouter({
        store,
        ptyManager: { get: () => undefined },
        getProjectById: (id) =>
          id === "p-1" && projectResolvable
            ? { id: "p-1", name: "p1", path: "/proj/root" }
            : undefined,
        runConfigReader: async () => readerResult,
      }),
    );
  });

  async function launch(body: Record<string, unknown>) {
    const res = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, json: (await res.json()) as Record<string, unknown> };
  }

  it("AC1: builds '/shipwright-run' as one positional, no --resume / --campaign", async () => {
    const { res, json } = await launch({ masterRun: true, dryRun: true });
    expect(res.status).toBe(200);
    const cmds = json.commands as { powershell: string; cmd: string; posix: string };
    expect(cmds.posix).toContain("'/shipwright-run'");
    expect(cmds.posix).toContain("--session-id");
    expect(cmds.posix).toContain("--add-dir");
    expect(cmds.posix).not.toContain("--resume");
    expect(cmds.posix).not.toContain("--campaign");
    expect(cmds.powershell).toContain("'/shipwright-run'");
    expect(cmds.cmd).toContain('"/shipwright-run"');
  });

  it("AC2: 400 master_launch_no_run_config when no v2 run_config", async () => {
    readerResult = { status: "missing" };
    const { res, json } = await launch({ masterRun: true, dryRun: true });
    expect(res.status).toBe(400);
    expect(json.error).toBe("master_launch_no_run_config");
  });

  it("AC2: 400 master_launch_no_run_config when the project is not resolvable", async () => {
    projectResolvable = false;
    const { res, json } = await launch({ masterRun: true, dryRun: true });
    expect(res.status).toBe(400);
    expect(json.error).toBe("master_launch_no_run_config");
    expect(json.detail).toBe("project not resolvable");
  });

  it("AC2: 400 master_launch_wrong_mode for a multi_session run", async () => {
    readerResult = okConfig("multi_session");
    const { res, json } = await launch({ masterRun: true, dryRun: true });
    expect(res.status).toBe(400);
    expect(json.error).toBe("master_launch_wrong_mode");
    expect(json.detail).toBe("multi_session");
  });

  it("AC2: 400 master_launch_wrong_mode for a mode-less legacy config (→ multi_session)", async () => {
    readerResult = okConfig(undefined);
    const { res, json } = await launch({ masterRun: true, dryRun: true });
    expect(res.status).toBe(400);
    expect(json.error).toBe("master_launch_wrong_mode");
  });

  it("AC3: 400 mixed_launch_intents when masterRun + campaignSlug", async () => {
    const { res, json } = await launch({ masterRun: true, campaignSlug: "2026-06-02-x" });
    expect(res.status).toBe(400);
    expect(json.error).toBe("mixed_launch_intents");
  });

  it("AC3: 400 mixed_launch_intents when masterRun + actionId", async () => {
    const { res, json } = await launch({ masterRun: true, actionId: "new-plain" });
    expect(res.status).toBe(400);
    expect(json.error).toBe("mixed_launch_intents");
  });

  it("AC3: 400 mixed_launch_intents when masterRun + phaseTaskRef", async () => {
    const { res, json } = await launch({
      masterRun: true,
      phaseTaskRef: { phaseTaskId: "ptk-1234" },
    });
    expect(res.status).toBe(400);
    expect(json.error).toBe("mixed_launch_intents");
  });

  it("AC3: 400 mixed_launch_intents when masterRun + campaignStep", async () => {
    const { res, json } = await launch({
      masterRun: true,
      campaignStep: { slug: "2026-06-02-x", stepId: "B0" },
    });
    expect(res.status).toBe(400);
    expect(json.error).toBe("mixed_launch_intents");
  });

  it("a genuine resume (JSONL on disk) ignores masterRun → legacy --resume, no /shipwright-run", async () => {
    store.patch(taskId, { firstJsonlObservedAt: new Date().toISOString() });
    const { res, json } = await launch({ masterRun: true, resume: true, dryRun: true });
    expect(res.status).toBe(200);
    const cmds = json.commands as { posix: string };
    expect(cmds.posix).toContain("--resume");
    expect(cmds.posix).not.toContain("/shipwright-run");
  });

  it("absent masterRun falls through to a normal launch (no /shipwright-run)", async () => {
    const { res, json } = await launch({ dryRun: true });
    expect(res.status).toBe(200);
    const cmds = json.commands as { posix: string };
    expect(cmds.posix).not.toContain("/shipwright-run");
  });

  it("persists awaiting_external_start + launchedAt on a real (non-dryRun) master launch", async () => {
    const { res } = await launch({ masterRun: true });
    expect(res.status).toBe(200);
    const t = store.get(taskId)!;
    expect(t.state).toBe("awaiting_external_start");
    expect(typeof t.launchedAt).toBe("string");
  });

  // ── W3 double-master guard (mirrors campaign_run_already_attached) ──────────

  /** Add a SECOND master shadow for a run and force it into a given state. */
  function addOtherMaster(opts: {
    runId?: string;
    projectId?: string;
    parentRunMaster?: boolean;
    state?: string;
    firstJsonlObservedAt?: string;
  }): string {
    const other = store.create({
      title: "other master",
      cwd: "/proj/root",
      pluginDirs: [],
      projectId: opts.projectId ?? "p-1",
      runId: opts.runId ?? "run-a1b2c3d4",
      parentRunMaster: opts.parentRunMaster ?? true,
    });
    store.patch(other.taskId, {
      ...(opts.state ? { state: opts.state as never } : {}),
      ...(opts.firstJsonlObservedAt
        ? { firstJsonlObservedAt: opts.firstJsonlObservedAt }
        : {}),
    });
    return other.taskId;
  }

  it("AC4: 409 master_run_already_attached when another master is attached (by state)", async () => {
    const otherId = addOtherMaster({ state: "active" });
    const { res, json } = await launch({ masterRun: true, dryRun: true });
    expect(res.status).toBe(409);
    expect(json.error).toBe("master_run_already_attached");
    expect(json.detail).toBe(otherId);
  });

  it("AC4: 409 when the other master is launched-but-not-yet-observed (awaiting_external_start)", async () => {
    addOtherMaster({ state: "awaiting_external_start" });
    const { res, json } = await launch({ masterRun: true, dryRun: true });
    expect(res.status).toBe(409);
    expect(json.error).toBe("master_run_already_attached");
  });

  it("AC4: a terminal `done` master (with an observed JSONL) does NOT block a fresh launch", async () => {
    // Regression: a completed master necessarily carries firstJsonlObservedAt;
    // it must NOT be treated as attached (would strand a re-run of the same run).
    addOtherMaster({ state: "done", firstJsonlObservedAt: "2026-07-09T00:00:00Z" });
    const { res, json } = await launch({ masterRun: true, dryRun: true });
    expect(res.status).toBe(200);
    expect((json.commands as { posix: string }).posix).toContain("'/shipwright-run'");
  });

  it("AC4: a NON-attached other master (launch_failed / done / draft) does NOT block", async () => {
    addOtherMaster({ state: "launch_failed" });
    addOtherMaster({ state: "done" });
    addOtherMaster({ state: "draft" });
    const { res, json } = await launch({ masterRun: true, dryRun: true });
    expect(res.status).toBe(200);
    expect((json.commands as { posix: string }).posix).toContain("'/shipwright-run'");
  });

  it("AC4: an attached master for a DIFFERENT run does NOT block", async () => {
    addOtherMaster({ runId: "run-99999999", state: "active" });
    const { res } = await launch({ masterRun: true, dryRun: true });
    expect(res.status).toBe(200);
  });

  it("AC4: a same-run NON-master (parentRunMaster false) active task does NOT block", async () => {
    addOtherMaster({ parentRunMaster: false, state: "active" });
    const { res } = await launch({ masterRun: true, dryRun: true });
    expect(res.status).toBe(200);
  });

  it("AC4: an attached master with the SAME runId but a DIFFERENT project does NOT block (dup-dir isolation)", async () => {
    // A duplicated project dir copies runId verbatim; scope the guard by project.
    addOtherMaster({ projectId: "p-2", state: "active" });
    const { res } = await launch({ masterRun: true, dryRun: true });
    expect(res.status).toBe(200);
  });
});

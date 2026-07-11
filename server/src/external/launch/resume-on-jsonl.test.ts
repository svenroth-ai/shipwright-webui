/*
 * external/launch/resume-on-jsonl.test.ts — D18 (findings F14 + F28).
 *
 * A Launch/Continue issued while the pre-bound `<uuid>.jsonl` ALREADY exists on
 * disk must emit `--resume`, not a duplicate `--session-id` — Claude rejects the
 * latter with "Session ID already in use". Two race windows:
 *
 *   F14 master-run — the board CTA sends `resume:false` during Claude's ~5-15 s
 *        first-JSONL-write window (persisted `firstJsonlObservedAt` not yet
 *        stamped), so the pre-fix master-run branch re-emits
 *        `--session-id '/shipwright-run'`.
 *   F28 phase-task — a phase session started (JSONL written) then died BEFORE
 *        the orchestrator claim flipped `phase_task` off `awaiting_launch`; the
 *        pre-fix phase-task branch ALWAYS emits a fresh `--session-id`.
 *
 * These are RED on pre-fix `main` and green after. The probe is exercised
 * through the production `createExternalRoutes` wiring against a REAL
 * `SessionWatcher` + a REAL jsonl written to a temp projects dir (a round-trip
 * from producer=disk to consumer=launch route, not a stub).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
  type ExternalTask,
} from "../../core/sdk-sessions-store.js";
import { SessionWatcher } from "../../core/session-watcher.js";
import { createExternalRoutes } from "../routes.js";
import type { RunConfigReadResult } from "../../core/run-config-reader.js";
import type { RunConfigV2 } from "../../types/run-config-v2.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => { files.set(p, data); existing.add(p); },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => { if (!files.has(p)) files.set(p, ""); existing.add(p); },
  };
}

const RUN_ID = "run-a1b2c3d4";
const PROJECT_PATH = "/proj/root";
const PROJECT = { id: "p-1", name: "p1", path: PROJECT_PATH };

/** Minimal single_session run_config; only `mode` + `runId` are read here. */
function singleSessionConfig(): RunConfigReadResult {
  return {
    status: "ok",
    config: {
      schemaVersion: 2,
      runId: RUN_ID,
      mode: "single_session",
      scope: "full_app",
      autonomy: "guided",
      deploy_target: "none",
      pipeline: ["project"],
      runConditions: { securityEnabled: false, splitMode: null, aikidoClientIdPresent: false },
      splits_frozen: [],
      status: "in_progress",
      completed_phase_task_ids: [],
      phase_tasks: [],
      created_at: "2026-07-10T00:00:00.000Z",
    } as RunConfigV2,
    diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
  };
}

const PHASE_UUID = "33333333-4444-4555-8666-777777777777";

/** Multi_session run_config with one awaiting_launch phase_task (F28). */
function phaseTaskConfig(): RunConfigReadResult {
  return {
    status: "ok",
    config: {
      schemaVersion: 2,
      runId: RUN_ID,
      mode: "multi_session",
      scope: "full_app",
      autonomy: "guided",
      deploy_target: "none",
      pipeline: ["build"],
      runConditions: { securityEnabled: false, splitMode: null, aikidoClientIdPresent: false },
      splits_frozen: [],
      status: "in_progress",
      completed_phase_task_ids: [],
      phase_tasks: [
        {
          phaseTaskId: "ptk-cccc",
          phase: "build",
          splitId: null,
          sessionUuid: PHASE_UUID,
          status: "awaiting_launch",
          prerequisites: [],
          slashCommand: "/shipwright-build",
        },
      ],
      created_at: "2026-07-10T00:00:00.000Z",
    } as unknown as RunConfigV2,
    diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
  };
}

/** Write a real `<uuid>.jsonl` under a subdir of the temp projects dir, so the
 *  real SessionWatcher.findByUuid resolves it (filename-first, CLAUDE.md rule 3). */
function writeJsonl(projectsDir: string, uuid: string): void {
  const sub = path.join(projectsDir, "-proj-root");
  mkdirSync(sub, { recursive: true });
  writeFileSync(path.join(sub, `${uuid}.jsonl`), '{"type":"summary"}\n');
}

describe("D18 — Launch emits --resume when the JSONL already exists on disk", () => {
  let store: SdkSessionsStore;
  let app: Hono;
  let projectsDir: string;
  let reader: RunConfigReadResult;

  beforeEach(async () => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "d18-resume-on-jsonl-"));
    reader = singleSessionConfig();
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir });
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        getProjectById: (id) => (id === PROJECT.id ? PROJECT : undefined),
        readRunConfig: async () => reader,
        ptyManager: { get: () => undefined },
      }),
    );
  });

  afterEach(() => {
    rmSync(projectsDir, { recursive: true, force: true });
  });

  async function launch(taskId: string, body: Record<string, unknown>) {
    const res = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, json: (await res.json()) as { commands: { posix: string; powershell: string; cmd: string } } };
  }

  function createMaster(): ExternalTask {
    return store.create({
      title: "Run-a1b2 master",
      cwd: PROJECT_PATH,
      // A plugin dir so the resume shape can be checked against CLAUDE.md rule 9
      // (re-pass `--plugin-dir` on EVERY launch, resume included).
      pluginDirs: ["/plugins/shipwright"],
      projectId: PROJECT.id,
      runId: RUN_ID,
      parentRunMaster: true,
    });
  }

  // ── F14 master-run ─────────────────────────────────────────────────────────

  it("F14: masterRun + resume:false + JSONL on disk → --resume, NOT --session-id /shipwright-run", async () => {
    const master = createMaster();
    writeJsonl(projectsDir, master.sessionUuid);

    const { res, json } = await launch(master.taskId, { masterRun: true, resume: false });

    expect(res.status).toBe(200);
    expect(json.commands.posix).toContain(`--resume '${master.sessionUuid}'`);
    expect(json.commands.posix).not.toContain("--session-id");
    expect(json.commands.posix).not.toContain("/shipwright-run");
    // CLAUDE.md rule 9 — plugin dirs re-passed on the resume shape too.
    expect(json.commands.posix).toContain("--plugin-dir '/plugins/shipwright'");
    // Spec — firstJsonlObservedAt stamped on discovery so the CTA/next launch see it.
    expect(store.get(master.taskId)!.firstJsonlObservedAt).toBeTruthy();
  });

  it("F14: a repeated masterRun launch on an already-established master stays --resume (no duplicate --session-id)", async () => {
    const master = createMaster();
    writeJsonl(projectsDir, master.sessionUuid);

    const first = await launch(master.taskId, { masterRun: true, resume: false });
    const second = await launch(master.taskId, { masterRun: true, resume: false });

    for (const r of [first, second]) {
      expect(r.res.status).toBe(200);
      expect(r.json.commands.posix).toContain(`--resume '${master.sessionUuid}'`);
      expect(r.json.commands.posix).not.toContain("--session-id");
    }
  });

  it("F14 regression pin: masterRun + resume:false + NO JSONL → fresh --session-id /shipwright-run", async () => {
    const master = createMaster();
    const { res, json } = await launch(master.taskId, { masterRun: true, resume: false });

    expect(res.status).toBe(200);
    expect(json.commands.posix).toContain("--session-id");
    expect(json.commands.posix).toContain("'/shipwright-run'");
    expect(json.commands.posix).not.toContain("--resume");
  });

  // ── F28 phase-task ─────────────────────────────────────────────────────────

  it("F28: phaseTaskRef re-Continue + JSONL on disk → --resume, NOT --session-id / slash command", async () => {
    reader = phaseTaskConfig();
    const shadow = store.create({
      title: "shadow",
      cwd: PROJECT_PATH,
      pluginDirs: [],
      projectId: PROJECT.id,
      runId: RUN_ID,
      sessionUuid: PHASE_UUID,
      phaseTaskId: "ptk-cccc",
      parentRunMaster: false,
    });
    writeJsonl(projectsDir, PHASE_UUID);

    const { res, json } = await launch(shadow.taskId, { phaseTaskRef: { phaseTaskId: "ptk-cccc" } });

    expect(res.status).toBe(200);
    expect(json.commands.posix).toContain(`--resume '${PHASE_UUID}'`);
    expect(json.commands.posix).not.toContain("--session-id");
    expect(json.commands.posix).not.toContain("/shipwright-build");
    // Spec — firstJsonlObservedAt stamped on discovery so the CTA/next launch see it.
    expect(store.get(shadow.taskId)!.firstJsonlObservedAt).toBeTruthy();
  });

  it("F28 regression pin: phaseTaskRef + NO JSONL → fresh --session-id + slash command", async () => {
    reader = phaseTaskConfig();
    const shadow = store.create({
      title: "shadow",
      cwd: PROJECT_PATH,
      pluginDirs: [],
      projectId: PROJECT.id,
      runId: RUN_ID,
      sessionUuid: PHASE_UUID,
      phaseTaskId: "ptk-cccc",
      parentRunMaster: false,
    });

    const { res, json } = await launch(shadow.taskId, { phaseTaskRef: { phaseTaskId: "ptk-cccc" } });

    expect(res.status).toBe(200);
    expect(json.commands.posix).toContain(`--session-id '${PHASE_UUID}'`);
    expect(json.commands.posix).toContain("'/shipwright-build'");
    expect(json.commands.posix).not.toContain("--resume");
  });
});

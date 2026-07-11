/*
 * external/launch/__tests__/master-run-branch.stamp.test.ts — F34 (D07).
 *
 * A direct-API caller (the double-master guard's own stated threat model:
 * "this closes the multi-tab / direct-API hole") POSTs
 * `POST /tasks/:id/launch { masterRun: true }` on an ORDINARY draft task that
 * was created WITHOUT parentRunMaster/runId. Pre-fix, applyMasterRunBranch's
 * taskUpdate stamped only state+launchedAt, so the launched master carried no
 * parentRunMaster/runId and was INVISIBLE to the double-master guard scan
 * (`t.parentRunMaster === true && t.runId === cfg.runId`). The fix stamps
 * parentRunMaster:true + runId (from the re-read run_config) on launch so every
 * attached master is guard-visible regardless of how it was launched.
 *
 * Split out of master-run-branch.test.ts to keep that file under the 300-line
 * source guideline (D07 AC4 — no new bloat crossing / ratchet).
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

/** Minimal-but-valid single_session v2 run_config read result. */
function okSingleSession(): RunConfigReadResult {
  const config = {
    schemaVersion: 2,
    runId: "run-a1b2c3d4",
    scope: "full_app",
    autonomy: "guided",
    mode: "single_session",
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
  } as RunConfigV2;
  return {
    status: "ok",
    config,
    diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
  };
}

describe("F34 — applyMasterRunBranch stamps parentRunMaster+runId on launch", () => {
  let store: SdkSessionsStore;
  let app: Hono;

  beforeEach(async () => {
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    app = new Hono();
    app.route(
      "/",
      createLaunchRouter({
        store,
        ptyManager: { get: () => undefined },
        getProjectById: (id) =>
          id === "p-1" ? { id: "p-1", name: "p1", path: "/proj/root" } : undefined,
        runConfigReader: async () => okSingleSession(),
      }),
    );
  });

  /** A PLAIN draft task created WITHOUT parentRunMaster/runId — the direct-API
   *  threat model: a script POSTs { masterRun: true } on an ordinary task. */
  function addPlainTask(): string {
    const t = store.create({
      title: "plain draft",
      cwd: "/proj/root",
      pluginDirs: [],
      projectId: "p-1",
      // NO runId, NO parentRunMaster
    });
    return t.taskId;
  }

  async function launchTask(id: string, body: Record<string, unknown>) {
    const res = await app.request(`/api/external/tasks/${id}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, json: (await res.json()) as Record<string, unknown> };
  }

  it("a real masterRun launch on a PLAIN task stamps parentRunMaster+runId (from the re-read run_config)", async () => {
    const plainId = addPlainTask();
    const { res } = await launchTask(plainId, { masterRun: true });
    expect(res.status).toBe(200);
    const stamped = store.get(plainId)!;
    expect(stamped.parentRunMaster).toBe(true);
    expect(stamped.runId).toBe("run-a1b2c3d4");
    expect(stamped.state).toBe("awaiting_external_start");
  });

  it("after a plain masterRun launch, a second masterRun on the same run is now 409 (guard sees the stamped master)", async () => {
    // First: masterRun launch on a plain task → attached (awaiting_external_start)
    // master, stamped so the guard can see it.
    const firstId = addPlainTask();
    const first = await launchTask(firstId, { masterRun: true });
    expect(first.res.status).toBe(200);

    // Second: a different plain task, same run. Pre-fix the first launch left
    // parentRunMaster/runId unset → the guard scan never matched it → 200.
    // After the fix the stamp makes it visible → 409.
    const secondId = addPlainTask();
    const { res, json } = await launchTask(secondId, { masterRun: true, dryRun: true });
    expect(res.status).toBe(409);
    expect(json.error).toBe("master_run_already_attached");
    expect(json.detail).toBe(firstId);
  });

  it("a dryRun masterRun launch does NOT stamp (no state mutation on a pure command build)", async () => {
    const plainId = addPlainTask();
    const { res } = await launchTask(plainId, { masterRun: true, dryRun: true });
    expect(res.status).toBe(200);
    const t = store.get(plainId)!;
    expect(t.parentRunMaster).toBeUndefined();
    expect(t.runId).toBeUndefined();
    expect(t.state).toBe("draft");
  });
});

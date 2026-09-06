/*
 * external/launch/__tests__/claim-permission-perimeter-centralized.test.ts
 * — FR-04.22 Stage-3 doubt-review follow-up
 * (iterate-2026-09-06-claim-launch-permission-perimeter).
 *
 * Doubt review: `claimAuthorized` is threaded, opt-in, into only two of the
 * six launch-precedence branches. A claim-authorized request combined with
 * a `phaseTaskRef` reaches `applyPhaseTaskBranch`, which has no idea
 * `claimAuthorized` exists and returns a fully unrestricted command. This
 * proves the CENTRALIZED backstop in routes.ts (`commandsCarryPermissionPerimeter`)
 * catches exactly that case, rather than trusting per-branch opt-in wiring
 * to stay complete forever.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

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
    writeFile: async (p, data) => { files.set(p, data); existing.add(p); },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => { if (!files.has(p)) files.set(p, ""); existing.add(p); },
  };
}

describe("centralized permission-perimeter backstop — a claim-authorized launch that reaches an unwired branch is refused", () => {
  it("409 claim_launch_permission_perimeter_missing when a claimed launch carries a valid phaseTaskRef", async () => {
    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const t = store.create({
      title: "t",
      cwd: "/c",
      pluginDirs: [],
      projectId: "p-1",
    });
    store.patch(t.taskId, {
      claimToken: "tok-daemon",
      claimedBy: "lead-7",
      claimedAt: new Date().toISOString(),
    });
    await store.persist();

    const app = new Hono();
    app.route(
      "/",
      createLaunchRouter({
        store,
        ptyManager: { get: () => undefined },
        getProjectById: (id) =>
          id === "p-1" ? { id: "p-1", name: "p1", path: "/projects/p1" } : undefined,
        // A real, actionable phase_task bound to the task's own sessionUuid —
        // applyPhaseTaskBranch (Branch 1) would happily produce commands for
        // this, and that branch has never heard of claimAuthorized.
        runConfigReader: async () =>
          ({
            status: "ok",
            config: {
              schemaVersion: 2,
              runId: "run-deadbeef",
              phase_tasks: [
                {
                  phaseTaskId: "ptk-abcd",
                  phase: "build",
                  splitId: null,
                  sessionUuid: t.sessionUuid,
                  status: "awaiting_launch",
                  prerequisites: [],
                  slashCommand: "/shipwright-build",
                },
              ],
              completed_phase_task_ids: [],
            },
            diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
          }) as never,
      }),
    );

    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        claimToken: "tok-daemon",
        phaseTaskRef: { phaseTaskId: "ptk-abcd" },
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("claim_launch_permission_perimeter_missing");
  });

  it("the SAME phaseTaskRef launch, WITHOUT a claim, still succeeds unarmed (manual/phase-task launches are untouched)", async () => {
    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const t = store.create({
      title: "t",
      cwd: "/c",
      pluginDirs: [],
      projectId: "p-1",
    });

    const app = new Hono();
    app.route(
      "/",
      createLaunchRouter({
        store,
        ptyManager: { get: () => undefined },
        getProjectById: (id) =>
          id === "p-1" ? { id: "p-1", name: "p1", path: "/projects/p1" } : undefined,
        runConfigReader: async () =>
          ({
            status: "ok",
            config: {
              schemaVersion: 2,
              runId: "run-deadbeef",
              phase_tasks: [
                {
                  phaseTaskId: "ptk-abcd",
                  phase: "build",
                  splitId: null,
                  sessionUuid: t.sessionUuid,
                  status: "awaiting_launch",
                  prerequisites: [],
                  slashCommand: "/shipwright-build",
                },
              ],
              completed_phase_task_ids: [],
            },
            diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
          }) as never,
      }),
    );

    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phaseTaskRef: { phaseTaskId: "ptk-abcd" } }),
    });
    expect(res.status).toBe(200);
  });
});

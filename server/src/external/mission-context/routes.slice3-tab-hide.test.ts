/*
 * routes.slice3-tab-hide.test.ts — scenario 6 end-to-end through the REAL fact
 * gatherer (S3, FR-01.66).
 *
 * Split from `routes.slice3.test.ts` (size rule), and it earns its own file: the
 * tab-hide is the only decision in this campaign that removes a whole surface,
 * and it turns on TWO conjuncts, each of which shipped the same bug.
 *
 *   the actions catalog — valid JSON of the WRONG SHAPE hid the tab, because
 *     `JSON.parse` succeeds and the contract-version check only warns.
 *   the run-config     — `status === "ok"` collapsed FOUR read states into
 *     "no SDLC project", so a config that was present but corrupt, legacy, on an
 *     unknown schema, or simply unreadable hid the tab too.
 *
 * Both are the same mistake: treating "we could not read it" as "it is not
 * there". These flows drive real files through the real loader and the real
 * `readRunConfig`, because neither bug is visible to a test that stubs its
 * inputs — the defective files parse, or fail, exactly as a valid one would.
 *
 * @covers FR-01.66
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMissionContextRouter } from "./routes.js";
import { getScenarioFacts } from "./facts.js";
import { clearActionsCache } from "../../core/project-actions-loader.js";
import { clearRunConfigReaderCache, readRunConfig } from "../../core/run-config-reader.js";
import { _clearResolverCache } from "../../core/mission-context/resolver.js";
import type { ExternalTask, SdkSessionsStore } from "../../core/sdk-sessions-store.js";

const UUID = "3c9e3e11-4b53-424e-8062-f9f5a24f6b68";
const VALID_RUN_CONFIG = JSON.stringify({
  schemaVersion: 2,
  contractVersion: 1,
  runId: "run-a1b2c3d4",
  scope: "full_app",
  autonomy: "guided",
  deploy_target: "local",
  pipeline: ["build"],
  runConditions: { securityEnabled: false, splitMode: null, aikidoClientIdPresent: false },
  splits_frozen: [],
  status: "in_progress",
  completed_phase_task_ids: [],
  created_at: "2026-07-18T08:00:00.000Z",
  phase_tasks: [],
});

const roots: string[] = [];

function write(root: string, rel: string, body: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf-8");
}

/** A bare project — NO run-config, so the run-config leg is set per-test. */
function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "mc-s3-hide-"));
  roots.push(root);
  write(root, ".shipwright/planning/01-adopted/spec.md", "# Spec\n");
  return root;
}

function makeTask(over: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1", sessionUuid: UUID, cwd: "/x", pluginDirs: [], state: "active",
    title: "A task", projectId: "proj-1", createdAt: "2026-07-18T09:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...over,
  };
}

interface Ctx {
  scenario: string;
  missionTabVisible: boolean;
}

/** Wire the router with the PRODUCTION fact gatherer (or an injected reader). */
async function contextFor(
  root: string,
  task: ExternalTask,
  readRunConfigOverride?: () => Promise<never>,
): Promise<Ctx> {
  const tasks = new Map([[task.taskId, task]]);
  const store = {
    get: (id: string) => tasks.get(id),
    patch: () => undefined,
    persist: async () => {},
  } as unknown as SdkSessionsStore;

  const project = { id: "proj-1", name: "P", path: root };
  const app = createMissionContextRouter({
    store,
    getProjectById: (id) => (id === "proj-1" ? project : undefined),
    readTranscriptTail: async () => "",
    getScenarioFacts: (p, t) =>
      getScenarioFacts(p, t, { readRunConfig: readRunConfigOverride ?? readRunConfig }),
  });

  const res = await app.request(`/api/external/tasks/${task.taskId}/mission-context`);
  return ((await res.json()) as { context: Ctx }).context;
}

const CUSTOM_ACTIONS = '{"schemaVersion":1,"actions":[{"id":"publish-post"}],"phases":[]}';

beforeEach(() => {
  clearActionsCache();
  clearRunConfigReaderCache();
  _clearResolverCache();
});

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("GET mission-context — the tab-hide gate, end to end", () => {
  it("HIDES the tab for a validated custom-actions project", async () => {
    const root = makeProject();
    write(root, ".shipwright-webui/actions.json", '{"schemaVersion":1,"actions":[{"id":"publish-post"}],"phases":[]}');
    const ctx = await contextFor(root, makeTask());
    expect(ctx.scenario).toBe("custom_actions");
    expect(ctx.missionTabVisible).toBe(false);
  });

  it("SHOWS the tab when the same project also has a valid run-config (dual mode)", async () => {
    const root = makeProject();
    write(root, ".shipwright-webui/actions.json", CUSTOM_ACTIONS);
    write(root, "shipwright_run_config.json", VALID_RUN_CONFIG);
    expect((await contextFor(root, makeTask())).missionTabVisible).toBe(true);
  });

  it("SHOWS the tab for valid JSON of the wrong shape (the S3 regression)", async () => {
    const root = makeProject();
    write(root, ".shipwright-webui/actions.json", '{"schemaVersion":1,"actions":[{"foo":"bar"}],"phases":[]}');
    const ctx = await contextFor(root, makeTask());
    expect(ctx.missionTabVisible).toBe(true);
    expect(ctx.scenario).not.toBe("custom_actions");
  });

  it("SHOWS the tab for a malformed actions file", async () => {
    const root = makeProject();
    write(root, ".shipwright-webui/actions.json", '{"schemaVersion":1,"actions":[');
    expect((await contextFor(root, makeTask())).missionTabVisible).toBe(true);
  });
});

/*
 * The RUN-CONFIG leg of the same gate, over real files.
 *
 * `hasValidRunConfig = status === "ok"` collapsed FOUR read states into three,
 * so a project with a genuine custom-actions catalog and a run-config that was
 * present but corrupt, legacy, or on an unknown schema lost its Mission tab —
 * with no error and no cause. MEASURED before the fix: all three cases below
 * hid the tab; only the truly-absent case is supposed to.
 */
describe("GET mission-context — an UNREADABLE run-config must never hide the tab", () => {
  async function visibleWithRunConfig(body: string | null): Promise<boolean> {
    const root = makeProject();
    write(root, ".shipwright-webui/actions.json", CUSTOM_ACTIONS);
    if (body !== null) write(root, "shipwright_run_config.json", body);
    return (await contextFor(root, makeTask())).missionTabVisible;
  }

  it("a truly ABSENT run-config still hides — the one state that is evidence", async () => {
    expect(await visibleWithRunConfig(null)).toBe(false);
  });

  it("CORRUPT JSON keeps the tab", async () => {
    expect(await visibleWithRunConfig('{"schemaVersion": 2, "runId": ')).toBe(true);
  });

  it("a V1-LEGACY config keeps the tab", async () => {
    expect(
      await visibleWithRunConfig(JSON.stringify({ schema_version: 1, status: "complete" })),
    ).toBe(true);
  });

  it("an UNSUPPORTED schemaVersion keeps the tab", async () => {
    expect(
      await visibleWithRunConfig(JSON.stringify({ schemaVersion: 99, runId: "run-a1b2c3d4" })),
    ).toBe(true);
  });

  it("valid JSON of the wrong SHAPE keeps the tab", async () => {
    expect(await visibleWithRunConfig(JSON.stringify({ hello: "world" }))).toBe(true);
  });

  it("a run-config that is a DIRECTORY keeps the tab", async () => {
    const root = makeProject();
    write(root, ".shipwright-webui/actions.json", CUSTOM_ACTIONS);
    mkdirSync(path.join(root, "shipwright_run_config.json"), { recursive: true });
    expect((await contextFor(root, makeTask())).missionTabVisible).toBe(true);
  });

  it("a READ THAT THROWS keeps the tab — an I/O fault must not delete a surface", async () => {
    const root = makeProject();
    write(root, ".shipwright-webui/actions.json", CUSTOM_ACTIONS);
    const ctx = await contextFor(root, makeTask(), async () => {
      throw new Error("EACCES");
    });
    expect(ctx.missionTabVisible).toBe(true);
  });
});

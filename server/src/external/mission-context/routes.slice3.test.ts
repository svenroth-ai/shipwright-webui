/*
 * routes.slice3.test.ts — S3 end-to-end through the REAL fact gatherer.
 *
 * Every other S3 test injects its facts. This one does not: it builds a real
 * project on disk and drives `getScenarioFacts` — the production function — so
 * the whole chain is exercised, `run-config → facts-slice3 → resolver → route`
 * and `campaign store → facts-slice3 → resolver → route`.
 *
 * That matters because the S1/S2 reviews both caught bugs that lived in the
 * WIRING rather than in any unit: a route test that stubs its own inputs proves
 * the units agree with the stub, not with each other.
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
const PHASE_SESSION = "22222222-3333-4444-8555-666666666666";
const SLUG = "2026-07-18-mission-artifacts";
const CAMPAIGN_DIR = `.shipwright/planning/iterate/campaigns/${SLUG}`;

const roots: string[] = [];

function write(root: string, rel: string, body: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf-8");
}

/** A project with an adopted spec + a real campaign + (optionally) a run-config. */
function makeProject(opts: { runConfig?: boolean } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "mc-s3-"));
  roots.push(root);

  write(root, ".shipwright/planning/01-adopted/spec.md", "# Spec\n\n| FR-01.66 | TSK | Mission |\n");

  write(root, `${CAMPAIGN_DIR}/campaign.md`, ["---", "branch_strategy: serial", "---", "", "## Intent", "", "Make Mission answer what a change did.", ""].join("\n"));
  write(root, `${CAMPAIGN_DIR}/RUNBOOK.md`, "# Runbook\n");
  write(root, `${CAMPAIGN_DIR}/sub-iterates/S2-tests.md`, "# S2 tests\n");
  write(
    root,
    `${CAMPAIGN_DIR}/status.json`,
    JSON.stringify({
      campaign: SLUG,
      status: "active",
      branch_strategy: "serial",
      sub_iterates: [
        { id: "S1", slug: "resolver", status: "complete", commit: "66e275ae", branch: "iterate/S1", tests_passed: 5107, tests_total: 5108 },
        { id: "S2", slug: "tests", status: "in_progress", commit: null, branch: null, tests_passed: null, tests_total: null },
      ],
    }),
  );

  if (opts.runConfig !== false) {
    write(
      root,
      "shipwright_run_config.json",
      JSON.stringify({
        schemaVersion: 2,
        contractVersion: 1,
        runId: "run-a1b2c3d4",
        scope: "full_app",
        autonomy: "guided",
        deploy_target: "local",
        pipeline: ["build"],
        runConditions: { securityEnabled: false, splitMode: "per_split", aikidoClientIdPresent: false },
        splits_frozen: ["01-core", "02-ui"],
        status: "in_progress",
        completed_phase_task_ids: [],
        created_at: "2026-04-25T08:00:00.000Z",
        phase_tasks: [
          {
            phaseTaskId: "ptk-aaaa", phase: "build", splitId: "01-core", sessionUuid: PHASE_SESSION,
            version: 1, status: "done", title: "Run-a1b2 / build / 01-core",
            slashCommand: "/shipwright-build", prerequisites: [], executionCount: 1,
            createdAt: "2026-04-25T08:00:00.000Z",
          },
          {
            phaseTaskId: "ptk-bbbb", phase: "build", splitId: "02-ui", sessionUuid: UUID,
            version: 1, status: "in_progress", title: "Run-a1b2 / build / 02-ui",
            slashCommand: "/shipwright-build", prerequisites: [], executionCount: 1,
            createdAt: "2026-04-25T08:00:00.000Z",
            startedAt: "2026-04-25T10:00:00.000Z",
          },
        ],
      }),
    );
  }
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
  runId: string | null;
  missionTabVisible: boolean;
  artifacts: { kind: string; state: string; label: string; detail?: Record<string, unknown> | null }[];
}

/** Wire the router with the PRODUCTION fact gatherer. */
async function contextFor(root: string, task: ExternalTask): Promise<Ctx> {
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
    readTranscriptTail: async () => ({ text: "", revision: "rev-1" }),
    getScenarioFacts: (p, t) => getScenarioFacts(p, t, { readRunConfig }),
  });

  const res = await app.request(`/api/external/tasks/${task.taskId}/mission-context`);
  return ((await res.json()) as { context: Ctx }).context;
}

const kinds = (c: Ctx) => c.artifacts.map((a) => a.kind);
const find = (c: Ctx, kind: string) => c.artifacts.find((a) => a.kind === kind);

beforeEach(() => {
  clearActionsCache();
  clearRunConfigReaderCache();
  _clearResolverCache();
});

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("GET mission-context — pipeline (scenario 3), real run-config", () => {
  it("resolves the EXACT phase task and links the adopted spec", async () => {
    const root = makeProject();
    const ctx = await contextFor(root, makeTask({ phaseTaskId: "ptk-bbbb", runId: "run-a1b2c3d4" }));

    expect(ctx.scenario).toBe("pipeline");
    expect(ctx.runId).toBe("run-a1b2c3d4");
    expect(kinds(ctx)).toEqual(["phase", "spec"]);

    // The sibling `ptk-aaaa` shares the phase; only the requested one may win.
    expect(find(ctx, "phase")?.detail?.splitId).toBe("02-ui");
    expect(find(ctx, "phase")?.detail?.status).toBe("in_progress");

    const spec = find(ctx, "spec");
    expect(spec?.state).toBe("available");
    expect(spec?.label).toBe("Spec & requirements");
    expect(typeof spec?.detail?.documentId).toBe("string");
  });

  it("resolves the OTHER sibling when asked for it — no conflation across splits", async () => {
    const root = makeProject();
    const ctx = await contextFor(root, makeTask({ phaseTaskId: "ptk-aaaa", runId: "run-a1b2c3d4" }));
    expect(find(ctx, "phase")?.detail?.splitId).toBe("01-core");
    expect(find(ctx, "phase")?.detail?.status).toBe("done");
  });

  it("a phase task the run-config does not list is UNAVAILABLE, not absent", async () => {
    const root = makeProject();
    const ctx = await contextFor(root, makeTask({ phaseTaskId: "ptk-zzzz", runId: "run-a1b2c3d4" }));
    expect(find(ctx, "phase")?.state).toBe("unavailable");
  });

  it("a missing run-config is UNAVAILABLE, never an empty rail", async () => {
    const root = makeProject({ runConfig: false });
    const ctx = await contextFor(root, makeTask({ phaseTaskId: "ptk-bbbb", runId: "run-a1b2c3d4" }));
    expect(ctx.scenario).toBe("pipeline");
    expect(find(ctx, "phase")?.state).toBe("unavailable");
    expect(ctx.artifacts.length).toBeGreaterThan(0);
  });
});

describe("GET mission-context — campaign (scenario 5), real campaign store", () => {
  const campaignTask = () => makeTask({ title: `campaign: ${SLUG}` });

  it("emits campaign-level and sub-iterate artifacts, kept distinct", async () => {
    const root = makeProject();
    const ctx = await contextFor(root, campaignTask());

    expect(ctx.scenario).toBe("campaign");
    expect(kinds(ctx)).toEqual(["spec", "campaign_runbook", "campaign_progress", "sub_iterate"]);
    expect(find(ctx, "spec")?.label).toBe("Campaign brief");
    expect(find(ctx, "campaign_progress")?.detail?.done).toBe(1);
    expect(find(ctx, "campaign_progress")?.detail?.total).toBe(2);
  });

  it("picks S2 as the active unit and carries ITS record, not S1's", async () => {
    const root = makeProject();
    const sub = find(await contextFor(root, campaignTask()), "sub_iterate")?.detail;

    expect(sub?.id).toBe("S2");
    expect(sub?.selectedBy).toBe("in_progress");
    // S1's commit + test counts must NOT leak onto the running unit.
    expect(sub?.commit).toBeNull();
    expect(sub?.testsPassed).toBeNull();
    expect(sub?.testsTotal).toBeNull();
    // ...and S2's own spec resolved to a real document.
    expect(sub?.documentTitle).toBe("S2-tests.md");
  });

  it("reads the per-unit test counts that only status.json carries", async () => {
    const root = makeProject();
    // Flip S1 to running so its recorded counts become the active unit's.
    write(
      root,
      `${CAMPAIGN_DIR}/status.json`,
      JSON.stringify({
        campaign: SLUG, status: "active",
        sub_iterates: [{ id: "S1", slug: "resolver", status: "in_progress", commit: "66e275ae", branch: "iterate/S1", tests_passed: 5107, tests_total: 5108 }],
      }),
    );
    const sub = find(await contextFor(root, campaignTask()), "sub_iterate")?.detail;
    expect(sub?.id).toBe("S1");
    expect(sub?.testsPassed).toBe(5107);
    expect(sub?.testsTotal).toBe(5108);
  });

  it("a `campaign:` TITLE with no matching record is NOT a campaign", async () => {
    const root = makeProject();
    const ctx = await contextFor(root, makeTask({ title: "campaign: not-a-real-slug" }));
    expect(ctx.scenario).toBe("plain");
    expect(ctx.artifacts).toEqual([]);
  });

  it("a live status.json change is reflected WITHOUT a restart (not cached stale)", async () => {
    const root = makeProject();
    const before = find(await contextFor(root, campaignTask()), "campaign_progress")?.detail;
    expect(before?.done).toBe(1);

    write(
      root,
      `${CAMPAIGN_DIR}/status.json`,
      JSON.stringify({
        campaign: SLUG, status: "complete",
        sub_iterates: [
          { id: "S1", slug: "resolver", status: "complete", commit: "a", branch: "b", tests_passed: 1, tests_total: 1 },
          { id: "S2", slug: "tests", status: "complete", commit: "c", branch: "d", tests_passed: 2, tests_total: 2 },
        ],
      }),
    );

    const after = find(await contextFor(root, campaignTask()), "campaign_progress")?.detail;
    expect(after?.done).toBe(2);
  });
});

/*
 * test-harness.ts — shared fixture for the mission-context route tests.
 *
 * Builds a real temp project (pointer + spec on disk) and an in-memory store
 * double that honours the SAME once-only contract as the real
 * `setMissionContextOnce`, so the "exactly one write" assertions are testing
 * the ROUTE's behaviour rather than a permissive stub.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import { createMissionContextRouter } from "./routes.js";
import type { ExternalTask } from "../../core/sdk-sessions-store.js";
import type { SdkSessionsStore } from "../../core/sdk-sessions-store.js";

export const UUID = "3c9e3e11-4b53-424e-8062-f9f5a24f6b68";
export const OTHER_UUID = "11111111-2222-3333-4444-555555555555";
export const RUN_ID = "iterate-2026-07-18-demo";
export const SPEC_REL = `.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`;

/** A temp project with a valid pointer + a spec document. */
export function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "mc-route-"));
  mkdirSync(join(root, ".shipwright", "iterate_active"), { recursive: true });
  mkdirSync(join(root, ".shipwright", "planning", "iterate", RUN_ID), { recursive: true });
  // A realistic spec shape: the planned-impact scan is SCOPED to the
  // affected-boundaries section, so an FR id cited elsewhere (the References
  // line below) must NOT be reported as impact.
  writeFileSync(
    join(root, ".shipwright", "planning", "iterate", RUN_ID, "mini-plan.md"),
    [
      "# Demo plan",
      "",
      "Wire the Mission tab to the iterate resolver.",
      "",
      "## Affected Boundaries",
      "",
      "The mission-context response shape (FR-01.66).",
      "",
      "## References",
      "",
      "Prior art: FR-01.28 (embedded terminal) — unchanged by this run.",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, ".shipwright", "iterate_active", `${UUID}.json`),
    JSON.stringify({
      run_id: RUN_ID,
      slug: "demo",
      branch: "iterate/demo",
      main_root: root,
      session_id: UUID,
      created_at: "2026-07-18T10:00:00Z",
    }),
  );
  return root;
}

export function makeTask(over: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: UUID,
    cwd: "/x",
    pluginDirs: [],
    state: "active",
    title: "Demo iterate",
    projectId: "proj-1",
    createdAt: "2026-07-18T09:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...over,
  };
}

export interface HarnessOptions {
  /** Make persist() reject, the way an ELOCKED contention would. */
  persistThrows?: boolean;
  transcript?: string;
}

export function harness(root: string, task: ExternalTask, opts: HarnessOptions = {}) {
  const tasks = new Map<string, ExternalTask>([[task.taskId, task]]);
  const persist = vi.fn(async () => {
    if (opts.persistThrows) throw new Error("ELOCKED");
  });

  // A real store double: `setMissionContextOnce` (the module under test at the
  // route level) drives it through `get` + `patch`, so the once-only semantics
  // exercised here are the PRODUCTION ones, not a permissive stub.
  const store = {
    get: (id: string) => tasks.get(id),
    patch: (id: string, patch: Partial<ExternalTask>) => {
      const t = tasks.get(id);
      if (!t) return undefined;
      Object.assign(t, patch);
      return t;
    },
    persist,
  } satisfies Pick<SdkSessionsStore, "get" | "patch" | "persist">;

  const app = createMissionContextRouter({
    store: store as unknown as SdkSessionsStore,
    getProjectById: (id) => (id === "proj-1" ? { id: "proj-1", name: "P", path: root } : undefined),
    readTranscriptTail: async () => opts.transcript ?? "",
    getScenarioFacts: async () => ({
      actions: { fromUser: false, hasDiagnostics: false, actionIds: ["new-iterate"] },
      hasValidRunConfig: false,
      campaignSlug: null,
      hasCampaignRecord: false,
    }),
  });

  return { app, persist, tasks };
}

interface ArtifactLike {
  kind: string;
  state: string;
  detail?: { documentId?: string } | null;
}

export interface ContextLike {
  scenario: string;
  runId: string | null;
  missionTabVisible: boolean;
  artifacts: ArtifactLike[];
  tests: { passed: number | null; total: number | null } | null;
  servesFrId: string | null;
}

export async function getContext(
  app: ReturnType<typeof harness>["app"],
  taskId = "task-1",
): Promise<ContextLike> {
  const res = await app.request(`/api/external/tasks/${taskId}/mission-context`);
  const body = (await res.json()) as { context: ContextLike };
  return body.context;
}

export function artifact(ctx: ContextLike, kind: string): ArtifactLike | undefined {
  return ctx.artifacts.find((a) => a.kind === kind);
}

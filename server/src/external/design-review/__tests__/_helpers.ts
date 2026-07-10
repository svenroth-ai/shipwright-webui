/*
 * design-review/__tests__/_helpers.ts — shared fixtures for the three
 * design-gate handler test files (NOT a *.test.ts, so vitest won't collect it).
 */

import { Hono } from "hono";

import { createDesignReviewRouter } from "../routes.js";
import type { ExternalRouteProjectView } from "../../_shared/helpers.js";
import type { RunConfigReadResult } from "../../../core/run-config-reader.js";
import type { RunConfigV2, PhaseTask } from "../../../types/run-config-v2.js";

export const PROJECT_ID = "p-test";

export function phaseTask(over: Partial<PhaseTask>): PhaseTask {
  return {
    phaseTaskId: "ptk-design",
    phase: "design",
    splitId: null,
    sessionUuid: "00000000-0000-4000-8000-000000000000",
    version: 1,
    status: "in_progress",
    title: "Design",
    slashCommand: "/shipwright-design",
    prerequisites: [],
    executionCount: 0,
    createdAt: "2026-07-10T00:00:00Z",
    ...over,
  };
}

export function runConfig(phase_tasks: PhaseTask[]): RunConfigV2 {
  return {
    schemaVersion: 2,
    runId: "run-a1b2c3d4",
    scope: "full_app",
    autonomy: "guided",
    mode: "single_session",
    deploy_target: "none",
    pipeline: ["project", "design", "plan", "build", "test", "changelog", "deploy"],
    runConditions: {} as RunConfigV2["runConditions"],
    splits_frozen: [],
    status: "in_progress",
    completed_phase_task_ids: [],
    phase_tasks,
    created_at: "2026-07-10T00:00:00Z",
  };
}

export const okDesignReader = (): Promise<RunConfigReadResult> =>
  Promise.resolve({
    status: "ok",
    config: runConfig([phaseTask({ phaseTaskId: "ptk-design" })]),
    diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
  });

/** The exact bytes the emitted viewer's exportFeedback() produces (em-dash,
 *  Round 1) — the contract shape the Option-B reader parses. */
export const VIEWER_MD = [
  "# Design Feedback — Round 1",
  "",
  "> Exported: 2026-07-10",
  "",
  "## Summary",
  "",
  "| Status | Count |",
  "|--------|-------|",
  "| Approved | 1 |",
  "| Changes Requested | 1 |",
  "| Rejected | 0 |",
  "| Total Reviewed | 2 / 3 |",
  "",
  "## Core",
  "",
  "### #01 Dashboard — CHANGES",
  "",
  "**File:** screens/01-dashboard.html  ",
  "**FRs:** FR-01.09",
  "",
  "Tighten the header spacing.",
  "",
  "---",
  "",
  "### #02 Settings — APPROVED",
  "",
  "**File:** screens/02-settings.html  ",
  "**FRs:** FR-01.10",
  "",
  "---",
  "",
].join("\n");

export function makeApp(
  dir: string,
  opts: {
    reader?: (p: string) => Promise<RunConfigReadResult>;
    project?: ExternalRouteProjectView | null;
  } = {},
): Hono {
  const project: ExternalRouteProjectView | null =
    opts.project === undefined
      ? { id: PROJECT_ID, name: "test", path: dir }
      : opts.project;
  const app = new Hono();
  app.route(
    "/",
    createDesignReviewRouter({
      getProjectById: (id) => (project && id === PROJECT_ID ? project : undefined),
      readRunConfig:
        opts.reader ?? (async () => ({ status: "missing" }) satisfies RunConfigReadResult),
    }),
  );
  return app;
}

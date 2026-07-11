import { describe, it, expect, vi } from "vitest";

import { continuePipeline } from "./useContinuePipeline";
import type { Project } from "../types";
import type {
  PhaseTask,
  RunConfigResponse,
} from "../lib/run-config-v2";

const PROJECT: Project = {
  id: "p-test",
  name: "Test",
  path: "/projects/test",
  synthesized: false,
} as Project;

const PHASE_TASK_AWAITING: PhaseTask = {
  phaseTaskId: "ptk-cccc",
  phase: "build",
  splitId: "01-core",
  sessionUuid: "33333333-4444-4555-8666-777777777777",
  version: 1,
  status: "awaiting_launch",
  title: "Run-a1b2 / build / 01-core",
  slashCommand: "/shipwright-build",
  prerequisites: ["ptk-bbbb"],
  executionCount: 0,
  createdAt: "2026-04-25T09:50:01.000Z",
};

function okConfig(overrides: Partial<RunConfigResponse> = {}): RunConfigResponse {
  // Deep-clone so per-test mutations don't bleed across tests via shared
  // refs (PHASE_TASK_AWAITING was a top-level const used in two arrays).
  const cloned: PhaseTask = JSON.parse(JSON.stringify(PHASE_TASK_AWAITING));
  return {
    status: "ok",
    config: {
      schemaVersion: 2,
      runId: "run-a1b2c3d4",
      scope: "full_app",
      autonomy: "guided",
      deploy_target: "jelastic-dev",
      pipeline: ["project", "design", "plan", "build", "test", "changelog", "deploy"],
      runConditions: {
        securityEnabled: false,
        splitMode: "per_split",
        aikidoClientIdPresent: false,
      },
      splits_frozen: ["01-core"],
      status: "in_progress",
      completed_phase_task_ids: ["ptk-bbbb"],
      phase_tasks: [cloned],
      created_at: "2026-04-25T08:00:00.000Z",
    },
    readyToLaunchTasks: [cloned],
    diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
    ...overrides,
  } as RunConfigResponse;
}

describe("continuePipeline (imperative)", () => {
  it("happy path: refetches config, creates shadow, launches, copies command", async () => {
    const fetchRunConfig = vi.fn().mockResolvedValue(okConfig());
    const create = vi
      .fn()
      .mockResolvedValue({ taskId: "task-1", sessionUuid: PHASE_TASK_AWAITING.sessionUuid });
    const launch = vi.fn().mockResolvedValue({
      task: { taskId: "task-1" },
      commands: {
        powershell: "ps-cmd",
        cmd: "cmd-cmd",
        posix: "posix-cmd",
      },
    });
    const clipboard = vi.fn().mockResolvedValue(undefined);

    const result = await continuePipeline(
      { project: PROJECT, phaseTaskId: "ptk-cccc" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { fetchRunConfig, create: create as any, launch: launch as any, clipboard, platform: "posix" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.taskId).toBe("task-1");
    expect(result.copyText).toBe("posix-cmd");
    expect(result.platform).toBe("posix");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        phaseTaskId: "ptk-cccc",
        runId: "run-a1b2c3d4",
        sessionUuid: PHASE_TASK_AWAITING.sessionUuid,
        parentRunMaster: false,
      }),
    );
    expect(launch).toHaveBeenCalledWith("task-1", {
      phaseTaskRef: { phaseTaskId: "ptk-cccc" },
    });
    expect(clipboard).toHaveBeenCalledWith("posix-cmd");
  });

  it("defaults to readyToLaunchTasks[0] when phaseTaskId is omitted", async () => {
    const fetchRunConfig = vi.fn().mockResolvedValue(okConfig());
    const create = vi.fn().mockResolvedValue({ taskId: "t" });
    const launch = vi.fn().mockResolvedValue({
      task: { taskId: "t" },
      commands: { powershell: "p", cmd: "c", posix: "x" },
    });
    const clipboard = vi.fn().mockResolvedValue(undefined);

    const result = await continuePipeline(
      { project: PROJECT },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { fetchRunConfig, create: create as any, launch: launch as any, clipboard, platform: "windows" },
    );
    expect(result.ok).toBe(true);
  });

  it("returns no_run_config when status is missing/v1_legacy/invalid", async () => {
    for (const cfg of [
      { status: "missing" } as RunConfigResponse,
      { status: "v1_legacy" } as RunConfigResponse,
      { status: "invalid", reason: "bad" } as RunConfigResponse,
    ]) {
      const fetchRunConfig = vi.fn().mockResolvedValue(cfg);
      const result = await continuePipeline(
        { project: PROJECT },
        {
          fetchRunConfig,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: vi.fn() as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          launch: vi.fn() as any,
          clipboard: vi.fn(),
          platform: "posix",
        },
      );
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe("no_run_config");
    }
  });

  it("returns phase_task_not_found for an unknown phaseTaskId", async () => {
    const fetchRunConfig = vi.fn().mockResolvedValue(okConfig());
    const result = await continuePipeline(
      { project: PROJECT, phaseTaskId: "ptk-nope" },
      {
        fetchRunConfig,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: vi.fn() as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        launch: vi.fn() as any,
        clipboard: vi.fn(),
        platform: "posix",
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("phase_task_not_found");
  });

  it("returns phase_task_not_actionable when status != awaiting_launch", async () => {
    const cfg = okConfig();
    if (cfg.status === "ok") {
      cfg.config.phase_tasks[0].status = "in_progress";
    }
    const fetchRunConfig = vi.fn().mockResolvedValue(cfg);
    const result = await continuePipeline(
      { project: PROJECT, phaseTaskId: "ptk-cccc" },
      {
        fetchRunConfig,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: vi.fn() as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        launch: vi.fn() as any,
        clipboard: vi.fn(),
        platform: "posix",
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("phase_task_not_actionable");
  });

  it("returns phase_task_prereq_not_met when prereq is missing from completed list", async () => {
    const cfg = okConfig();
    if (cfg.status === "ok") {
      cfg.config.completed_phase_task_ids = []; // ptk-bbbb not completed
    }
    const fetchRunConfig = vi.fn().mockResolvedValue(cfg);
    const result = await continuePipeline(
      { project: PROJECT, phaseTaskId: "ptk-cccc" },
      {
        fetchRunConfig,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: vi.fn() as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        launch: vi.fn() as any,
        clipboard: vi.fn(),
        platform: "posix",
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("phase_task_prereq_not_met");
  });

  it("returns launch_failed when /launch throws", async () => {
    const fetchRunConfig = vi.fn().mockResolvedValue(okConfig());
    const create = vi.fn().mockResolvedValue({ taskId: "task-1" });
    const launch = vi.fn().mockRejectedValue(new Error("server 500"));
    const result = await continuePipeline(
      { project: PROJECT, phaseTaskId: "ptk-cccc" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { fetchRunConfig, create: create as any, launch: launch as any, clipboard: vi.fn(), platform: "posix" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("launch_failed");
    expect(result.detail).toContain("server 500");
  });
});
// runConfigPollIntervalMs unit tests now live in useRunConfig.test.ts (with the
// unit under test), including the F15 keep-polling-on-transient-invalid case.

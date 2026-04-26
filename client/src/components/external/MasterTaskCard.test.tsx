/*
 * MasterTaskCard rendering tests.
 *
 * The component pulls from `useContinuePipeline` (which reaches the
 * QueryClient) so we wrap each render in a QueryClientProvider +
 * MemoryRouter. We don't actually click Continue here — that flow is
 * tested in the imperative useContinuePipeline.test.ts. This file
 * focuses on what renders for each run-config status.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { MasterTaskCard } from "./MasterTaskCard";
import type { Project } from "../../types";
import type { PhaseTask, RunConfigV2 } from "../../lib/run-config-v2";

const PROJECT: Project = {
  id: "p-test",
  name: "Test",
  path: "/projects/test",
  synthesized: false,
} as Project;

function makeConfig(overrides: Partial<RunConfigV2> = {}): RunConfigV2 {
  const phaseTasks: PhaseTask[] = [
    {
      phaseTaskId: "ptk-aaaa",
      phase: "project",
      splitId: null,
      sessionUuid: "11111111-2222-4333-8444-555555555555",
      version: 1,
      status: "done",
      title: "Run-a1b2 / project",
      slashCommand: "/shipwright-project",
      prerequisites: [],
      executionCount: 1,
      createdAt: "2026-04-25T08:00:00.000Z",
    },
    {
      phaseTaskId: "ptk-bbbb",
      phase: "build",
      splitId: "01-core",
      sessionUuid: "22222222-3333-4444-8555-666666666666",
      version: 1,
      status: "awaiting_launch",
      title: "Run-a1b2 / build / 01-core",
      slashCommand: "/shipwright-build",
      prerequisites: ["ptk-aaaa"],
      executionCount: 0,
      createdAt: "2026-04-25T09:00:00.000Z",
    },
  ];
  return {
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
    completed_phase_task_ids: ["ptk-aaaa"],
    phase_tasks: phaseTasks,
    created_at: "2026-04-25T08:00:00.000Z",
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderCard(props: {
  config: RunConfigV2;
  ready?: PhaseTask[];
  diagnostics?: { droppedPhaseTaskIds: string[]; warnings: string[] };
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MasterTaskCard
          project={PROJECT}
          config={props.config}
          readyToLaunchTasks={
            props.ready ?? props.config.phase_tasks.filter((t) => t.status === "awaiting_launch")
          }
          diagnostics={props.diagnostics ?? { droppedPhaseTaskIds: [], warnings: [] }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MasterTaskCard", () => {
  it("renders Run-<short> label + in_progress status pill", () => {
    renderCard({ config: makeConfig() });
    expect(screen.getByText("Run-a1b2")).toBeInTheDocument();
    expect(
      screen.getByTestId("master-card-run-status-in_progress"),
    ).toBeInTheDocument();
  });

  it("renders one row per phase_task with phase + splitId + sessionUuid suffix", () => {
    renderCard({ config: makeConfig() });
    expect(screen.getByTestId("master-card-row-ptk-aaaa")).toBeInTheDocument();
    expect(screen.getByTestId("master-card-row-ptk-bbbb")).toBeInTheDocument();
    // splitId surface: build row has " / 01-core" rendered.
    expect(screen.getByTestId("master-card-row-ptk-bbbb").textContent).toContain("01-core");
    // last 8 chars of the awaiting_launch sessionUuid.
    expect(screen.getByTestId("master-card-row-ptk-bbbb").textContent).toContain("66666666");
  });

  it("renders a Continue button on awaiting_launch rows only", () => {
    renderCard({ config: makeConfig() });
    expect(screen.getByTestId("master-card-continue-ptk-bbbb")).toBeInTheDocument();
    expect(screen.queryByTestId("master-card-continue-ptk-aaaa")).toBeNull();
  });

  it("surfaces dropped-row diagnostics as a banner", () => {
    renderCard({
      config: makeConfig(),
      diagnostics: { droppedPhaseTaskIds: ["ptk-bad1"], warnings: [] },
    });
    expect(
      screen.getByTestId("master-card-diagnostics-run-a1b2c3d4"),
    ).toBeInTheDocument();
  });

  it("renders failure banner with recover snippets when run.status === failed", () => {
    const cfg = makeConfig({
      status: "failed",
      phase_tasks: [
        {
          phaseTaskId: "ptk-aaaa",
          phase: "project",
          splitId: null,
          sessionUuid: "11111111-2222-4333-8444-555555555555",
          version: 1,
          status: "done",
          title: "done",
          slashCommand: "/shipwright-project",
          prerequisites: [],
          executionCount: 1,
          createdAt: "2026-04-25T08:00:00.000Z",
        },
        {
          phaseTaskId: "ptk-fail1",
          phase: "test",
          splitId: null,
          sessionUuid: "55555555-6666-4777-8888-999999999999",
          version: 1,
          status: "failed",
          title: "failed",
          slashCommand: "/shipwright-test",
          prerequisites: [],
          executionCount: 1,
          createdAt: "2026-04-25T09:00:00.000Z",
        },
      ],
    });
    renderCard({ config: cfg });
    expect(
      screen.getByTestId("master-card-failed-run-a1b2c3d4"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("recover-snippet-ptk-fail1")).toBeInTheDocument();
  });

  it("renders needs_validation banner with --force-status skipped snippets", () => {
    const cfg = makeConfig({
      status: "needs_validation",
      phase_tasks: [
        {
          phaseTaskId: "ptk-stuck",
          phase: "test",
          splitId: null,
          sessionUuid: "55555555-6666-4777-8888-999999999999",
          version: 1,
          status: "in_progress",
          title: "stuck",
          slashCommand: "/shipwright-test",
          prerequisites: [],
          executionCount: 1,
          createdAt: "2026-04-25T08:00:00.000Z",
        },
      ],
    });
    renderCard({ config: cfg });
    expect(
      screen.getByTestId("master-card-needs-validation-run-a1b2c3d4"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("recover-snippet-ptk-stuck")).toBeInTheDocument();
  });

  it("renders complete banner with deploy artifacts list", () => {
    const cfg = makeConfig({
      status: "complete",
      completed_phase_task_ids: ["ptk-deploy"],
      phase_tasks: [
        {
          phaseTaskId: "ptk-deploy",
          phase: "deploy",
          splitId: null,
          sessionUuid: "55555555-6666-4777-8888-999999999999",
          version: 1,
          status: "done",
          title: "deploy",
          slashCommand: "/shipwright-deploy",
          prerequisites: [],
          executionCount: 1,
          createdAt: "2026-04-25T08:00:00.000Z",
          result: { ok: true, artifacts: ["https://app.dev.example.com"] },
        },
      ],
    });
    renderCard({ config: cfg });
    expect(
      screen.getByTestId("master-card-complete-run-a1b2c3d4"),
    ).toBeInTheDocument();
    expect(screen.getByText("https://app.dev.example.com")).toBeInTheDocument();
  });

  it("renders stale banner when in_progress phase_task started > 1h ago AND config not recently updated", () => {
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    const cfg = makeConfig({
      status: "in_progress",
      updated_at: longAgo,
      phase_tasks: [
        {
          phaseTaskId: "ptk-stale",
          phase: "build",
          splitId: null,
          sessionUuid: "55555555-6666-4777-8888-999999999999",
          version: 1,
          status: "in_progress",
          title: "stale",
          slashCommand: "/shipwright-build",
          prerequisites: [],
          executionCount: 1,
          createdAt: longAgo,
          startedAt: longAgo,
        },
      ],
    });
    renderCard({ config: cfg });
    expect(
      screen.getByTestId("master-card-stale-run-a1b2c3d4"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("recover-snippet-ptk-stale")).toBeInTheDocument();
  });

  it("does NOT render stale banner when config.updated_at is recent (orchestrator alive)", () => {
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const cfg = makeConfig({
      status: "in_progress",
      updated_at: new Date().toISOString(),
      phase_tasks: [
        {
          phaseTaskId: "ptk-running",
          phase: "build",
          splitId: null,
          sessionUuid: "55555555-6666-4777-8888-999999999999",
          version: 1,
          status: "in_progress",
          title: "running",
          slashCommand: "/shipwright-build",
          prerequisites: [],
          executionCount: 1,
          createdAt: longAgo,
          startedAt: longAgo,
        },
      ],
    });
    renderCard({ config: cfg });
    expect(
      screen.queryByTestId("master-card-stale-run-a1b2c3d4"),
    ).toBeNull();
  });
});

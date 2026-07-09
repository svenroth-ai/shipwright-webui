import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { SingleSessionRunCard } from "./SingleSessionRunCard";
import type { Project } from "../../types";
import type {
  PhaseTask,
  PhaseTaskStatus,
  RunConfigDiagnostics,
  RunConfigV2,
  RunPhase,
  RunStatus,
} from "../../lib/run-config-v2";

// Stub the CTA so the card is tested in isolation (its own deps are covered by
// MasterRunLaunchButton.test.tsx).
vi.mock("./MasterRunLaunchButton", () => ({
  MasterRunLaunchButton: () => <div data-testid="stub-cta" />,
}));

const RUN_ID = "run-a1b2c3d4";
const PROJECT: Project = {
  id: "p1", name: "proj", path: "/proj", profile: "node",
  status: "active", lastActive: "", createdAt: "",
};

let seq = 0;
function pt(phase: string, status: PhaseTaskStatus, splitId: string | null = null): PhaseTask {
  seq += 1;
  return {
    phaseTaskId: `ptk-${seq.toString(16).padStart(4, "0")}`,
    phase: phase as RunPhase,
    splitId,
    sessionUuid: `u-${seq}`,
    version: 1,
    status,
    title: `${phase} task`,
    slashCommand: `/shipwright-${phase}`,
    prerequisites: [],
    executionCount: 0,
    createdAt: "2026-07-09T00:00:00.000Z",
  };
}

const SEVEN: RunPhase[] = ["project", "design", "plan", "build", "test", "changelog", "deploy"];

function makeConfig(o: Partial<RunConfigV2> = {}): RunConfigV2 {
  return {
    schemaVersion: 2,
    runId: RUN_ID,
    scope: "full_app",
    autonomy: "guided",
    mode: "single_session",
    deploy_target: "none",
    pipeline: SEVEN,
    runConditions: { securityEnabled: false, splitMode: null, aikidoClientIdPresent: false },
    splits_frozen: [],
    status: "in_progress" as RunStatus,
    completed_phase_task_ids: [],
    phase_tasks: [],
    created_at: "2026-07-09T00:00:00.000Z",
    ...o,
  };
}

const NO_DIAG: RunConfigDiagnostics = { droppedPhaseTaskIds: [], warnings: [] };

function renderCard(config: RunConfigV2, diagnostics: RunConfigDiagnostics = NO_DIAG) {
  return render(<SingleSessionRunCard project={PROJECT} config={config} diagnostics={diagnostics} />);
}

describe("SingleSessionRunCard", () => {
  it("renders the run label, status badge and N/total phase progress", () => {
    renderCard(makeConfig({ phase_tasks: [pt("project", "done"), pt("design", "in_progress")] }));
    expect(screen.getByTestId(`single-session-run-card-${RUN_ID}`)).toHaveAttribute("data-run-status", "in_progress");
    expect(screen.getByTestId(`single-session-run-status-in_progress`)).toBeInTheDocument();
    // frontier = design → 1 phase behind, denominator 7
    expect(screen.getByTestId(`single-session-progress-${RUN_ID}`)).toHaveTextContent("1/7");
  });

  it("renders one checklist row per phase_task (the real, growing list) with its status", () => {
    const tasks = [
      pt("project", "done"),
      pt("build", "in_progress", "split-0"),
      pt("build", "backlog", "split-1"),
    ];
    renderCard(makeConfig({ phase_tasks: tasks }));
    for (const t of tasks) {
      const row = screen.getByTestId(`single-session-phase-${t.phaseTaskId}`);
      expect(row).toHaveAttribute("data-status", t.status);
    }
    // splitId is shown on the fanned-out rows.
    expect(screen.getByTestId(`single-session-phase-${tasks[1].phaseTaskId}`)).toHaveTextContent("split-0");
  });

  it("shows a selective status note for in_progress / awaiting_launch / failed rows", () => {
    const { container } = renderCard(
      makeConfig({
        phase_tasks: [
          pt("project", "done"),
          pt("design", "in_progress"),
          pt("plan", "awaiting_launch"),
          pt("build", "failed"),
          pt("test", "backlog"),
        ],
      }),
    );
    // Scope to the phase ROW (the run-status badge also says "in progress").
    expect(container.querySelector('[data-status="in_progress"]')).toHaveTextContent("in progress");
    expect(container.querySelector('[data-status="awaiting_launch"]')).toHaveTextContent("awaiting launch");
    expect(container.querySelector('[data-status="failed"]')).toHaveTextContent("failed");
    // done + backlog carry no status note (icon + struck-through title convey them).
    expect(container.querySelector('[data-status="done"]')?.textContent).toBe("project");
    expect(container.querySelector('[data-status="backlog"]')?.textContent).toBe("test");
  });

  it("has NO per-phase Continue button (the multi-session anti-pattern it replaces)", () => {
    renderCard(makeConfig({ phase_tasks: [pt("project", "awaiting_launch")] }));
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    expect(screen.queryByText("Continue")).toBeNull();
  });

  it("renders the single Launch/Resume CTA", () => {
    renderCard(makeConfig({ phase_tasks: [pt("project", "in_progress")] }));
    expect(screen.getByTestId("stub-cta")).toBeInTheDocument();
  });

  it("shows an empty-state note when there are no phase tasks yet", () => {
    renderCard(makeConfig({ phase_tasks: [] }));
    expect(screen.getByText(/no phase tasks yet/i)).toBeInTheDocument();
  });

  it("shows a diagnostics banner when readers dropped phase_task rows", () => {
    renderCard(makeConfig(), { droppedPhaseTaskIds: ["ptk-bad"], warnings: [] });
    expect(screen.getByTestId(`single-session-diagnostics-${RUN_ID}`)).toHaveTextContent("1 phase_task");
  });

  it("a complete run shows 7/7 and 100% progress", () => {
    renderCard(makeConfig({ status: "complete", phase_tasks: [pt("project", "done")] }));
    expect(screen.getByTestId(`single-session-progress-${RUN_ID}`)).toHaveTextContent("7/7");
  });
});

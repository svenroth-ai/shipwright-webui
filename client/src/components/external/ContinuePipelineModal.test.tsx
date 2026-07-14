import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { ContinuePipelineModal } from "./ContinuePipelineModal";
import type { Project } from "../../types";
import type { PhaseTask, RunConfigResponse } from "../../lib/run-config-v2";

const PROJECT: Project = {
  id: "p-test",
  name: "Test",
  path: "/projects/test",
  synthesized: false,
} as Project;

const PHASE_TASK_BUILD: PhaseTask = {
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
  createdAt: "2026-04-25T09:00:00.000Z",
};

const PHASE_TASK_PLAN_2: PhaseTask = {
  phaseTaskId: "ptk-dddd",
  phase: "plan",
  splitId: "02-ui-shell",
  sessionUuid: "44444444-5555-4666-8777-888888888888",
  version: 1,
  status: "awaiting_launch",
  title: "Run-a1b2 / plan / 02-ui-shell",
  slashCommand: "/shipwright-plan",
  prerequisites: ["ptk-aaaa"],
  executionCount: 0,
  createdAt: "2026-04-25T09:00:00.000Z",
};

function okConfig(ready: PhaseTask[]): RunConfigResponse {
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
      splits_frozen: ["01-core", "02-ui-shell"],
      status: "in_progress",
      completed_phase_task_ids: ["ptk-aaaa", "ptk-bbbb"],
      phase_tasks: ready,
      created_at: "2026-04-25T08:00:00.000Z",
    },
    readyToLaunchTasks: ready,
    diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
  };
}

function renderModal(props: {
  open?: boolean;
  runConfig: RunConfigResponse | undefined;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ContinuePipelineModal
          open={props.open ?? true}
          onOpenChange={() => {}}
          project={PROJECT}
          runConfig={props.runConfig}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ContinuePipelineModal", () => {
  /* This dialog had copied the scroll-body class string WITHOUT the guard; it
   * now inherits it from <ModalScrollBody>. Fence proves the class reaches the
   * DOM (jsdom cannot assert the layout). Why: components/common/ModalScrollBody.tsx. */
  it("scroll body inherits the bounded-scroll-container guard from ModalScrollBody", () => {
    renderModal({ runConfig: okConfig([PHASE_TASK_BUILD]) });
    const body = screen.getByTestId("continue-pipeline-body");
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("[&>*]:shrink-0");
    expect(body.className).toContain("max-h-[calc(100vh-280px)]");
  });

  it("renders an empty state when run-config is missing/v1/invalid", () => {
    renderModal({ runConfig: { status: "missing" } });
    expect(screen.getByTestId("continue-pipeline-empty")).toBeInTheDocument();
  });

  it("renders 'nothing to continue' when readyToLaunchTasks is empty", () => {
    renderModal({ runConfig: okConfig([]) });
    expect(screen.getByTestId("continue-pipeline-empty")).toBeInTheDocument();
    const launch = screen.getByTestId(
      "continue-pipeline-launch-btn",
    ) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
  });

  it("auto-selects the single ready task and shows its slashCommand + uuid suffix", () => {
    renderModal({ runConfig: okConfig([PHASE_TASK_BUILD]) });
    const single = screen.getByTestId(
      "continue-pipeline-single-ptk-cccc",
    );
    expect(single).toBeInTheDocument();
    expect(single.textContent).toContain("/shipwright-build");
    expect(single.textContent).toContain("77777777"); // last 8 chars
    const launch = screen.getByTestId(
      "continue-pipeline-launch-btn",
    ) as HTMLButtonElement;
    expect(launch.disabled).toBe(false);
  });

  it("renders a radio list when multiple awaiting_launch tasks are ready", () => {
    renderModal({
      runConfig: okConfig([PHASE_TASK_BUILD, PHASE_TASK_PLAN_2]),
    });
    expect(
      screen.getByTestId("continue-pipeline-option-ptk-cccc"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("continue-pipeline-option-ptk-dddd"),
    ).toBeInTheDocument();
  });

  it("shows 'Launching…' label state via the button while submitting (smoke render)", () => {
    // Just verify the static initial state — submitting is exercised by
    // useContinuePipeline.test.ts's launch_failed branch. Here we just
    // confirm the button label is correct in the not-yet-submitted state.
    renderModal({ runConfig: okConfig([PHASE_TASK_BUILD]) });
    expect(
      screen.getByTestId("continue-pipeline-launch-btn").textContent,
    ).toContain("Launch");
  });
});

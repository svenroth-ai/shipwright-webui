/*
 * ContinuePipelineModal recovery (FR-01.61, A17) — AC5 fences:
 *   rule 14: Retry re-enters useContinuePipeline() (no parallel launch path).
 *   rule 13: a 409 phase_task_session_uuid_mismatch surfaces as a RENDERED
 *            notice, not a swallowed error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { ContinuePipelineModal } from "./ContinuePipelineModal";
import type { PhaseTask, RunConfigResponse } from "../../lib/run-config-v2";
import type { Project } from "../../types";

const continueMock = vi.fn();
vi.mock("../../hooks/useContinuePipeline", () => ({
  useContinuePipeline: () => continueMock,
}));
const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateMock,
}));

const PROJECT = { id: "p-1", name: "P", path: "/p", synthesized: false } as Project;
const READY: PhaseTask = {
  phaseTaskId: "ptk-cccc",
  phase: "build",
  splitId: "01-core",
  sessionUuid: "33333333-4444-4555-8666-777777777777",
  version: 1,
  status: "awaiting_launch",
  title: "run / build / 01-core",
  slashCommand: "/shipwright-build",
  prerequisites: [],
  executionCount: 0,
  createdAt: "2026-04-25T09:00:00.000Z",
};

function okConfig(): RunConfigResponse {
  return {
    status: "ok",
    config: {
      schemaVersion: 2, runId: "run-a1b2c3d4", scope: "full_app", autonomy: "guided",
      deploy_target: "jelastic-dev",
      pipeline: ["project", "design", "plan", "build", "test", "changelog", "deploy"],
      runConditions: { securityEnabled: false, splitMode: "per_split", aikidoClientIdPresent: false },
      splits_frozen: ["01-core"], status: "in_progress",
      completed_phase_task_ids: [], phase_tasks: [READY], created_at: "2026-04-25T08:00:00.000Z",
    },
    readyToLaunchTasks: [READY],
    diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
  };
}

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ContinuePipelineModal open onOpenChange={() => {}} project={PROJECT} runConfig={okConfig()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  continueMock.mockReset();
  navigateMock.mockReset();
});

describe("ContinuePipelineModal — recovery fences", () => {
  it("rule 13: a phase_task_session_uuid_mismatch renders a code-specific Refresh notice", async () => {
    continueMock.mockResolvedValue({
      ok: false,
      reason: "launch_failed",
      detail: 'HTTP 409 /api/external/tasks/t/launch: {"error":"phase_task_session_uuid_mismatch"}',
    });
    renderModal();
    fireEvent.click(screen.getByTestId("continue-pipeline-launch-btn"));
    const notice = await screen.findByTestId("continue-pipeline-failure");
    expect(notice).toHaveAttribute("data-launch-failure-code", "phase_task_session_uuid_mismatch");
    expect(screen.getByTestId("continue-pipeline-failure-refresh")).toBeInTheDocument();
    // not retryable via a plain re-launch — no Retry button for a mismatch
    expect(screen.queryByTestId("continue-pipeline-failure-retry")).toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("rule 14: Retry RE-ENTERS useContinuePipeline (never a hand-rolled launch path)", async () => {
    continueMock.mockResolvedValue({ ok: false, reason: "launch_failed", detail: "boom" });
    renderModal();
    fireEvent.click(screen.getByTestId("continue-pipeline-launch-btn"));
    await waitFor(() => expect(continueMock).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByTestId("continue-pipeline-failure-retry"));
    await waitFor(() => expect(continueMock).toHaveBeenCalledTimes(2));
    // same funnel, same target — the retry is the SAME call, re-entered.
    expect(continueMock).toHaveBeenLastCalledWith({ project: PROJECT, phaseTaskId: "ptk-cccc" });
  });
});

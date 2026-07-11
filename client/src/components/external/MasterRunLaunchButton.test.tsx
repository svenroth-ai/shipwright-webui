import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { MasterRunLaunchButton } from "./MasterRunLaunchButton";
import type { Project } from "../../types";
import type { ExternalTask } from "../../lib/externalApi";
import type { RunConfigV2, RunStatus } from "../../lib/run-config-v2";

// ── mocks ────────────────────────────────────────────────────────────────
const launchMasterRunMock = vi.fn();
vi.mock("../../hooks/useLaunchMasterRun", async (importOriginal) => ({
  // Keep the real `masterShadowIsEstablished` (the label predicate under test);
  // stub only the hook so no network/query-client is needed.
  ...(await importOriginal<typeof import("../../hooks/useLaunchMasterRun")>()),
  useLaunchMasterRun: () => launchMasterRunMock,
}));

let taskList: ExternalTask[] = [];
vi.mock("../../hooks/useExternalTasks", () => ({
  useExternalTasks: () => ({ data: taskList }),
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateMock,
}));

const RUN_ID = "run-a1b2c3d4";
const TESTID = `master-run-launch-${RUN_ID}`;

const PROJECT: Project = {
  id: "p1", name: "proj", path: "/proj", profile: "node",
  status: "active", lastActive: "", createdAt: "",
};

function makeConfig(status: RunStatus = "in_progress"): RunConfigV2 {
  return {
    schemaVersion: 2,
    runId: RUN_ID,
    scope: "full_app",
    autonomy: "guided",
    mode: "single_session",
    deploy_target: "none",
    pipeline: ["project", "design", "plan", "build", "test", "changelog", "deploy"],
    runConditions: { securityEnabled: false, splitMode: null, aikidoClientIdPresent: false },
    splits_frozen: [],
    status,
    completed_phase_task_ids: [],
    phase_tasks: [],
    created_at: "2026-07-09T00:00:00.000Z",
  };
}

function masterShadow(o: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "master-1",
    sessionUuid: "u-master",
    cwd: "/proj",
    pluginDirs: [],
    title: "Run-a1b2 master",
    projectId: "p1",
    state: "awaiting_external_start",
    createdAt: "",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    parentRunMaster: true,
    runId: RUN_ID,
    ...o,
  };
}

function renderBtn(config: RunConfigV2, project: Project | null = PROJECT) {
  return render(<MasterRunLaunchButton config={config} project={project} />);
}

describe("MasterRunLaunchButton", () => {
  beforeEach(() => {
    launchMasterRunMock.mockReset();
    navigateMock.mockReset();
    taskList = [];
    launchMasterRunMock.mockResolvedValue({
      ok: true, taskId: "t-9", commands: {}, reused: false, resume: false,
    });
  });

  it("renders NOTHING for a terminal (complete) run", () => {
    const { container } = renderBtn(makeConfig("complete"));
    expect(container.querySelector(`[data-testid="${TESTID}"]`)).toBeNull();
  });

  it("renders NOTHING for a terminal (failed) run", () => {
    const { container } = renderBtn(makeConfig("failed"));
    expect(container.querySelector(`[data-testid="${TESTID}"]`)).toBeNull();
  });

  it("labels the button 'Launch' when there is no master shadow yet", () => {
    renderBtn(makeConfig());
    const btn = screen.getByTestId(TESTID);
    expect(btn).toHaveTextContent("Launch");
    expect(btn).toHaveAttribute("data-mode", "launch");
  });

  it("labels the button 'Launch' when a master shadow exists but its JSONL is not yet observed", () => {
    taskList = [masterShadow({ firstJsonlObservedAt: undefined })];
    renderBtn(makeConfig());
    expect(screen.getByTestId(TESTID)).toHaveTextContent("Launch");
  });

  it("labels the button 'Resume' when the master shadow has an observed JSONL", () => {
    taskList = [masterShadow({ firstJsonlObservedAt: "2026-07-09T00:00:00Z" })];
    renderBtn(makeConfig());
    const btn = screen.getByTestId(TESTID);
    expect(btn).toHaveTextContent("Resume");
    expect(btn).toHaveAttribute("data-mode", "resume");
  });

  it("D18/F14: labels 'Resume' when the JSONL is LIVE-observed (lastJsonlSeenMtimeMs) before the stamp lands", () => {
    // GET /tasks overlays a live lastJsonlSeenMtimeMs the instant the transcript
    // hits disk — before firstJsonlObservedAt is stamped. The label must track
    // that disk truth so it matches the server's --resume launch decision.
    taskList = [masterShadow({ firstJsonlObservedAt: undefined, lastJsonlSeenMtimeMs: Date.now() })];
    renderBtn(makeConfig());
    const btn = screen.getByTestId(TESTID);
    expect(btn).toHaveTextContent("Resume");
    expect(btn).toHaveAttribute("data-mode", "resume");
  });

  it("ignores a shadow for a DIFFERENT run when picking the label", () => {
    taskList = [masterShadow({ runId: "run-99999999", firstJsonlObservedAt: "2026-07-09T00:00:00Z" })];
    renderBtn(makeConfig());
    expect(screen.getByTestId(TESTID)).toHaveTextContent("Launch");
  });

  it("launches with { project, config, tasks } and navigates on success", async () => {
    taskList = [masterShadow({ firstJsonlObservedAt: undefined })];
    renderBtn(makeConfig());
    fireEvent.click(screen.getByTestId(TESTID));
    await waitFor(() =>
      expect(launchMasterRunMock).toHaveBeenCalledWith({
        project: { id: "p1", path: "/proj" },
        config: { runId: RUN_ID },
        tasks: taskList,
      }),
    );
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/tasks/t-9"));
  });

  it("is disabled and never launches when no project resolves", () => {
    renderBtn(makeConfig(), null);
    const btn = screen.getByTestId(TESTID);
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(launchMasterRunMock).not.toHaveBeenCalled();
  });

  it("surfaces an inline error when the launch fails", async () => {
    launchMasterRunMock.mockResolvedValue({ ok: false, reason: "launch_failed", detail: "master_run_already_attached" });
    renderBtn(makeConfig());
    fireEvent.click(screen.getByTestId(TESTID));
    expect(await screen.findByTestId(`master-run-launch-error-${RUN_ID}`)).toHaveTextContent(
      "master_run_already_attached",
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

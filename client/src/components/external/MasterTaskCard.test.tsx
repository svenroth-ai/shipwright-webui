/*
 * MasterTaskCard rendering tests.
 *
 * The component pulls from `useContinuePipeline` (which reaches the
 * QueryClient) so we wrap each render in a QueryClientProvider +
 * MemoryRouter. We don't actually click Continue here — that flow is
 * tested in the imperative useContinuePipeline.test.ts. This file
 * focuses on what renders for each run-config status.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";

// Stub useContinuePipeline for the navigation tests so clicking the
// Continue button doesn't kick off a real fetch/clipboard chain that
// outlives the test (causing the "test environment was torn down"
// warning). The hook's behaviour is exercised end-to-end in
// useContinuePipeline.test.ts.
vi.mock("../../hooks/useContinuePipeline", () => ({
  useContinuePipeline: () => async () => ({
    ok: false as const,
    reason: "no_run_config" as const,
  }),
}));

import { MasterTaskCard } from "./MasterTaskCard";
import { server } from "../../test/mocks/server";
import type { Project } from "../../types";
import type { PhaseTask, RunConfigV2 } from "../../lib/run-config-v2";
import type { ExternalTask } from "../../lib/externalApi";

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

describe("MasterTaskCard — child row navigation (shadow lookup)", () => {
  // Probe component reads useLocation so tests can assert navigation.
  function LocationProbe() {
    const loc = useLocation();
    return <div data-testid="probe-location">{loc.pathname}</div>;
  }

  function renderWithLocation(props: {
    config: RunConfigV2;
    shadowTasks: Array<{ taskId: string; sessionUuid: string }>;
  }) {
    server.use(
      http.get("/api/external/tasks", () =>
        HttpResponse.json({
          tasks: props.shadowTasks.map((t) => ({
            taskId: t.taskId,
            sessionUuid: t.sessionUuid,
            cwd: "/proj",
            pluginDirs: [],
            title: "shadow",
            projectId: PROJECT.id,
            state: "active",
            createdAt: "2026-04-25T08:00:00.000Z",
            inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
          })),
        }),
      ),
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route
              path="/"
              element={
                <>
                  <MasterTaskCard
                    project={PROJECT}
                    config={props.config}
                    readyToLaunchTasks={props.config.phase_tasks.filter(
                      (t) => t.status === "awaiting_launch",
                    )}
                    diagnostics={{ droppedPhaseTaskIds: [], warnings: [] }}
                  />
                  <LocationProbe />
                </>
              }
            />
            <Route path="/tasks/:id" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("renders rows with data-navigable=true when a shadow task matches the sessionUuid", async () => {
    const cfg = makeConfig();
    renderWithLocation({
      config: cfg,
      shadowTasks: [
        {
          taskId: "task-shadow-aaaa",
          sessionUuid: cfg.phase_tasks[0].sessionUuid, // ptk-aaaa
        },
      ],
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("master-card-row-ptk-aaaa").getAttribute("data-navigable"),
      ).toBe("true");
    });
    // ptk-bbbb has no shadow → not navigable.
    expect(
      screen.getByTestId("master-card-row-ptk-bbbb").getAttribute("data-navigable"),
    ).toBe("false");
  });

  it("clicking a navigable row routes to /tasks/<shadow.taskId>", async () => {
    const cfg = makeConfig();
    renderWithLocation({
      config: cfg,
      shadowTasks: [
        {
          taskId: "task-shadow-aaaa",
          sessionUuid: cfg.phase_tasks[0].sessionUuid,
        },
      ],
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("master-card-row-ptk-aaaa").getAttribute("data-navigable"),
      ).toBe("true");
    });
    fireEvent.click(screen.getByTestId("master-card-row-ptk-aaaa"));
    await waitFor(() => {
      expect(screen.getByTestId("probe-location").textContent).toBe(
        "/tasks/task-shadow-aaaa",
      );
    });
  });

  it("Continue button click does NOT bubble to row navigation", async () => {
    const cfg = makeConfig();
    renderWithLocation({
      config: cfg,
      // Shadow exists for the awaiting_launch row too.
      shadowTasks: [
        {
          taskId: "task-shadow-bbbb",
          sessionUuid: cfg.phase_tasks[1].sessionUuid,
        },
      ],
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("master-card-row-ptk-bbbb").getAttribute("data-navigable"),
      ).toBe("true");
    });
    // Click only the Continue button. Without stopPropagation the row
    // would also navigate; we want the launch flow to take over instead.
    // Note: the launch flow itself eventually navigates too, but it
    // races against the synchronous row handler. Here we just assert
    // that the row click handler did NOT fire ahead of the launch —
    // captured by checking we did NOT go to /tasks/task-shadow-bbbb
    // immediately. We rely on jsdom's synchronous click semantics.
    fireEvent.click(screen.getByTestId("master-card-continue-ptk-bbbb"));
    // Synchronously after the click, location must still be "/" — the
    // launch flow is async so navigation hasn't happened yet, AND the
    // row's onClick was suppressed.
    expect(screen.getByTestId("probe-location").textContent).toBe("/");
  });

  it("non-navigable rows have no role=button and no tabIndex", () => {
    const cfg = makeConfig();
    renderWithLocation({
      config: cfg,
      shadowTasks: [], // no shadows at all
    });
    const row = screen.getByTestId("master-card-row-ptk-aaaa");
    expect(row.getAttribute("role")).toBeNull();
    expect(row.getAttribute("tabindex")).toBeNull();
    expect(row.getAttribute("data-navigable")).toBe("false");
  });
});

// ---------- iterate-2026-05-14 lead-foundation-task-schema ----------
//
// Render priority badge + domain chip + blockedBy indicator at the
// MasterTaskCard header level when a "master shadow" ExternalTask is
// linked to the same Run (matched by `runId === config.runId &&
// parentRunMaster === true`). The fields come from that master
// shadow's leadwright-extended `ExternalTask` record. Display-only.

describe("MasterTaskCard — lead-foundation badges (iterate-2026-05-14)", () => {
  function masterShadow(
    cfg: RunConfigV2,
    overrides: Partial<ExternalTask>,
  ): Array<Partial<ExternalTask>> {
    return [
      {
        taskId: "task-master-shadow",
        sessionUuid: cfg.phase_tasks[0].sessionUuid,
        runId: cfg.runId,
        parentRunMaster: true,
        title: "Master shadow",
        projectId: PROJECT.id,
        state: "active",
        cwd: "/proj",
        pluginDirs: [],
        createdAt: "2026-04-25T08:00:00.000Z",
        inbox: {
          pendingToolUseIds: [],
          dismissedToolUseIds: [],
          lastProcessedByteOffset: 0,
        },
        ...overrides,
      },
    ];
  }

  function renderWithShadow(shadowTasks: Array<Partial<ExternalTask>>) {
    server.use(
      http.get("/api/external/tasks", () =>
        HttpResponse.json({ tasks: shadowTasks }),
      ),
    );
    return renderCard({ config: makeConfig() });
  }

  it("renders P0 badge with the high-severity color treatment", async () => {
    const cfg = makeConfig();
    renderWithShadow(masterShadow(cfg, { priority: "P0" }));
    const badge = await screen.findByTestId(
      "master-card-priority-run-a1b2c3d4",
    );
    expect(badge.textContent).toBe("P0");
    // Severity is encoded as a data-attribute (the actual color comes
    // from CSS — test the contract, not the pixel).
    expect(badge.getAttribute("data-severity")).toBe("P0");
  });

  it("renders P1 / P2 / P3 badges with distinct data-severity values", async () => {
    const cfg = makeConfig();
    // P1
    const { rerender } = renderWithShadow(masterShadow(cfg, { priority: "P1" }));
    expect(
      (await screen.findByTestId("master-card-priority-run-a1b2c3d4")).getAttribute(
        "data-severity",
      ),
    ).toBe("P1");
    rerender(<div />); // reset

    // We use re-renders rather than re-mocking the server because each
    // renderCard sets up its own QueryClient.
    server.use(
      http.get("/api/external/tasks", () =>
        HttpResponse.json({
          tasks: masterShadow(cfg, { priority: "P2" }),
        }),
      ),
    );
    renderCard({ config: cfg });
    expect(
      (await screen.findByTestId("master-card-priority-run-a1b2c3d4")).getAttribute(
        "data-severity",
      ),
    ).toBe("P2");
  });

  it("omits the priority badge when the master shadow has no priority", async () => {
    const cfg = makeConfig();
    renderWithShadow(masterShadow(cfg, {})); // no priority
    // Allow shadow tasks to load, then assert badge is absent.
    await waitFor(() => {
      // Sanity: the card itself rendered.
      expect(screen.getByText("Run-a1b2")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("master-card-priority-run-a1b2c3d4"),
    ).toBeNull();
  });

  it("renders the domain chip as plain text (no HTML injection)", async () => {
    // External review MED-5: free-text fields render as React text nodes.
    // A `<script>` tag in `domain` must appear as escaped text, not as a
    // DOM <script> element.
    const cfg = makeConfig();
    renderWithShadow(
      masterShadow(cfg, { domain: "<script>alert('xss')</script>" }),
    );
    const chip = await screen.findByTestId(
      "master-card-domain-run-a1b2c3d4",
    );
    expect(chip.textContent).toBe("<script>alert('xss')</script>");
    // No actual script element rendered.
    expect(chip.querySelector("script")).toBeNull();
  });

  it("omits the domain chip when the master shadow has no domain", async () => {
    const cfg = makeConfig();
    renderWithShadow(masterShadow(cfg, {}));
    await waitFor(() => {
      expect(screen.getByText("Run-a1b2")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("master-card-domain-run-a1b2c3d4")).toBeNull();
  });

  it("renders blockedBy indicator: ✓ all done when every blocker is in state=done", async () => {
    const cfg = makeConfig();
    server.use(
      http.get("/api/external/tasks", () =>
        HttpResponse.json({
          tasks: [
            // Master shadow with blockedBy referencing two task ids.
            ...masterShadow(cfg, {
              blockedBy: ["task-a", "task-b"],
            }),
            { taskId: "task-a", sessionUuid: "u-a", state: "done", title: "A", projectId: PROJECT.id, cwd: "/p", pluginDirs: [], createdAt: "x", inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 } },
            { taskId: "task-b", sessionUuid: "u-b", state: "done", title: "B", projectId: PROJECT.id, cwd: "/p", pluginDirs: [], createdAt: "x", inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 } },
          ],
        }),
      ),
    );
    renderCard({ config: cfg });
    const indicator = await screen.findByTestId(
      "master-card-blocked-run-a1b2c3d4",
    );
    expect(indicator.getAttribute("data-state")).toBe("done");
  });

  it("renders blockedBy indicator: ⏳ N pending when some blockers are not done", async () => {
    const cfg = makeConfig();
    server.use(
      http.get("/api/external/tasks", () =>
        HttpResponse.json({
          tasks: [
            ...masterShadow(cfg, { blockedBy: ["task-a", "task-b", "task-c"] }),
            { taskId: "task-a", sessionUuid: "u-a", state: "done", title: "A", projectId: PROJECT.id, cwd: "/p", pluginDirs: [], createdAt: "x", inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 } },
            { taskId: "task-b", sessionUuid: "u-b", state: "active", title: "B", projectId: PROJECT.id, cwd: "/p", pluginDirs: [], createdAt: "x", inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 } },
            { taskId: "task-c", sessionUuid: "u-c", state: "draft", title: "C", projectId: PROJECT.id, cwd: "/p", pluginDirs: [], createdAt: "x", inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 } },
          ],
        }),
      ),
    );
    renderCard({ config: cfg });
    const indicator = await screen.findByTestId(
      "master-card-blocked-run-a1b2c3d4",
    );
    expect(indicator.getAttribute("data-state")).toBe("pending");
    // Pending count includes blockers not in state=done AND unknown ids.
    expect(indicator.textContent).toContain("2");
  });

  it("renders blockedBy indicator: ❌ failed blocker when any blocker is failed/launch_failed", async () => {
    const cfg = makeConfig();
    server.use(
      http.get("/api/external/tasks", () =>
        HttpResponse.json({
          tasks: [
            ...masterShadow(cfg, { blockedBy: ["task-a", "task-b"] }),
            { taskId: "task-a", sessionUuid: "u-a", state: "done", title: "A", projectId: PROJECT.id, cwd: "/p", pluginDirs: [], createdAt: "x", inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 } },
            { taskId: "task-b", sessionUuid: "u-b", state: "launch_failed", title: "B", projectId: PROJECT.id, cwd: "/p", pluginDirs: [], createdAt: "x", inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 } },
          ],
        }),
      ),
    );
    renderCard({ config: cfg });
    const indicator = await screen.findByTestId(
      "master-card-blocked-run-a1b2c3d4",
    );
    expect(indicator.getAttribute("data-state")).toBe("failed");
  });

  it("blockedBy indicator counts unknown blocker ids as pending (external review MED-6)", async () => {
    const cfg = makeConfig();
    server.use(
      http.get("/api/external/tasks", () =>
        HttpResponse.json({
          tasks: [
            ...masterShadow(cfg, { blockedBy: ["task-unknown-1", "task-unknown-2"] }),
          ],
        }),
      ),
    );
    renderCard({ config: cfg });
    const indicator = await screen.findByTestId(
      "master-card-blocked-run-a1b2c3d4",
    );
    expect(indicator.getAttribute("data-state")).toBe("pending");
    expect(indicator.textContent).toContain("2");
  });

  it("blockedBy indicator de-dupes duplicate blocker ids (external review MED-6)", async () => {
    const cfg = makeConfig();
    server.use(
      http.get("/api/external/tasks", () =>
        HttpResponse.json({
          tasks: [
            // Two duplicates + one unique pending blocker → 2 unique pending.
            ...masterShadow(cfg, { blockedBy: ["task-a", "task-a", "task-b"] }),
            { taskId: "task-a", sessionUuid: "u-a", state: "active", title: "A", projectId: PROJECT.id, cwd: "/p", pluginDirs: [], createdAt: "x", inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 } },
            { taskId: "task-b", sessionUuid: "u-b", state: "active", title: "B", projectId: PROJECT.id, cwd: "/p", pluginDirs: [], createdAt: "x", inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 } },
          ],
        }),
      ),
    );
    renderCard({ config: cfg });
    const indicator = await screen.findByTestId(
      "master-card-blocked-run-a1b2c3d4",
    );
    expect(indicator.getAttribute("data-state")).toBe("pending");
    expect(indicator.textContent).toContain("2");
  });

  it("omits the blockedBy indicator when array is empty or undefined", async () => {
    const cfg = makeConfig();
    renderWithShadow(masterShadow(cfg, { blockedBy: [] }));
    await waitFor(() => {
      expect(screen.getByText("Run-a1b2")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("master-card-blocked-run-a1b2c3d4"),
    ).toBeNull();
  });

  it("ignores non-master shadows for the badge data source", async () => {
    // Two shadows for this Run, neither parentRunMaster=true. Badges
    // must NOT pick a non-master shadow as the source.
    const cfg = makeConfig();
    server.use(
      http.get("/api/external/tasks", () =>
        HttpResponse.json({
          tasks: [
            {
              taskId: "shadow-1",
              sessionUuid: cfg.phase_tasks[0].sessionUuid,
              runId: cfg.runId,
              parentRunMaster: false,
              priority: "P0", // would be wrong to surface this at the master
              title: "phase shadow",
              projectId: PROJECT.id,
              state: "active",
              cwd: "/p",
              pluginDirs: [],
              createdAt: "x",
              inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
            },
          ],
        }),
      ),
    );
    renderCard({ config: cfg });
    await waitFor(() => {
      expect(screen.getByText("Run-a1b2")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("master-card-priority-run-a1b2c3d4"),
    ).toBeNull();
  });
});

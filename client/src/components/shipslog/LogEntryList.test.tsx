/*
 * LogEntryList (A16) — rows from A02; empty fixture → empty state (zero rows);
 * a run WITH a joined task is a clickable entry into its Mission; a run WITHOUT
 * a joined task is NOT a dead click; gate dots appear only when A02 reports them.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { LogEntryList } from "./LogEntryList";
import type { RunsResponse, RunDataJoin } from "../../lib/runDataApi";
import type { ExternalTask } from "../../lib/externalApi";

const runsMock = vi.fn<() => { data: RunsResponse | undefined }>();
const tasksMock = vi.fn<() => { data: ExternalTask[] }>();
vi.mock("../../hooks/useRunData", () => ({
  useProjectRuns: () => runsMock(),
}));
vi.mock("../../hooks/useExternalTasks", () => ({
  useExternalTasks: () => tasksMock(),
}));

function run(overrides: Partial<RunDataJoin> = {}): RunDataJoin {
  return {
    runId: "run-1",
    ts: "2026-07-12T10:00:00Z",
    source: "iterate",
    intent: "feature",
    changeType: "feature",
    summary: "add rate-limit headers",
    description: null,
    commit: "abcdef1234567",
    specImpact: "add",
    specImpactRaw: "add",
    affectedFrs: ["FR-01.60", "FR-01.61"],
    newFrs: [],
    tests: { passed: 12, total: 12 },
    gates: { derived: true, test: "pass", review: "unknown", security: "unknown" },
    phaseDurations: null,
    campaign: null,
    subIterateId: null,
    ...overrides,
  };
}

function okRuns(runs: RunDataJoin[]): RunsResponse {
  return { status: "ok", runs, runCount: runs.length, gradeTrend: [], pipelinePhaseDurations: [], skippedLines: 0 };
}

function task(runId: string): ExternalTask {
  return {
    taskId: "task-99",
    sessionUuid: "22222222-2222-2222-2222-222222222222",
    title: "t",
    cwd: "/tmp",
    pluginDirs: [],
    projectId: "p1",
    runId,
    state: "done",
    createdAt: "2026-07-12T09:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
  };
}

/** A session (task) with NO joined run — the non-Shipwright / no-runs case. */
function sessionTask(taskId: string, title: string): ExternalTask {
  return {
    taskId,
    sessionUuid: "33333333-3333-3333-3333-333333333333",
    title,
    cwd: "/tmp",
    pluginDirs: [],
    projectId: "p1",
    state: "draft",
    createdAt: "2026-07-15T09:00:00Z",
    launchedAt: "2026-07-15T10:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
  };
}

function Loc() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname}</div>;
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={["/projects/p1/log"]}>
      <Routes>
        <Route path="/projects/p1/log" element={<LogEntryList projectId="p1" />} />
        <Route path="/tasks/:taskId" element={<Loc />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  runsMock.mockReset();
  tasksMock.mockReset();
  tasksMock.mockReturnValue({ data: [] });
});

describe("LogEntryList", () => {
  it("empty run set → honest empty state, ZERO rows", () => {
    runsMock.mockReturnValue({ data: okRuns([]) });
    renderList();
    expect(screen.getByTestId("shipslog-logbook-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("shipslog-entry-run-1")).toBeNull();
  });

  it("no readable event log (undefined) → empty state, never fabricated rows", () => {
    runsMock.mockReturnValue({ data: undefined });
    renderList();
    expect(screen.getByTestId("shipslog-logbook-empty")).toBeInTheDocument();
  });

  it("empty run set uses the grade/adopt nudge wording", () => {
    runsMock.mockReturnValue({ data: okRuns([]) });
    renderList();
    expect(screen.getByTestId("shipslog-logbook-empty")).toHaveTextContent(
      "No runs yet. Grade or adopt it to open the logbook.",
    );
  });

  it("no runs but sessions present → recent sessions list (non-Shipwright projects)", async () => {
    runsMock.mockReturnValue({ data: okRuns([]) });
    tasksMock.mockReturnValue({ data: [sessionTask("task-a", "Draft the newsletter")] });
    renderList();
    expect(screen.getByTestId("shipslog-sessions")).toBeInTheDocument();
    // NOT the grade/adopt nudge — the log works for custom-action projects.
    expect(screen.queryByTestId("shipslog-logbook-empty")).toBeNull();
    const entry = screen.getByTestId("shipslog-session-task-a");
    expect(entry).toHaveTextContent("Draft the newsletter");
    await userEvent.click(entry);
    expect(screen.getByTestId("loc").textContent).toBe("/tasks/task-a");
  });

  it("runs present → the logbook wins over sessions", () => {
    runsMock.mockReturnValue({ data: okRuns([run()]) });
    tasksMock.mockReturnValue({ data: [task("run-1")] });
    renderList();
    expect(screen.getByTestId("shipslog-logbook")).toBeInTheDocument();
    expect(screen.queryByTestId("shipslog-sessions")).toBeNull();
  });

  it("a run WITH a joined task is a clickable entry → /tasks/:taskId", async () => {
    runsMock.mockReturnValue({ data: okRuns([run()]) });
    tasksMock.mockReturnValue({ data: [task("run-1")] });
    renderList();
    const entry = screen.getByTestId("shipslog-entry-run-1");
    expect(entry).toHaveAttribute("data-clickable", "true");
    await userEvent.click(entry);
    expect(screen.getByTestId("loc").textContent).toBe("/tasks/task-99");
  });

  it("a run WITHOUT a joined task is NOT a dead click (non-clickable div)", () => {
    runsMock.mockReturnValue({ data: okRuns([run({ runId: "run-orphan" })]) });
    tasksMock.mockReturnValue({ data: [] }); // no task joins this run
    renderList();
    const entry = screen.getByTestId("shipslog-entry-run-orphan");
    expect(entry).toHaveAttribute("data-clickable", "false");
    expect(entry.tagName).toBe("DIV"); // not a <button>
  });

  it("FR pill shows the first FR + overflow count", () => {
    runsMock.mockReturnValue({ data: okRuns([run()]) });
    renderList();
    expect(screen.getByText("FR-01.60 +1")).toBeInTheDocument();
  });

  it("gate dots render only when A02 reports gate outcomes", () => {
    runsMock.mockReturnValue({ data: okRuns([run({ runId: "r-nogate", gates: null })]) });
    renderList();
    expect(screen.queryByTestId("shipslog-gates-r-nogate")).toBeNull();
  });
});

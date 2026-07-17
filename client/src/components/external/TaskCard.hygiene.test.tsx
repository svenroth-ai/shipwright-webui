/*
 * TaskCard board-hygiene guard (A16, FR-01.60) — Sven's explicit call
 * (2026-07-14): board task cards carry NO FR chips and NO gate dots. That
 * proof belongs in the logbook (Ship's Log) / task detail, not on a card that
 * then grows too tall.
 *
 * This is a STANDING GUARD, not a one-off deletion: A02 (per-run join) makes a
 * task's FRs + gate outcomes AVAILABLE to the client for the first time, so a
 * later sub-iterate could "helpfully" wire them onto the card. This test seeds
 * exactly that data (a task with a runId whose A02 join carries affected FRs +
 * derived gate lamps) into the query cache and asserts the rendered card shows
 * NEITHER. It goes RED the moment either is re-introduced.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";

import { TaskCard } from "./TaskCard";
import type { ExternalTask } from "../../lib/externalApi";
import type { RunsResponse, RunDetailResponse, RunDataJoin } from "../../lib/runDataApi";
import type { Project } from "../../types";

const PROJECT_ID = "project-001";
const RUN_ID = "run-hygiene-abc";

const PROJECT: Project = {
  id: PROJECT_ID,
  name: "Atlas",
  path: "/tmp/atlas",
  profile: "custom",
  status: "active",
  lastActive: "2026-07-14T00:00:00Z",
  createdAt: "2026-07-14T00:00:00Z",
};

/** A run whose A02 join DOES carry FRs + gate outcomes — the very data a board
 *  card must NOT surface. */
const RUN: RunDataJoin = {
  runId: RUN_ID,
  ts: "2026-07-14T10:00:00Z",
  source: "iterate",
  intent: "feature",
  changeType: "feature",
  summary: "add rate-limit headers",
  description: null,
  commit: "abcdef1234567",
  specImpact: "add",
  specImpactRaw: "add",
  affectedFrs: ["FR-01.60", "FR-01.61"],
  newFrs: ["FR-01.60"],
  tests: { passed: 12, total: 12 },
  gates: { derived: true, test: "pass", review: "unknown", security: "unknown" },
  phaseDurations: null,
  campaign: null,
  subIterateId: null,
};

function taskWithRun(): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "11111111-1111-1111-1111-111111111111",
    title: "Rate-limit the media route",
    cwd: "/tmp/atlas",
    pluginDirs: [],
    projectId: PROJECT_ID,
    runId: RUN_ID,
    phase: "build",
    phaseLabel: "Build",
    state: "idle",
    createdAt: "2026-07-14T09:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
  };
}

function renderWithRunData(task: ExternalTask) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Make the FR + gate data AVAILABLE — the guard's whole point.
  qc.setQueryData(["projects"], [PROJECT]);
  qc.setQueryData<RunsResponse>(["run-data", "runs", PROJECT_ID], {
    status: "ok",
    runs: [RUN],
    runCount: 1,
    gradeTrend: [],
    pipelinePhaseDurations: [],
    skippedLines: 0,
  });
  qc.setQueryData<RunDetailResponse>(["run-data", "run", PROJECT_ID, RUN_ID], {
    status: "ok",
    run: RUN,
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TaskCard task={task} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TaskCard board hygiene (A16) — no FR chips, no gate dots", () => {
  it("renders the card (sanity — the meta row IS present)", () => {
    renderWithRunData(taskWithRun());
    expect(screen.getByTestId("task-card-task-1")).toBeInTheDocument();
    // The phase badge proves the meta row rendered — so the absences below are
    // real absences, not a card that failed to render at all.
    expect(screen.getByTestId("task-card-phase-task-1")).toBeInTheDocument();
  });

  it("shows NO gate dots even though A02 reports gate outcomes", () => {
    const { container } = renderWithRunData(taskWithRun());
    expect(container.querySelectorAll(".gate-dot")).toHaveLength(0);
    expect(container.querySelector('[data-testid*="gate"]')).toBeNull();
  });

  it("shows NO FR chip even though the run has affected FRs", () => {
    const { container } = renderWithRunData(taskWithRun());
    // No FR-pill testid, and no FR identifier text leaks onto the card.
    expect(container.querySelector('[data-testid*="task-card-fr"]')).toBeNull();
    expect(screen.queryByText(/FR-01\.6/)).toBeNull();
  });
});

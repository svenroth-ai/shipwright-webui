/*
 * MissionTopRow — the A13 restyle's top-row deltas (FR-01.57): the both-clickable
 * "Board › Project" breadcrumb, the additive design-gate "Awaiting approval" pill,
 * Resume-hidden-when-done, and the lossless `⋯` HeaderMenu. The full CTA state
 * machine + menu behaviours stay covered by TaskDetailHeader.test.tsx (which now
 * renders this component through the delegator).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { MissionTopRow } from "./MissionTopRow";
import type { ExternalTask } from "../../../lib/externalApi";

const missionStateMock = vi.fn<() => "done" | "live" | "designgate">();
vi.mock("../../../hooks/useMissionState", () => ({
  useMissionState: () => missionStateMock(),
}));

const PROJECTS = [
  { id: "proj-alpha", name: "Alpha", path: "/tmp/alpha", profile: "custom", status: "active" as const, lastActive: "2026-04-01", createdAt: "2026-04-01" },
];

function makeTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-42",
    sessionUuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    cwd: "C:/tmp/demo",
    pluginDirs: [],
    title: "CTA header demo",
    projectId: "proj-alpha",
    state: "draft",
    createdAt: "2026-04-20",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

function renderRow(task: ExternalTask) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(["projects"], PROJECTS);
  qc.setQueryData(["external-task", task.taskId], task);
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/api/projects") && !u.includes("/api/external/")) {
      return new Response(JSON.stringify({ data: PROJECTS }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <MissionTopRow task={task} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  missionStateMock.mockReturnValue("done");
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true, writable: true });
});

describe("MissionTopRow — breadcrumb", () => {
  it("renders 'Board › Project' with BOTH segments clickable to real routes", () => {
    renderRow(makeTask({ state: "active" }));
    const board = screen.getByTestId("task-detail-crumb-board");
    const project = screen.getByTestId("task-detail-crumb-project");
    expect(board).toHaveAttribute("href", "/");
    expect(board).toHaveTextContent("Board");
    expect(project).toHaveAttribute("href", "/projects");
    expect(project).toHaveTextContent("Alpha");
  });
});

describe("MissionTopRow — badge + design gate", () => {
  it("shows the rich task-state badge (In progress) for an active task", () => {
    missionStateMock.mockReturnValue("live");
    renderRow(makeTask({ state: "active" }));
    expect(screen.getByTestId("task-state-badge")).toHaveTextContent("In progress");
    expect(screen.queryByTestId("mission-awaiting-approval")).toBeNull();
  });

  it("adds the 'Awaiting approval' pill when the mission state is a design gate", () => {
    missionStateMock.mockReturnValue("designgate");
    renderRow(makeTask({ state: "active" }));
    // Lossless: the rich task-state badge stays; the pill is additive.
    expect(screen.getByTestId("task-state-badge")).toBeInTheDocument();
    expect(screen.getByTestId("mission-awaiting-approval")).toHaveTextContent("Awaiting approval");
  });

  it("shows 'Done' for a done task", () => {
    renderRow(makeTask({ state: "done" }));
    expect(screen.getByTestId("task-state-badge")).toHaveTextContent("Done");
  });
});

describe("MissionTopRow — Resume CTA", () => {
  it("hides Resume when done", () => {
    renderRow(makeTask({ state: "done" }));
    expect(screen.queryByTestId("cta-copy-resume-command")).toBeNull();
    expect(screen.queryByTestId("cta-launch-in-terminal")).toBeNull();
  });

  it("shows Resume for an active task", () => {
    missionStateMock.mockReturnValue("live");
    renderRow(makeTask({ state: "active" }));
    expect(screen.getByTestId("cta-copy-resume-command")).toBeInTheDocument();
  });
});

describe("MissionTopRow — lossless HeaderMenu", () => {
  it("keeps every ⋯ menu item for an in-progress task", async () => {
    missionStateMock.mockReturnValue("live");
    const user = userEvent.setup();
    renderRow(makeTask({ state: "active" }));
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu"));
    for (const item of [
      "task-detail-menu-rename",
      "task-detail-menu-edit-task",
      "task-detail-menu-copy-uuid",
      "task-detail-menu-copy-resume-command",
      "task-detail-menu-move-project",
      "task-detail-menu-backlog",
      "task-detail-menu-close",
      "task-detail-menu-stop-terminal",
      "task-detail-menu-delete",
      "task-detail-menu-clear-history",
      "task-detail-menu-toggle-debug",
    ]) {
      expect(screen.getByTestId(item)).toBeInTheDocument();
    }
  });

  it("keeps Re-open for a done task", async () => {
    const user = userEvent.setup();
    renderRow(makeTask({ state: "done" }));
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu"));
    expect(screen.getByTestId("task-detail-menu-reopen")).toBeInTheDocument();
  });
});

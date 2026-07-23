/*
 * RootRoute — the "/" decision (iterate-2026-07-23-first-contact-hero, FR-01.51
 * delta). First Contact is the TRUE fresh-install state: no registered projects
 * AND no tasks. A user with zero registered projects but genuinely-unassigned
 * tasks keeps the board at "/" (those tasks are reachable only there). While
 * loading OR on a fetch failure, "/" stays the board — an existing user never
 * waits behind a blank screen, and a transient failure never redirects them.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../hooks/useProjects", () => ({ useProjects: vi.fn() }));
vi.mock("../hooks/useExternalTasks", () => ({ useExternalTasks: vi.fn() }));
vi.mock("./TaskBoardPage", () => ({
  default: () => <div data-testid="board-stub">board</div>,
}));

import RootRoute from "./RootRoute";
import { useProjects } from "../hooks/useProjects";
import { useExternalTasks } from "../hooks/useExternalTasks";
import { UNASSIGNED_PROJECT_ID } from "../lib/projectIds";

const mockUseProjects = vi.mocked(useProjects);
const mockUseTasks = vi.mocked(useExternalTasks);

type ProjectsState = ReturnType<typeof useProjects>;
type TasksState = ReturnType<typeof useExternalTasks>;
function projectsState(data: unknown): ProjectsState {
  return { data, isLoading: data === undefined } as unknown as ProjectsState;
}
function tasksState(data: unknown): TasksState {
  return { data, isLoading: data === undefined } as unknown as TasksState;
}

function renderRoot() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/first-contact" element={<div data-testid="first-contact-stub">fc</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());
beforeEach(() => {
  mockUseProjects.mockReset();
  mockUseTasks.mockReset();
});

describe("RootRoute — board vs First Contact at /", () => {
  // @covers FR-01.51 — the genuine fresh install: nothing registered, no tasks.
  it("empty registry AND no tasks → First Contact", () => {
    mockUseProjects.mockReturnValue(projectsState([]));
    mockUseTasks.mockReturnValue(tasksState([]));
    renderRoot();
    expect(screen.getByTestId("first-contact-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("board-stub")).not.toBeInTheDocument();
  });

  // @covers FR-01.51
  it("≥1 real project → the Task Board", () => {
    mockUseProjects.mockReturnValue(projectsState([{ id: "p1", synthesized: false }]));
    mockUseTasks.mockReturnValue(tasksState([]));
    renderRoot();
    expect(screen.getByTestId("board-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("first-contact-stub")).not.toBeInTheDocument();
  });

  // @covers FR-01.51 — the doubt-review case: zero REGISTERED projects, but the
  // user owns genuinely-unassigned tasks (only the synthesized bucket is present).
  // Those tasks are reachable only on the board's "All projects" view, so "/" must
  // stay the board — never strand them on First Contact.
  it("zero registered projects but unassigned tasks exist → the Task Board", () => {
    mockUseProjects.mockReturnValue(
      projectsState([{ id: UNASSIGNED_PROJECT_ID, synthesized: true }]),
    );
    mockUseTasks.mockReturnValue(tasksState([{ id: "t1" }]));
    renderRoot();
    expect(screen.getByTestId("board-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("first-contact-stub")).not.toBeInTheDocument();
  });

  // @covers FR-01.51 — only the synthesized Unassigned bucket AND no tasks → First
  // Contact (a stale empty bucket with nothing in it is still a fresh install).
  it("only the synthesized bucket, no tasks → First Contact", () => {
    mockUseProjects.mockReturnValue(
      projectsState([{ id: UNASSIGNED_PROJECT_ID, synthesized: true }]),
    );
    mockUseTasks.mockReturnValue(tasksState([]));
    renderRoot();
    expect(screen.getByTestId("first-contact-stub")).toBeInTheDocument();
  });

  // @covers FR-01.51 — while the registry is loading, "/" renders the board (its
  // own skeleton) — an existing user is NEVER blanked behind the projects fetch.
  it("loading → the Task Board (no blank for the existing user)", () => {
    mockUseProjects.mockReturnValue(projectsState(undefined));
    mockUseTasks.mockReturnValue(tasksState(undefined));
    renderRoot();
    expect(screen.getByTestId("board-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("first-contact-stub")).not.toBeInTheDocument();
  });

  // @covers FR-01.51 — a transient fetch error (undefined data) falls back to the
  // board, never redirects an existing user to First Contact.
  it("errored/undefined registry → the Task Board (no redirect)", () => {
    mockUseProjects.mockReturnValue(projectsState(undefined));
    mockUseTasks.mockReturnValue(tasksState([]));
    renderRoot();
    expect(screen.getByTestId("board-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("first-contact-stub")).not.toBeInTheDocument();
  });
});

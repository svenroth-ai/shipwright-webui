/*
 * ShipsLogPage (A16) — composes the Captain's Drawer + promptbox + graduation
 * card + logbook under `/projects/:projectId/log`; "Open board" escapes to the
 * board filtered by the project; an unknown project is an honest not-found.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import ShipsLogPage from "./ShipsLogPage";
import type { Project } from "../types";
import type { RunsResponse } from "../lib/runDataApi";

const PROJECT: Project = {
  id: "p1",
  name: "Atlas",
  path: "/tmp/atlas",
  profile: "custom",
  status: "active",
  lastActive: "2026-07-14T00:00:00Z",
  createdAt: "2026-07-14T00:00:00Z",
};

const projectsMock = vi.fn<() => { data: Project[]; isLoading: boolean }>();
const runsMock = vi.fn<() => { data: RunsResponse | undefined }>();
const setActiveProjectId = vi.fn();

vi.mock("../hooks/useProjects", () => ({ useProjects: () => projectsMock() }));
vi.mock("../hooks/useRunData", () => ({ useProjectRuns: () => runsMock() }));
vi.mock("../hooks/useProjectFilter", () => ({
  useProjectFilter: () => ({ activeProjectId: null, setActiveProjectId }),
}));

// The four parts are unit-tested on their own; stub them here so the page test
// asserts COMPOSITION, not their internals.
vi.mock("../components/shipslog/CaptainsDrawer", () => ({
  CaptainsDrawer: () => <div data-testid="stub-drawer" />,
}));
vi.mock("../components/shipslog/ScopedIteratePromptbox", () => ({
  ScopedIteratePromptbox: () => <div data-testid="stub-promptbox" />,
}));
vi.mock("../components/shipslog/GraduationCard", () => ({
  GraduationCard: ({ date }: { date: string | null }) => (
    <div data-testid="stub-graduation" data-date={date ?? ""} />
  ),
}));
vi.mock("../components/shipslog/LogEntryList", () => ({
  LogEntryList: () => <div data-testid="stub-logbook" />,
}));

function Loc() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname + l.search}</div>;
}

function renderPage(projectId = "p1") {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/log`]}>
      <Routes>
        <Route path="/projects/:projectId/log" element={<ShipsLogPage />} />
        <Route path="/" element={<Loc />} />
        <Route path="/projects" element={<Loc />} />
      </Routes>
    </MemoryRouter>,
  );
}

const okRuns = (): RunsResponse => ({
  status: "ok",
  runs: [
    { runId: "r2", ts: "2026-07-12T00:00:00Z" } as never,
    { runId: "r1", ts: "2026-07-05T00:00:00Z" } as never,
  ],
  runCount: 2,
  gradeTrend: [],
  pipelinePhaseDurations: [],
  skippedLines: 0,
});

beforeEach(() => {
  projectsMock.mockReset();
  runsMock.mockReset();
  setActiveProjectId.mockReset();
  projectsMock.mockReturnValue({ data: [PROJECT], isLoading: false });
  runsMock.mockReturnValue({ data: okRuns() });
});

describe("ShipsLogPage", () => {
  // @covers FR-01.59
  it("composes the drawer + promptbox + graduation + logbook with a Ship's-Log header", () => {
    renderPage();
    expect(screen.getByTestId("ships-log-page")).toBeInTheDocument();
    expect(screen.getByText("Atlas")).toBeInTheDocument();
    expect(screen.getByText("Ship’s Log")).toBeInTheDocument();
    expect(screen.getByTestId("stub-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("stub-promptbox")).toBeInTheDocument();
    expect(screen.getByTestId("stub-graduation")).toBeInTheDocument();
    expect(screen.getByTestId("stub-logbook")).toBeInTheDocument();
  });

  // @covers FR-01.59
  it("passes the EARLIEST run date as the graduation baseline", () => {
    renderPage();
    // runs are ts-desc [r2=Jul12, r1=Jul5]; the baseline is the earliest (Jul 5).
    expect(screen.getByTestId("stub-graduation")).toHaveAttribute("data-date", "2026-07-05T00:00:00Z");
  });

  // @covers FR-01.59
  it("'Open board' escapes to the board filtered by this project", async () => {
    renderPage();
    await userEvent.click(screen.getByTestId("ships-log-open-board"));
    expect(setActiveProjectId).toHaveBeenCalledWith("p1");
    expect(screen.getByTestId("loc")).toHaveTextContent("/?projectId=p1");
  });

  // @covers FR-01.59
  it("'Open board' uses the standard .btn-primary button (Sven 2026-07-17, AC8)", () => {
    renderPage();
    expect(screen.getByTestId("ships-log-open-board")).toHaveClass("btn-primary");
  });

  // @covers FR-01.59
  it("unknown project → honest not-found, no fabricated logbook", () => {
    projectsMock.mockReturnValue({ data: [], isLoading: false });
    renderPage("ghost");
    expect(screen.getByText(/not registered/i)).toBeInTheDocument();
    expect(screen.queryByTestId("stub-logbook")).toBeNull();
  });
});

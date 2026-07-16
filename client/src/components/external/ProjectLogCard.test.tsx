import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../../test/mocks/server";
import { ProjectLogCard } from "./ProjectLogCard";
import type { RunsResponse } from "../../lib/runDataApi";
import type { Project } from "../../types";

const PROJECT: Project = {
  id: "proj-1",
  name: "Shipwright WebUI",
  path: "/tmp/shipwright-webui",
  profile: "custom",
  status: "active",
  lastActive: "2026-07-01T00:00:00Z",
  createdAt: "2026-06-01T00:00:00Z",
};

function gradedRuns(): RunsResponse {
  return {
    status: "ok",
    runCount: 2,
    runs: [
      { runId: "r1", ts: "2026-07-01T00:00:00Z", source: null, intent: null, changeType: null, summary: "older run", description: null, commit: null, specImpact: null, specImpactRaw: null, affectedFrs: ["FR-01.01"], newFrs: [], tests: null, gates: null, phaseDurations: null, campaign: null, subIterateId: null },
      { runId: "r2", ts: "2026-07-05T00:00:00Z", source: null, intent: null, changeType: null, summary: "the last proof quote", description: null, commit: null, specImpact: null, specImpactRaw: null, affectedFrs: ["FR-01.02"], newFrs: [], tests: null, gates: null, phaseDurations: null, campaign: null, subIterateId: null },
    ],
    gradeTrend: [
      { ts: "2026-07-01T00:00:00Z", grade: "B", score: 80 },
      { ts: "2026-07-05T00:00:00Z", grade: "A", score: 92 },
    ],
    pipelinePhaseDurations: [],
    skippedLines: 0,
  };
}

function LocationEcho() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderCard(
  props: Partial<React.ComponentProps<typeof ProjectLogCard>> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/projects"]}>
        <Routes>
          <Route
            path="/projects"
            element={
              <ProjectLogCard
                project={PROJECT}
                runs={undefined}
                runsResolved={true}
                runsError={false}
                taskCount={0}
                color="#6FA3A8"
                onOpenSettings={vi.fn()}
                onDelete={vi.fn()}
                {...props}
              />
            }
          />
          <Route path="/" element={<LocationEcho />} />
          <Route path="/wizard/:door" element={<LocationEcho />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectLogCard", () => {
  it("graded body renders the sparkline + stats + last-proof quote (AC2)", async () => {
    renderCard({ runs: gradedRuns(), taskCount: 3 });
    expect(await screen.findByTestId("lc-spark")).toBeInTheDocument();
    // 2 bars, one per grade-trend point.
    expect(screen.getByTestId("lc-spark").querySelectorAll("i")).toHaveLength(2);
    expect(screen.getByTestId("projects-card-proj-1-stats")).toHaveTextContent(
      "2 runs · 2 FRs",
    );
    // Most-recent run's summary as the proof quote.
    expect(screen.getByText(/the last proof quote/)).toBeInTheDocument();
  });

  it("ungraded body renders the empty sentence and NO sparkline (AC2)", async () => {
    renderCard({ runs: undefined, runsResolved: true });
    expect(
      await screen.findByTestId("projects-card-proj-1-empty"),
    ).toHaveTextContent("No runs yet — grade it to open the logbook.");
    expect(screen.queryByTestId("lc-spark")).toBeNull();
    expect(screen.queryByTestId("projects-card-proj-1-stats")).toBeNull();
  });

  it("a STILL-LOADING read shows a neutral placeholder, never a premature 'no runs' claim (AC3)", async () => {
    renderCard({ runs: undefined, runsResolved: false, runsError: false });
    expect(
      await screen.findByTestId("projects-card-proj-1-loading"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("projects-card-proj-1-empty")).toBeNull();
  });

  it("a FAILED read shows 'unavailable', never a false 'no runs' claim (AC3)", async () => {
    renderCard({ runs: undefined, runsResolved: false, runsError: true });
    expect(
      await screen.findByTestId("projects-card-proj-1-unavailable"),
    ).toHaveTextContent("Run history unavailable.");
    expect(screen.queryByTestId("projects-card-proj-1-empty")).toBeNull();
  });

  it("shows the grade pill ONLY when the compliance read succeeded (AC1)", async () => {
    server.use(
      http.get("/api/external/projects/:id/compliance", () =>
        HttpResponse.json({
          status: "ok",
          grade: "A",
          score: 92,
          verdict: "Green",
          generatedAt: "2026-07-05T00:00:00Z",
          controlVerdictMarkdown: "# ok",
          ciSecurityMarkdown: "",
        }),
      ),
    );
    renderCard({ runs: gradedRuns() });
    expect(
      await screen.findByTestId("compliance-grade-proj-1"),
    ).toBeInTheDocument();
    // With a grade present, the "Grade it" affordance is not rendered.
    expect(screen.queryByTestId("projects-gradeit-proj-1")).toBeNull();
  });

  it("no compliance → 'Grade it' affordance routes to the read-only Grade door (AC5)", async () => {
    // Default compliance handler = { status: "missing" }.
    renderCard({ runs: undefined });
    const gradeIt = await screen.findByTestId("projects-gradeit-proj-1");
    await userEvent.click(gradeIt);
    const echo = await screen.findByTestId("loc");
    expect(echo.textContent).toBe("/wizard/grade");
  });

  it("clicking the card opens the project via the single seam (AC4)", async () => {
    renderCard({ runs: undefined });
    await userEvent.click(screen.getByTestId("projects-card-proj-1"));
    const echo = await screen.findByTestId("loc");
    expect(echo.textContent).toBe("/?projectId=proj-1");
  });

  it("gear + trash stop propagation and fire their handlers, not navigation", async () => {
    const onOpenSettings = vi.fn();
    const onDelete = vi.fn();
    renderCard({ runs: undefined, onOpenSettings, onDelete });
    await userEvent.click(screen.getByTestId("projects-settings-proj-1"));
    expect(onOpenSettings).toHaveBeenCalledWith(PROJECT);
    expect(screen.queryByTestId("loc")).toBeNull();
    await userEvent.click(screen.getByTestId("projects-delete-proj-1"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("loc")).toBeNull();
  });

  it("synthesized project: no gear/trash/open, not clickable-through", async () => {
    renderCard({
      project: { ...PROJECT, id: "unassigned", synthesized: true, path: "" },
      runs: undefined,
    });
    expect(
      await screen.findByTestId("projects-card-unassigned"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("projects-settings-unassigned")).toBeNull();
    expect(screen.queryByTestId("projects-delete-unassigned")).toBeNull();
    expect(screen.queryByTestId("projects-open-unassigned")).toBeNull();
  });
});

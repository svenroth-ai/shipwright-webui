/*
 * TaskCard unit coverage — 2026-04-23 iterate-20260423-chat-livetest-2 AC-B.
 *
 * Kanban card renders a phase badge (small colored dot + phase label)
 * when the task has `phaseLabel` + `phase` set. Color derived from the
 * shared `lib/phaseStyle.ts` palette so TaskCard + TaskDetailHeader stay
 * in sync. No badge when phase is null/undefined — pre-iterate tasks
 * and unassigned projects don't render a silent-default chip.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

import { TaskCard } from "./TaskCard";
import type { ExternalTask } from "../../lib/externalApi";
import { queryKeys } from "../../lib/queryKeys";
import type { Project } from "../../types";

function baseTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "11111111-1111-1111-1111-111111111111",
    title: "Audit drift",
    cwd: "/tmp/project",
    pluginDirs: [],
    projectId: "project-001",
    state: "draft",
    createdAt: "2026-04-23T15:00:00Z",
    inbox: {
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    },
    ...overrides,
  };
}

function renderCard(task: ExternalTask) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TaskCard task={task} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TaskCard — phase badge (AC-B)", () => {
  it("renders phase badge when task.phaseLabel and task.phase are set", () => {
    renderCard(baseTask({ phase: "compliance", phaseLabel: "Compliance" }));
    const badge = screen.getByTestId("task-card-phase-task-1");
    expect(badge.textContent).toContain("Compliance");
    expect(badge.dataset.phase).toBe("compliance");
  });

  it("does NOT render a phase badge when phase is missing (pre-iterate task)", () => {
    renderCard(baseTask());
    expect(screen.queryByTestId("task-card-phase-task-1")).toBeNull();
  });

  it("does NOT render a phase badge when only phase (no label) is set", () => {
    // Defensive — the server persists them together, but if a corrupt row
    // has only phase, we prefer no badge over a badge with an empty label.
    renderCard(baseTask({ phase: "build" }));
    expect(screen.queryByTestId("task-card-phase-task-1")).toBeNull();
  });

  it("falls back to build palette for unknown phase ids (render-safe)", () => {
    // We render the label verbatim but the dot + chip color fall back
    // to the `build` palette via getPhaseStyle. Just assert the badge
    // renders — the fallback is covered in phaseStyle unit tests.
    renderCard(baseTask({ phase: "future-unknown", phaseLabel: "Future" }));
    const badge = screen.getByTestId("task-card-phase-task-1");
    expect(badge.textContent).toContain("Future");
  });

  // v0.3.1 — title-keyword fallback so legacy tasks (launched before
  // phase-on-create wiring) still get a badge that matches what
  // TaskDetailHeader shows.
  it("derives phase from title when task.phase + task.phaseLabel are missing", () => {
    renderCard(baseTask({ title: "Build login flow" }));
    const badge = screen.getByTestId("task-card-phase-task-1");
    expect(badge.textContent).toContain("Build");
    expect(badge.dataset.phase).toBe("build");
    expect(badge.dataset.phaseSource).toBe("title-fallback");
  });

  it("server-persisted task.phase wins over title-fallback (e.g. compliance task titled 'audit drift')", () => {
    renderCard(
      baseTask({
        title: "audit drift",
        phase: "compliance",
        phaseLabel: "Compliance",
      }),
    );
    const badge = screen.getByTestId("task-card-phase-task-1");
    expect(badge.textContent).toContain("Compliance");
    expect(badge.dataset.phaseSource).toBe("task");
  });
});

// ---------------------------------------------------------------------------
// Iterate L (resume-cta-active-state) — TaskCard Resume CTA matrix.
//
// The earlier ADR-095 / ADR-096 liveSession-gating was falsified
// empirically: `liveSession` is computed from `ptyManager.get(taskId)
// !== undefined`, which only checks "a pty entry exists in PtyManager",
// not "Claude is in pty foreground". The most common stuck-state was
// the misfire — Claude TUI exited but the parent shell (pwsh) survived
// → pty alive → liveSession=true → Resume hidden → user had no UI
// path back. Iterate L drops the gating: Resume now always shows for
// `(idle | active)`. Single "Resume" label everywhere (see memory
// feedback_resume_label_singular).
// ---------------------------------------------------------------------------
describe("TaskCard — Resume CTA matrix (Iterate L)", () => {
  it("SHOWS Resume when state=idle + liveSession=true (gating dropped)", () => {
    // Regression fence for the falsification: even when the server
    // reports liveSession=true (pty entry exists), Resume MUST show.
    renderCard(baseTask({ state: "idle", liveSession: true }));
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });

  it("SHOWS Resume when state=idle + liveSession=false", () => {
    renderCard(baseTask({ state: "idle", liveSession: false }));
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });

  it("SHOWS Resume when state=idle + liveSession=undefined", () => {
    renderCard(baseTask({ state: "idle" }));
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });

  it("SHOWS Resume when state=active + liveSession=true (gating dropped)", () => {
    // Empirical reproducer: task with PowerShell shell alive but Claude
    // TUI exited. Resume MUST show.
    renderCard(baseTask({ state: "active", liveSession: true }));
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });

  it("SHOWS Resume when state=active + liveSession=false", () => {
    renderCard(baseTask({ state: "active", liveSession: false }));
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });

  it("SHOWS Resume when state=active + liveSession=undefined", () => {
    renderCard(baseTask({ state: "active" }));
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });

  it("does NOT render Resume on state=done regardless of liveSession (outer !isDone gate)", () => {
    renderCard(baseTask({ state: "done", liveSession: true }));
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
    renderCard(baseTask({ state: "done", liveSession: false }));
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
  });

  it("does NOT render Resume on state=draft (Launch is the action there)", () => {
    renderCard(baseTask({ state: "draft" }));
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
  });

  // resume-cta-rework (2026-05-16) — the activity gate is REMOVED.
  // Resume shows for every (idle | active) task. The altScreenActive /
  // lastPtyDataAt gate signals were deleted outright in
  // iterate-2026-05-17-remove-dead-resume-gate; liveSession and
  // lastJsonlSeenMtimeMs still exist but MUST NOT gate the CTA.
  // Regression fence below.
  it("SHOWS Resume when every surviving former gate-signal says 'recently active'", () => {
    // The configuration the old isClaudeRecentlyActive gate hid Resume
    // for, reduced to the signals still present on ExternalTask — a
    // live pty + fresh JSONL mtime. Post-rework it MUST show.
    renderCard(
      baseTask({
        state: "active",
        liveSession: true,
        lastJsonlSeenMtimeMs: Date.now() - 1_000,
      }),
    );
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// iterate-2026-05-15-taskcard-project-pill (ADR-105) — TaskCard project pill.
//
// The faint 3 px left-edge strip was hard to read on a multi-project board.
// The card meta row now leads with a project pill: the owning project's
// name beside a solid dot, both colored with the project's accent color
// (custom `settings.color` or hash-derived hue). The pill is the leftmost
// element of the meta row — left of the status pill.
// ---------------------------------------------------------------------------
function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-001",
    name: "Webui",
    path: "/tmp/project",
    profile: "vite-hono",
    status: "active",
    lastActive: "2026-05-15T00:00:00Z",
    createdAt: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

/** Render a TaskCard with the projects query pre-seeded so `useProjects()`
 *  resolves synchronously instead of returning the empty-list default. */
function renderCardWithProjects(task: ExternalTask, projects: Project[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.projects.all, projects);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TaskCard task={task} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TaskCard — project pill (ADR-105)", () => {
  it("renders a project pill with the owning project's name", () => {
    renderCardWithProjects(baseTask({ projectId: "project-001" }), [
      makeProject({ id: "project-001", name: "Shipwright WebUI" }),
    ]);
    const pill = screen.getByTestId("task-card-project-task-1");
    expect(pill.textContent).toContain("Shipwright WebUI");
    expect(pill.dataset.projectId).toBe("project-001");
  });

  it("falls back to the raw projectId when project metadata has not loaded", () => {
    // renderCard seeds no projects → useProjects() returns [] → no match.
    renderCard(baseTask({ projectId: "project-001" }));
    const pill = screen.getByTestId("task-card-project-task-1");
    expect(pill.textContent).toContain("project-001");
  });

  it("places the project pill as the leftmost element of the meta row (left of the status pill)", () => {
    renderCardWithProjects(baseTask({ projectId: "project-001", state: "active" }), [
      makeProject({ id: "project-001", name: "Webui" }),
    ]);
    const metaRow = screen.getByTestId("task-card-meta-task-1");
    expect(metaRow.firstElementChild).toBe(
      screen.getByTestId("task-card-project-task-1"),
    );
    // The status pill text ("active") must appear after the project pill.
    const pill = screen.getByTestId("task-card-project-task-1");
    const statePillText = Array.from(metaRow.children).find(
      (el) => el.textContent === "active",
    );
    expect(statePillText).toBeTruthy();
    expect(
      pill.compareDocumentPosition(statePillText as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("colors the pill with the project's custom accent color when settings.color is set", () => {
    renderCardWithProjects(baseTask({ projectId: "project-001" }), [
      makeProject({ id: "project-001", settings: { color: "#D99285" } }),
    ]);
    const pill = screen.getByTestId("task-card-project-task-1");
    expect(pill.dataset.projectColor).toBe("#D99285");
  });

  it("renders the project pill on every card state (draft / active / done)", () => {
    for (const state of ["draft", "active", "done"] as const) {
      const { unmount } = renderCardWithProjects(
        baseTask({ taskId: `t-${state}`, projectId: "project-001", state }),
        [makeProject({ id: "project-001", name: "Webui" })],
      );
      expect(
        screen.getByTestId(`task-card-project-t-${state}`).textContent,
      ).toContain("Webui");
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// iterate-2026-05-17-move-to-backlog (FR-01.32) — "Move to Backlog" menu item.
//
// Shown in the card ⋯-menu for the five In-Progress states; absent for
// `draft` (already in Backlog) and `done` (terminal). Selecting it POSTs
// to /api/external/tasks/:id/backlog.
// ---------------------------------------------------------------------------
describe("TaskCard — Move to Backlog (FR-01.32)", () => {
  const IN_PROGRESS = [
    "awaiting_external_start",
    "active",
    "idle",
    "jsonl_missing",
    "launch_failed",
  ] as const;

  it.each(IN_PROGRESS)(
    "shows the 'Move to Backlog' menu item for state=%s",
    async (state) => {
      const user = userEvent.setup();
      renderCard(baseTask({ state }));
      await user.click(screen.getByTestId("task-card-menu-task-1"));
      expect(
        await screen.findByTestId("task-card-backlog-task-1"),
      ).toBeInTheDocument();
    },
  );

  it.each(["draft", "done"] as const)(
    "hides the 'Move to Backlog' menu item for state=%s",
    async (state) => {
      const user = userEvent.setup();
      renderCard(baseTask({ state }));
      await user.click(screen.getByTestId("task-card-menu-task-1"));
      // Menu IS open (the always-present Close item renders) — only the
      // backlog item is conditionally absent.
      await screen.findByTestId("task-card-close-task-1");
      expect(screen.queryByTestId("task-card-backlog-task-1")).toBeNull();
    },
  );

  it("clicking 'Move to Backlog' POSTs to the backlog endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ task: baseTask({ state: "draft" }) }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderCard(baseTask({ state: "idle" }));
      await user.click(screen.getByTestId("task-card-menu-task-1"));
      await user.click(await screen.findByTestId("task-card-backlog-task-1"));
      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some((c) =>
            String(c[0]).includes("/api/external/tasks/task-1/backlog"),
          ),
        ).toBe(true);
      });
      const call = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/backlog"),
      );
      expect((call?.[1] as RequestInit | undefined)?.method).toBe("POST");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// iterate-2026-05-17-move-to-backlog (FR-01.01 AC-6) — Resume-vs-Launch on a
// backlogged task. A `draft` task that has already run (firstJsonlObservedAt
// set) must show Resume, never a fresh Launch — a fresh `claude --session-id`
// against an already-used session is rejected with "Session ID already in use".
// ---------------------------------------------------------------------------
describe("TaskCard — Resume vs Launch on a backlogged task (FR-01.01 AC-6)", () => {
  it("a never-launched draft shows the green Launch button (regression fence)", () => {
    renderCard(baseTask({ state: "draft" }));
    expect(screen.getByTestId("task-card-launch-task-1")).toBeInTheDocument();
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
  });

  it("a draft with firstJsonlObservedAt (moved back after running) shows Resume, not Launch", () => {
    renderCard(
      baseTask({
        state: "draft",
        firstJsonlObservedAt: "2026-05-17T10:00:00.000Z",
      }),
    );
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
    expect(screen.queryByTestId("task-card-launch-task-1")).toBeNull();
  });
});

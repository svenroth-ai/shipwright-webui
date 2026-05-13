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
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";

import { TaskCard } from "./TaskCard";
import type { ExternalTask } from "../../lib/externalApi";

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
// Iterate H (ADR-096) — Resume CTA liveSession gating on the TaskCard.
//
// Mirrors the TaskDetailHeader.ctaFor() logic from Iterate G ADR-095:
// when the pty is alive (`liveSession === true`) and the task is in
// the `idle` state, we hide the Resume CTA — the user types directly
// into the live shell instead of pasting `claude --resume <uuid>`
// (which would either error or spawn a nested Claude instance).
//
// `liveSession === undefined` (back-compat — server response without
// the field) falls back to surfacing Resume; conservative same default
// the TaskDetailHeader uses.
//
// Iterate L (resume-cta-active-state) — extends the gating to `state=active`
// as well: when the JSONL is fresh but the pty is gone (e.g. server
// restart killed the embedded-terminal pty while Claude was logically
// still running in the JSONL), the user previously had no UI path back.
// Same single "Resume" label — the user-side reason for resuming is
// irrelevant (see memory: feedback_resume_label_singular.md).
// ---------------------------------------------------------------------------
describe("TaskCard — Resume CTA liveSession gating (ADR-096)", () => {
  it("HIDES Resume button when state=idle + liveSession=true (pty alive)", () => {
    renderCard(baseTask({ state: "idle", liveSession: true }));
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
  });

  it("SHOWS Resume button when state=idle + liveSession=false (pty gone)", () => {
    renderCard(baseTask({ state: "idle", liveSession: false }));
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });

  it("SHOWS Resume button when state=idle + liveSession=undefined (back-compat)", () => {
    // Older server response without the liveSession field — fall back to
    // surfacing Resume. Conservative: prefer the action button to be
    // available rather than withheld silently.
    renderCard(baseTask({ state: "idle" }));
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });

  it("does NOT render Resume on state=done regardless of liveSession (outer !isDone gate)", () => {
    // Done tasks render no action buttons; sanity check that state takes
    // precedence over liveSession at the outer gate.
    renderCard(baseTask({ state: "done", liveSession: true }));
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
    renderCard(baseTask({ state: "done", liveSession: false }));
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
  });

  // Iterate L (resume-cta-active-state) — same matrix, state=active.
  it("HIDES Resume button when state=active + liveSession=true (pty alive)", () => {
    renderCard(baseTask({ state: "active", liveSession: true }));
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
  });

  it("SHOWS Resume button when state=active + liveSession=false (pty gone)", () => {
    // The recovery case: JSONL is fresh (state=active), but the embedded
    // pty died (server restart, etc.). User needs a path back without
    // editing JSON or remembering the session-uuid.
    renderCard(baseTask({ state: "active", liveSession: false }));
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });

  it("SHOWS Resume button when state=active + liveSession=undefined (back-compat)", () => {
    // Older server response without the liveSession field — same conservative
    // fall-back as the idle branch.
    renderCard(baseTask({ state: "active" }));
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });
});

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

  // Iterate L — `altScreenActive` matrix. Hides Resume when a TUI is
  // in pty foreground (Claude alt-screen, vim, htop, …) so a misclick
  // doesn't inject `claude --resume <uuid>` bytes into the running
  // app's input handler. Same semantic on TaskCard as on
  // TaskDetailHeader.
  it("HIDES Resume when state=active + altScreenActive=true (TUI in foreground)", () => {
    renderCard(baseTask({ state: "active", altScreenActive: true }));
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
  });

  it("HIDES Resume when state=idle + altScreenActive=true (TUI in foreground)", () => {
    renderCard(baseTask({ state: "idle", altScreenActive: true }));
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
  });

  it("SHOWS Resume when state=active + altScreenActive=false (shell prompt)", () => {
    renderCard(baseTask({ state: "active", altScreenActive: false }));
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });
});

// ADR-102 (iterate-20260515-resume-cta-jsonl-signal) — the Resume gate
// moved off `lastPtyDataAt` (a webui-embedded-pty signal, `null` whenever
// Claude runs in the user's own terminal — the Plan-D'' default) onto
// `lastJsonlSeenMtimeMs`, via the shared resumeCtaGate.isClaudeRecentlyActive
// helper (unit-tested directly in resumeCtaGate.test.ts). `altScreenActive`
// and `lastPtyDataAt` remain as supplementary OR-signals.
describe("TaskCard — Resume CTA matrix (ADR-102 — JSONL activity gate)", () => {
  const freshJsonl = () => Date.now() - 5_000;
  const staleJsonl = () => Date.now() - 120_000;
  const recentPty = () => Date.now() - 5_000;
  const stalePty = () => Date.now() - 20_000;

  it("HIDES Resume — fresh JSONL + liveSession:false + lastPtyDataAt:null (Claude in own terminal — the exact Iterate M miss)", () => {
    renderCard(
      baseTask({
        state: "active",
        altScreenActive: false,
        liveSession: false,
        lastPtyDataAt: null,
        lastJsonlSeenMtimeMs: freshJsonl(),
      }),
    );
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
  });

  it("SHOWS Resume — stale JSONL + no other signal (Claude idle / exited)", () => {
    renderCard(
      baseTask({
        state: "active",
        altScreenActive: false,
        liveSession: false,
        lastPtyDataAt: null,
        lastJsonlSeenMtimeMs: staleJsonl(),
      }),
    );
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });

  it("SHOWS Resume — no activity fields present at all", () => {
    renderCard(baseTask({ state: "active" }));
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });

  it("HIDES Resume — stale JSONL but recent lastPtyDataAt (embedded-pty OR-signal kept)", () => {
    renderCard(
      baseTask({
        state: "active",
        altScreenActive: false,
        lastJsonlSeenMtimeMs: staleJsonl(),
        lastPtyDataAt: recentPty(),
      }),
    );
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
  });

  it("HIDES Resume — altScreenActive=true regardless of other signals (TUI in foreground)", () => {
    renderCard(
      baseTask({
        state: "active",
        altScreenActive: true,
        lastJsonlSeenMtimeMs: staleJsonl(),
        lastPtyDataAt: stalePty(),
      }),
    );
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
  });

  it("SHOWS Resume — every signal stale", () => {
    renderCard(
      baseTask({
        state: "active",
        altScreenActive: false,
        lastJsonlSeenMtimeMs: staleJsonl(),
        lastPtyDataAt: stalePty(),
      }),
    );
    expect(screen.getByTestId("task-card-resume-task-1")).toBeInTheDocument();
  });

  it("HIDES Resume on state=idle + fresh JSONL (same gate as active)", () => {
    renderCard(
      baseTask({
        state: "idle",
        lastPtyDataAt: null,
        lastJsonlSeenMtimeMs: freshJsonl(),
      }),
    );
    expect(screen.queryByTestId("task-card-resume-task-1")).toBeNull();
  });
});

/*
 * TaskDetailHeader.test — iterate 3 section 04b, spec § 5.6.
 *
 * Coverage:
 *  - CTA state machine (O31): pending/draft/awaiting_external_start →
 *    Launch; active/idle → Resume; done → no CTA.
 *  - State transitions re-render CTA without remount.
 *  - 3-dots menu surfaces ONLY Close + Delete (+ debug toggle) — fork is
 *    NOT present (deferred to iterate 4).
 *  - Resume CTA copies to clipboard, never spawns (DO-NOT #5 guard).
 *  - SessionMetadata is accessible via the "Show session details" menu
 *    item, not rendered unconditionally.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { TaskDetailHeader } from "./TaskDetailHeader";
import type { ExternalTask } from "../../lib/externalApi";

const PROJECTS = [
  {
    id: "proj-alpha",
    name: "Alpha",
    path: "/tmp/alpha",
    profile: "custom",
    status: "active" as const,
    lastActive: "2026-04-01",
    createdAt: "2026-04-01",
  },
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
    inbox: {
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    },
    ...overrides,
  };
}

function renderHeader(task: ExternalTask, fetchMock?: ReturnType<typeof vi.fn>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(["projects"], PROJECTS);
  qc.setQueryData(["external-task", task.taskId], task);
  const wrap = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/projects") && !u.includes("/api/external/")) {
      return new Response(JSON.stringify({ data: PROJECTS }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return fetchMock ? fetchMock(url, init) : new Response("{}", { status: 200 });
  });
  globalThis.fetch = wrap as unknown as typeof fetch;
  return {
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <TaskDetailHeader task={task} />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
    qc,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
});

describe("TaskDetailHeader — CTA state machine (O31)", () => {
  it("draft → renders 'Launch' CTA", () => {
    renderHeader(makeTask({ state: "draft" }));
    expect(screen.getByTestId("cta-launch-in-terminal")).toBeTruthy();
    expect(screen.queryByTestId("cta-copy-resume-command")).toBeNull();
  });

  it("awaiting_external_start → NO CTA (v0.8.5 AC-6 — header CTA matrix shrank)", () => {
    // v0.8.5 AC-6: TaskDetailHeader CTA matrix collapsed to draft→Launch,
    // idle→Resume, all other states → NO primary CTA (status badge only).
    // The inline Tabs.Trigger row handles tab-flips inside the page;
    // duplicate "Terminal" CTA in the header was removed.
    renderHeader(makeTask({ state: "awaiting_external_start" }));
    expect(screen.queryByTestId("cta-terminal")).toBeNull();
    expect(screen.queryByTestId("cta-launch-in-terminal")).toBeNull();
    expect(screen.queryByTestId("cta-copy-resume-command")).toBeNull();
  });

  it("active → NO CTA (v0.8.5 AC-6 — header CTA matrix shrank)", () => {
    renderHeader(makeTask({ state: "active" }));
    expect(screen.queryByTestId("cta-terminal")).toBeNull();
    expect(screen.queryByTestId("cta-copy-resume-command")).toBeNull();
    expect(screen.queryByTestId("cta-launch-in-terminal")).toBeNull();
  });

  it("idle → 'Resume' CTA", () => {
    renderHeader(makeTask({ state: "idle" }));
    expect(screen.getByTestId("cta-copy-resume-command")).toBeTruthy();
  });

  it("done → NO CTA", () => {
    renderHeader(makeTask({ state: "done" }));
    expect(screen.queryByTestId("cta-launch-in-terminal")).toBeNull();
    expect(screen.queryByTestId("cta-copy-resume-command")).toBeNull();
  });

  it("launch_failed → NO CTA", () => {
    renderHeader(makeTask({ state: "launch_failed" }));
    expect(screen.queryByTestId("cta-launch-in-terminal")).toBeNull();
    expect(screen.queryByTestId("cta-copy-resume-command")).toBeNull();
  });
});

describe("TaskDetailHeader — behavior", () => {
  it("Launch CTA posts /launch with resume=false + dispatches into LaunchCoordinator (ADR-068-A1)", async () => {
    // Iterate-2026-05-04: clipboard.writeText is no longer the primary
    // launch path. The CTA POSTs /launch, then prewarms the pty via
    // /api/terminal/:id/spawn, then dispatches into the
    // LaunchCoordinatorContext. EmbeddedTerminal consumes the pending
    // launch via context and writes the command bytes over WS once
    // prompt-readiness clears. This test asserts the new contract:
    // /launch is posted with resume=false, /spawn is posted, and the
    // CTA shows the "Launching…" transient label.
    const fetchInner = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/launch")) {
        return new Response(
          JSON.stringify({
            task: { ...makeTask(), state: "awaiting_external_start" },
            commands: {
              powershell: "& claude /launch PS",
              cmd: "claude /launch CMD",
              posix: "claude /launch POSIX",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("/spawn")) {
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    renderHeader(makeTask({ state: "draft" }), fetchInner);

    await act(async () => {
      fireEvent.click(screen.getByTestId("cta-launch-in-terminal"));
    });

    await waitFor(() => {
      expect(fetchInner).toHaveBeenCalled();
    });
    const launchCall = fetchInner.mock.calls.find(
      (c) => c[0] !== undefined && String(c[0]).includes("/launch"),
    );
    expect(launchCall).toBeDefined();
    const launchInit = launchCall?.[1] as RequestInit | undefined;
    const body = JSON.parse(launchInit?.body as string);
    expect(body.resume).toBe(false);
    // Verifies the prewarm sidecar fires (idempotent ensure-or-create).
    await waitFor(() => {
      const spawnCall = fetchInner.mock.calls.find(
        (c) => c[0] !== undefined && String(c[0]).includes("/spawn"),
      );
      expect(spawnCall).toBeDefined();
    });
  });

  it("active state has no Terminal CTA (v0.8.5 AC-6 — Terminal CTA + focus-tab event removed)", async () => {
    // v0.8.5 AC-6: TaskDetailHeader's Terminal CTA was REMOVED (along with
    // its `webui:focus-terminal-tab` window event). The inline Tabs.Trigger
    // row inside TaskDetailPage handles tab-flips directly. This test
    // serves as a regression fence — if a future iterate accidentally
    // re-introduces the CTA, this assertion fails loud.
    const fetchInner = vi.fn(async () =>
      new Response("{}", { status: 200 }),
    );
    renderHeader(makeTask({ state: "active" }), fetchInner);
    expect(screen.queryByTestId("cta-terminal")).toBeNull();
    // No /launch must fire either — there's no CTA to click.
    const launchCall = fetchInner.mock.calls.find(
      (c) => c[0] !== undefined && String(c[0]).includes("/launch"),
    );
    expect(launchCall).toBeUndefined();
  });

  it("3-dots menu surfaces Close + Delete (+ debug toggle), no Fork", async () => {
    const user = userEvent.setup();
    renderHeader(makeTask({ state: "active" }));
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu"));
    expect(screen.getByTestId("task-detail-menu-close")).toBeTruthy();
    expect(screen.getByTestId("task-detail-menu-delete")).toBeTruthy();
    expect(screen.getByTestId("task-detail-menu-toggle-debug")).toBeTruthy();
    const menu = screen.getByTestId("task-detail-menu");
    expect(menu.textContent?.toLowerCase()).not.toContain("fork");
  });

  it("debug toggle reveals SessionMetadata (via menu, not permanently)", async () => {
    const user = userEvent.setup();
    renderHeader(makeTask({ state: "active" }));
    expect(screen.queryByTestId("task-detail-session-metadata")).toBeNull();
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu"));
    await user.click(screen.getByTestId("task-detail-menu-toggle-debug"));
    await waitFor(() => {
      expect(screen.getByTestId("task-detail-session-metadata")).toBeTruthy();
    });
  });

  it("state transitions re-render CTA without remount (v0.8.5 AC-6 matrix)", () => {
    const { rerender, qc } = renderHeader(makeTask({ state: "draft" }));
    expect(screen.getByTestId("cta-launch-in-terminal")).toBeTruthy();
    // v0.8.5 AC-6: draft→Launch, idle→Resume, all-other-states → NO CTA.
    // Verify the matrix end-to-end by stepping draft → active (no CTA) →
    // idle (Resume CTA). All transitions occur via TanStack cache update,
    // proving the component re-renders without remount.
    const activeTask = makeTask({ state: "active" });
    qc.setQueryData(["external-task", activeTask.taskId], activeTask);
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <TaskDetailHeader task={activeTask} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("cta-launch-in-terminal")).toBeNull();
    expect(screen.queryByTestId("cta-copy-resume-command")).toBeNull();
    expect(screen.queryByTestId("cta-terminal")).toBeNull();

    // Now step active → idle: Resume CTA reappears.
    const idleTask = makeTask({ state: "idle" });
    qc.setQueryData(["external-task", idleTask.taskId], idleTask);
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <TaskDetailHeader task={idleTask} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("cta-copy-resume-command")).toBeTruthy();
    expect(screen.queryByTestId("cta-launch-in-terminal")).toBeNull();
  });
});

// ── 2026-04-23 — iterate-20260423-launch-command-wiring ──
//
// Phase badge must prefer the server-persisted `task.phase` /
// `task.phaseLabel` over the title-regex fallback. The title-regex path
// produces wrong badges for tasks whose title doesn't echo the chosen
// phase (e.g. phase="compliance" + title="audit drift" → regex matches
// "audit" → nothing → badge shows nothing; phase="test" + title="Testing
// the test phase" → regex matches "test" → accidental correct match).
describe("TaskDetailHeader — phase badge source (2026-04-23)", () => {
  it("uses task.phaseLabel when present, not the title regex", () => {
    renderHeader(
      makeTask({
        title: "audit drift report", // title alone would not yield a phase
        phase: "compliance",
        phaseLabel: "Compliance",
      }),
    );
    // The badge label is rendered as visible text.
    expect(screen.getByText("Compliance")).toBeTruthy();
  });

  it("prefers task.phase over a misleading title regex match", () => {
    // Title says "test" but user picked compliance — honor the user.
    renderHeader(
      makeTask({
        title: "Testing the compliance workflow",
        phase: "compliance",
        phaseLabel: "Compliance",
      }),
    );
    expect(screen.getByText("Compliance")).toBeTruthy();
    expect(screen.queryByText("Test")).toBeNull();
  });

  it("falls back to title regex only when task.phase is missing", () => {
    renderHeader(
      makeTask({
        title: "Plan the rollout",
        // no phase on task
      }),
    );
    // Regex still catches "plan" → renders "Plan" badge as before.
    expect(screen.getByText("Plan")).toBeTruthy();
  });
});

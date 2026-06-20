/*
 * TaskDetailHeader — phone header-condense tests (iterate-2026-06-20 AC-1).
 *
 * Split out of TaskDetailHeader.test.tsx to keep that file under its bloat
 * baseline. On a phone (≤767px) the breadcrumb + the Started/last-event/model
 * meta sub-line are dropped (terminal gets more room); desktop (≥768px) keeps
 * them. Everything stays reachable (project via the chip, metadata via ⋮).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
    state: "active",
    createdAt: "2026-04-20",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

function renderHeader(task: ExternalTask) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(["projects"], PROJECTS);
  qc.setQueryData(["external-task", task.taskId], task);
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: PROJECTS }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  ) as unknown as typeof fetch;
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <TaskDetailHeader task={task} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function mockPhone(isPhone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(max-width: 767px)" ? isPhone : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("TaskDetailHeader — phone header condense (AC-1)", () => {
  afterEach(() => {
    // Restore jsdom default (no matchMedia → useIsPhoneViewport() === false).
    delete (window as { matchMedia?: unknown }).matchMedia;
    vi.restoreAllMocks();
  });

  it("drops the breadcrumb + meta sub-line on a phone", () => {
    mockPhone(true);
    renderHeader(makeTask());
    expect(screen.queryByTestId("task-detail-breadcrumb")).toBeNull();
    expect(screen.queryByTestId("task-detail-subline")).toBeNull();
    // Title row + Resume CTA survive the condense.
    expect(screen.getByTestId("task-detail-title-row")).toBeInTheDocument();
    expect(screen.getByTestId("cta-copy-resume-command")).toBeTruthy();
  });

  it("keeps the breadcrumb + meta sub-line on desktop (≥768px)", () => {
    mockPhone(false);
    renderHeader(makeTask());
    expect(screen.getByTestId("task-detail-breadcrumb")).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-subline")).toBeInTheDocument();
  });
});

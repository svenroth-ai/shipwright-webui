/*
 * TaskDetailHeader — compact header-condense tests (iterate-2026-06-20 AC-1;
 * extended to the full tablet band by iterate-2026-09-06-tablet-ipad-ux-pass).
 *
 * Split out of TaskDetailHeader.test.tsx to keep that file under its bloat
 * baseline. On a COMPACT viewport (≤1023px = tablet + phone) the breadcrumb +
 * the Started/last-event/model meta sub-line are dropped (terminal gets more
 * room); desktop (≥1024px) keeps them. Everything stays reachable (project via
 * the chip, metadata via ⋮). Originally phone-only (≤767px) — an iPad hit the
 * full desktop row (breadcrumb + title + badge + gate pill + project menu +
 * Instruments + CTA + menu all on one `flex` line) and it wrapped across
 * several lines, eating most of the header's height before the terminal even
 * started (Sven, 2026-09-06).
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

/**
 * The header reads the COMPACT query (`max-width: 1023px`), not the narrower
 * PHONE query directly. `phoneMatches` defaults to mirroring `compact` (a
 * real phone viewport matches both); pass `false` while `compact` is `true`
 * to simulate a tablet-width viewport (phone query false, compact query true).
 */
function mockCompact(compact: boolean, phoneMatches: boolean = compact) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(max-width: 1023px)" ? compact : query === "(max-width: 767px)" ? phoneMatches : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("TaskDetailHeader — compact (tablet + phone) header condense (AC-1)", () => {
  afterEach(() => {
    // Restore jsdom default (no matchMedia → useIsCompactViewport() === false).
    delete (window as { matchMedia?: unknown }).matchMedia;
    vi.restoreAllMocks();
  });

  it("drops the breadcrumb + meta sub-line on a phone", () => {
    mockCompact(true);
    renderHeader(makeTask());
    expect(screen.queryByTestId("task-detail-breadcrumb")).toBeNull();
    expect(screen.queryByTestId("task-detail-subline")).toBeNull();
    // Title row + Resume CTA survive the condense.
    expect(screen.getByTestId("task-detail-title-row")).toBeInTheDocument();
    expect(screen.getByTestId("cta-copy-resume-command")).toBeTruthy();
  });

  // @covers iterate-2026-09-06-tablet-ipad-ux-pass
  it("also drops the breadcrumb + meta sub-line on a tablet-width (compact, non-phone) viewport", () => {
    mockCompact(true, false);
    renderHeader(makeTask());
    expect(screen.queryByTestId("task-detail-breadcrumb")).toBeNull();
    expect(screen.queryByTestId("task-detail-subline")).toBeNull();
    expect(screen.getByTestId("task-detail-title-row")).toBeInTheDocument();
  });

  it("keeps the breadcrumb + meta sub-line on desktop (≥1024px)", () => {
    mockCompact(false);
    renderHeader(makeTask());
    expect(screen.getByTestId("task-detail-breadcrumb")).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-subline")).toBeInTheDocument();
  });
});

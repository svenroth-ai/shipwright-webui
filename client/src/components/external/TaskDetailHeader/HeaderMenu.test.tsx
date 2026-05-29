/*
 * HeaderMenu.test — Campaign C / C6.
 *
 * Happy + edge paths:
 *  - menu state-conditional items: present for In-Progress states.
 *  - Copy session UUID emits a success "ok" notice (regression for the
 *    silent-catch-{} bug that was fixed in resume-cta-rework).
 *  - debug toggle invokes the shell's onToggleDebug callback exactly once.
 *  - Clear terminal history opens the confirm dialog (via rAF) — edge path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { HeaderMenu } from "./HeaderMenu";
import type { ExternalTask } from "../../../lib/externalApi";

function makeTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-menu",
    sessionUuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    cwd: "C:/tmp/demo",
    pluginDirs: [],
    title: "Menu test",
    projectId: "proj-x",
    state: "active",
    createdAt: "2026-04-20",
    inbox: {
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    },
    ...overrides,
  };
}

interface RenderOpts {
  task?: ExternalTask;
  showDebug?: boolean;
  onOpenEditTask?: () => void;
  onRename?: () => void;
  onOpenProjectPicker?: () => void;
  onDeleteClick?: () => void;
  onToggleDebug?: () => void;
  fetchMock?: ReturnType<typeof vi.fn>;
}

function renderMenu(opts: RenderOpts = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  globalThis.fetch = (opts.fetchMock ??
    vi.fn(async () => new Response("{}", { status: 200 }))) as unknown as typeof fetch;
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <HeaderMenu
          task={opts.task ?? makeTask()}
          showDebug={opts.showDebug ?? false}
          onOpenEditTask={opts.onOpenEditTask ?? (() => {})}
          onRename={opts.onRename ?? (() => {})}
          onOpenProjectPicker={opts.onOpenProjectPicker ?? (() => {})}
          onDeleteClick={opts.onDeleteClick ?? (() => {})}
          onToggleDebug={opts.onToggleDebug ?? (() => {})}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
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

describe("HeaderMenu — present-state matrix (happy path)", () => {
  it("trigger button is always present", async () => {
    renderMenu();
    expect(screen.getByTestId("task-detail-menu-trigger")).toBeTruthy();
  });

  it("shows Move to Backlog item for In-Progress states (active)", async () => {
    const user = userEvent.setup();
    renderMenu({ task: makeTask({ state: "active" }) });
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu"));
    expect(screen.getByTestId("task-detail-menu-backlog")).toBeTruthy();
  });

  it("hides Move to Backlog for draft", async () => {
    const user = userEvent.setup();
    renderMenu({ task: makeTask({ state: "draft" }) });
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu"));
    expect(screen.queryByTestId("task-detail-menu-backlog")).toBeNull();
  });

  it("hides Copy Resume command for draft, shows for non-draft", async () => {
    const user = userEvent.setup();
    const { unmount } = renderMenu({ task: makeTask({ state: "draft" }) });
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu"));
    expect(
      screen.queryByTestId("task-detail-menu-copy-resume-command"),
    ).toBeNull();
    unmount();

    renderMenu({ task: makeTask({ state: "active" }) });
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu"));
    expect(
      screen.getByTestId("task-detail-menu-copy-resume-command"),
    ).toBeTruthy();
  });
});

describe("HeaderMenu — baseline matrix (OpenAI MEDIUM — Close/Delete/debug presence)", () => {
  it("opened menu surfaces Close + Delete + debug toggle items for active state", async () => {
    const user = userEvent.setup();
    renderMenu({ task: makeTask({ state: "active" }) });
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu"));
    expect(screen.getByTestId("task-detail-menu-close")).toBeTruthy();
    expect(screen.getByTestId("task-detail-menu-delete")).toBeTruthy();
    expect(screen.getByTestId("task-detail-menu-toggle-debug")).toBeTruthy();
  });

  it("Close menu item invokes the close mutation (Close present + functional)", async () => {
    const user = userEvent.setup();
    const fetchInner = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        if (String(url).includes("/close")) {
          return new Response(JSON.stringify({ task: makeTask() }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("{}", { status: 200 });
      },
    );
    renderMenu({ task: makeTask({ state: "active" }), fetchMock: fetchInner });
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu-close"));
    await user.click(screen.getByTestId("task-detail-menu-close"));
    await waitFor(() => {
      expect(
        fetchInner.mock.calls.some((c) => String(c[0]).includes("/close")),
      ).toBe(true);
    });
  });

  it("Delete menu item invokes onDeleteClick callback (delete delegated to shell)", async () => {
    const user = userEvent.setup();
    const onDeleteClick = vi.fn();
    renderMenu({ task: makeTask({ state: "active" }), onDeleteClick });
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu-delete"));
    await user.click(screen.getByTestId("task-detail-menu-delete"));
    expect(onDeleteClick).toHaveBeenCalledTimes(1);
  });
});

describe("HeaderMenu — action callbacks (edge paths)", () => {
  it("debug toggle invokes onToggleDebug exactly once (OAI-8 — action sequencing)", async () => {
    const user = userEvent.setup();
    const onToggleDebug = vi.fn();
    renderMenu({ onToggleDebug });
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu"));
    await user.click(screen.getByTestId("task-detail-menu-toggle-debug"));
    expect(onToggleDebug).toHaveBeenCalledTimes(1);
  });

  it("Rename → onRename callback fires (OAI-4 — ref ownership)", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    renderMenu({ onRename });
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu"));
    await user.click(screen.getByTestId("task-detail-menu-rename"));
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("Copy session UUID emits an 'ok' menuNotice (OAI-8 — copy action coverage)", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
      writable: true,
    });
    renderMenu();
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu-copy-uuid"));
    await user.click(screen.getByTestId("task-detail-menu-copy-uuid"));
    const notice = await screen.findByTestId("task-detail-menu-notice");
    expect(notice.dataset.kind).toBe("ok");
  });

  it("Clear terminal history → confirm dialog opens (rAF deferral preserved)", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu"));
    await user.click(screen.getByTestId("task-detail-menu-clear-history"));
    const dialog = await screen.findByTestId("confirm-clear-history-dialog");
    expect(dialog).toBeTruthy();
  });
});

describe("HeaderMenu — unmount teardown-leak regression", () => {
  // flashMenuNotice schedules a 2600 ms reset timer with no unmount
  // cleanup. Same defect class as LaunchCTA/ResumeCTA — a timer firing
  // after jsdom teardown throws `ReferenceError: window is not defined`.
  it("clears the pending menu-notice timer on unmount", async () => {
    const user = userEvent.setup();
    const setSpy = vi.spyOn(globalThis, "setTimeout");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
      writable: true,
    });
    const { unmount } = renderMenu();
    await user.click(screen.getByTestId("task-detail-menu-trigger"));
    await waitFor(() => screen.getByTestId("task-detail-menu-copy-uuid"));
    await user.click(screen.getByTestId("task-detail-menu-copy-uuid"));
    // Copy-UUID success → flashMenuNotice scheduled the 2600 ms timer.
    await screen.findByTestId("task-detail-menu-notice");
    const idx = setSpy.mock.calls.findIndex((c) => c[1] === 2600);
    expect(idx).toBeGreaterThanOrEqual(0);
    const timerId = setSpy.mock.results[idx]!.value;
    unmount();
    expect(clearSpy.mock.calls.some((c) => c[0] === timerId)).toBe(true);
  });
});

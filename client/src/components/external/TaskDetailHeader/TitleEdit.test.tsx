/*
 * TitleEdit.test — Campaign C / C6.
 *
 * Happy + edge paths:
 *  - default render shows the task title + edit affordance (testid: task-title-display).
 *  - ENTER commits → POST /tasks/:id (server PATCH via useRenameTask).
 *  - ESC reverts (no PATCH fired) — edge path.
 *  - imperative startEdit() ref puts the component into edit mode.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRef } from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { TitleEdit, type TitleEditHandle } from "./TitleEdit";
import type { ExternalTask } from "../../../lib/externalApi";

function makeTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-rename",
    sessionUuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    cwd: "C:/tmp/demo",
    pluginDirs: [],
    title: "Original title",
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

function renderEditor(
  task: ExternalTask,
  ref?: React.Ref<TitleEditHandle>,
  fetchMock?: ReturnType<typeof vi.fn>,
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(["external-task", task.taskId], task);
  globalThis.fetch = (fetchMock ??
    vi.fn(async () => new Response("{}", { status: 200 }))) as unknown as typeof fetch;
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <TitleEdit ref={ref} task={task} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("TitleEdit — default render (happy path)", () => {
  it("renders the title-display button with the task title", () => {
    renderEditor(makeTask());
    const display = screen.getByTestId("task-title-display");
    expect(display.textContent).toContain("Original title");
  });

  it("startEdit() imperative handle enters edit mode (regression fence for OAI-4)", async () => {
    const ref = createRef<TitleEditHandle>();
    renderEditor(makeTask(), ref);
    expect(screen.queryByTestId("task-title-input-edit")).toBeNull();
    await act(async () => {
      ref.current?.startEdit();
    });
    await waitFor(() => {
      expect(screen.getByTestId("task-title-input-edit")).toBeTruthy();
    });
  });
});

describe("TitleEdit — commit/revert edge paths", () => {
  it("ENTER → PATCH server with new title (commit path)", async () => {
    const ref = createRef<TitleEditHandle>();
    const fetchInner = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/external/tasks/task-rename") && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({ ...makeTask(), title: "Renamed!" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });
    renderEditor(makeTask(), ref, fetchInner);
    await act(async () => {
      ref.current?.startEdit();
    });
    const input = (await screen.findByTestId(
      "task-title-input-edit",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed!" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const patchCall = fetchInner.mock.calls.find(
        (c) =>
          String(c[0]).includes("/api/external/tasks/task-rename") &&
          (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
    });
  });

  it("ESC → no PATCH fired (revert path)", async () => {
    const ref = createRef<TitleEditHandle>();
    const fetchInner = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response("{}", { status: 200 }),
    );
    renderEditor(makeTask(), ref, fetchInner);
    await act(async () => {
      ref.current?.startEdit();
    });
    const input = (await screen.findByTestId(
      "task-title-input-edit",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Should not save" } });
    fireEvent.keyDown(input, { key: "Escape" });
    // Allow microtasks to flush; ESC must NOT trigger a PATCH.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const patchCall = fetchInner.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patchCall).toBeUndefined();
  });
});

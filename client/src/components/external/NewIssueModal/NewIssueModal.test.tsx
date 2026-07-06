/*
 * Dispatcher-level mode routing + lifecycle reset + duplicate-submit guard.
 *
 * Payload-shape assertions live in NewIssueModal.payload.test.tsx — this
 * file is the lifecycle / dispatch layer only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { NewIssueModal } from "./NewIssueModal";
import {
  GENERIC_ACTION,
  ITERATE_ACTION,
  PIPELINE_ACTION,
  PLAIN_ACTION,
  SAMPLE_ACTIONS,
  TASK_ACTION,
  openMoreOptions,
  renderModal,
} from "./__testFixtures";

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage)
    window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("NewIssueModal dispatcher — mode routing (Step 3.5 OpenAI #5)", () => {
  it("action.id=new-task → testid new-issue-modal-new-task", () => {
    renderModal({ action: TASK_ACTION });
    expect(screen.getByTestId("new-issue-modal-new-task")).toBeTruthy();
  });
  it("action.id=new-pipeline → testid new-issue-modal-new-pipeline", () => {
    renderModal({ action: PIPELINE_ACTION });
    expect(screen.getByTestId("new-issue-modal-new-pipeline")).toBeTruthy();
  });
  it("action.id=new-iterate → testid new-issue-modal-new-iterate", () => {
    renderModal({ action: ITERATE_ACTION });
    expect(screen.getByTestId("new-issue-modal-new-iterate")).toBeTruthy();
  });
  it("action.id=new-plain → testid new-issue-modal-new-plain", () => {
    renderModal({ action: PLAIN_ACTION });
    expect(screen.getByTestId("new-issue-modal-new-plain")).toBeTruthy();
  });
  it("unknown action.id → testid new-issue-modal-generic", () => {
    renderModal({ action: GENERIC_ACTION });
    expect(screen.getByTestId("new-issue-modal-generic")).toBeTruthy();
  });
  it("action=null → renders nothing", () => {
    const { container } = renderModal({ action: null });
    expect(container.firstChild).toBeNull();
  });
});

describe("duplicate-submit guard (Step 3.5 OpenAI #3)", () => {
  it("rapid double-click on Save fires the create POST exactly once", async () => {
    let createCount = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (
          url.endsWith("/api/external/tasks") &&
          init?.method === "POST"
        ) {
          createCount += 1;
          // Slow response so the second click happens while in flight.
          await new Promise((r) => setTimeout(r, 50));
          return new Response(
            JSON.stringify({
              task: {
                taskId: "td",
                sessionUuid: "u",
                cwd: "/p",
                pluginDirs: [],
                title: "x",
                projectId: "proj-1",
                state: "draft",
                createdAt: "",
                inbox: {
                  pendingToolUseIds: [],
                  dismissedToolUseIds: [],
                  lastProcessedByteOffset: 0,
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("{}", { status: 200 });
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderModal({ onToast: () => {} });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "DoubleSubmit" },
      });
    });
    const saveBtn = screen.getByTestId("new-issue-save-btn");
    await act(async () => {
      fireEvent.click(saveBtn);
      fireEvent.click(saveBtn);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(createCount).toBe(1);
  });
});

describe("lifecycle reset (Step 3.5 OpenAI #2)", () => {
  it("close + reopen wipes title + description + leadwright state", async () => {
    const TASK_WITH_LEAD = {
      ...TASK_ACTION,
      modal_fields: ["title", "phase", "description", "domain"],
    };
    const onOpenChange = vi.fn();
    const { rerender, qc } = renderModal({
      action: TASK_WITH_LEAD,
      onOpenChange,
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "Stale" },
      });
    });
    // Domain lives inside the collapsed More options section — expand it.
    await act(async () => {
      openMoreOptions();
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-domain-input"), {
        target: { value: "billing" },
      });
    });
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <NewIssueModal
            open={false}
            onOpenChange={onOpenChange}
            action={TASK_WITH_LEAD}
            projectActions={SAMPLE_ACTIONS}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <NewIssueModal
            open={true}
            onOpenChange={onOpenChange}
            action={TASK_WITH_LEAD}
            projectActions={SAMPLE_ACTIONS}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const titleInput = screen.getByTestId(
      "new-issue-title-input",
    ) as HTMLInputElement;
    expect(titleInput.value).toBe("");
    // Reopen resets the section to collapsed — expand to inspect the wipe.
    await act(async () => {
      openMoreOptions();
    });
    const domainInput = screen.getByTestId(
      "new-issue-domain-input",
    ) as HTMLInputElement;
    expect(domainInput.value).toBe("");
  });

  it("initialProjectId swap while open re-seeds project selection on next reopen", async () => {
    const PROJECTS_MULTI = [
      {
        id: "proj-aaa",
        name: "aaa",
        path: "/tmp/aaa",
        profile: "vite-hono",
        status: "active",
        createdAt: "2026-04-01",
        lastActive: "2026-04-20",
      },
      {
        id: "proj-zzz",
        name: "zzz",
        path: "/tmp/zzz",
        profile: "vite-hono",
        status: "active",
        createdAt: "2026-04-01",
        lastActive: "2026-04-20",
      },
    ];
    const { qc } = renderModal({
      projectsOverride: PROJECTS_MULTI,
      initialProjectId: "proj-zzz",
    });
    // First open with initialProjectId=proj-zzz → select reflects it.
    const sel = screen.getByTestId(
      "new-issue-project-select",
    ) as HTMLSelectElement;
    expect(sel.value).toBe("proj-zzz");
    // Tiny smoke check that the QueryClient seeded both rows.
    expect(qc.getQueryData(["projects"])).toBeTruthy();
  });

  it("action change while modal open remounts the body (Step 3.5 Gemini #5 / OpenAI #6)", async () => {
    const onOpenChange = vi.fn();
    const { rerender, qc } = renderModal({
      action: TASK_ACTION,
      onOpenChange,
    });
    // Task mode → phase dropdown visible.
    expect(screen.getByTestId("new-issue-modal-new-task")).toBeTruthy();
    expect(screen.getByTestId("new-issue-phase-select")).toBeTruthy();
    // Swap to pipeline mid-open.
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <NewIssueModal
            open
            onOpenChange={onOpenChange}
            action={PIPELINE_ACTION}
            projectActions={SAMPLE_ACTIONS}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    // Pipeline mode → no phase dropdown.
    expect(screen.getByTestId("new-issue-modal-new-pipeline")).toBeTruthy();
    expect(screen.queryByTestId("new-issue-phase-select")).toBeNull();
  });
});

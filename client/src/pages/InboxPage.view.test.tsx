/**
 * InboxPage — the remembered view + the Triage-matching body box
 * (iterate-2026-11-13-inbox-triage-look).
 *
 *  - folding a project group hides its cards and survives a remount;
 *  - a saved project order is honoured, and the arrow keys on a group's handle
 *    move it (and persist);
 *  - the page body uses the SAME scroller padding + container as the Triage
 *    page, so the content's left edge does not jump between the two pages.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import InboxPage from "./InboxPage";
import { useExternalInbox } from "../hooks/useExternalInbox";
import { useExternalTasks } from "../hooks/useExternalTasks";
import { useProjects } from "../hooks/useProjects";
import { INBOX_VIEW_STORAGE_KEY } from "../lib/inboxViewStorage";
import { makeAskItem, makeProject, makeTask } from "./inbox/__fixtures__/inbox-fixtures";

vi.mock("../hooks/useExternalInbox", () => ({ useExternalInbox: vi.fn() }));
vi.mock("../hooks/useExternalTasks", () => ({ useExternalTasks: vi.fn() }));
vi.mock("../hooks/useProjects", () => ({ useProjects: vi.fn() }));

const mockedInbox = vi.mocked(useExternalInbox);
const mockedTasks = vi.mocked(useExternalTasks);
const mockedProjects = vi.mocked(useProjects);

function wire() {
  mockedInbox.mockReturnValue({
    data: [
      makeAskItem({ taskId: "task-A", sessionUuid: "sess-A", toolUseId: "tu-A" }),
      makeAskItem({ taskId: "task-B", sessionUuid: "sess-B", toolUseId: "tu-B" }),
    ],
    isLoading: false,
  } as unknown as ReturnType<typeof useExternalInbox>);
  mockedTasks.mockReturnValue({
    data: [
      makeTask({ taskId: "task-A", sessionUuid: "sess-A", projectId: "proj-a" }),
      makeTask({ taskId: "task-B", sessionUuid: "sess-B", projectId: "proj-b" }),
    ],
    isLoading: false,
  } as unknown as ReturnType<typeof useExternalTasks>);
  mockedProjects.mockReturnValue({
    data: [
      makeProject({ id: "proj-a", name: "Project A" }),
      makeProject({ id: "proj-b", name: "Project B" }),
    ],
    isLoading: false,
  } as unknown as ReturnType<typeof useProjects>);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InboxPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function groupOrder(): string[] {
  return screen
    .getAllByTestId(/^inbox-project-group-proj-[ab]$/)
    .map((el) => el.getAttribute("data-testid")!.replace("inbox-project-group-", ""));
}

// @covers FR-01.04
describe("InboxPage — remembered view", () => {
  beforeEach(() => {
    window.localStorage.clear();
    wire();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("folding a project group hides its cards, keeps the others, and survives a remount", () => {
    const first = renderPage();
    expect(screen.getByTestId("inbox-card-tu-A")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inbox-project-group-toggle-proj-a"));
    expect(screen.queryByTestId("inbox-card-tu-A")).not.toBeInTheDocument();
    expect(screen.getByTestId("inbox-card-tu-B")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(INBOX_VIEW_STORAGE_KEY)!).collapsed).toEqual(["proj-a"]);

    first.unmount();
    renderPage();
    expect(screen.queryByTestId("inbox-card-tu-A")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inbox-project-group-toggle-proj-a"));
    expect(screen.getByTestId("inbox-card-tu-A")).toBeInTheDocument();
  });

  it("honours a saved project order", () => {
    window.localStorage.setItem(
      INBOX_VIEW_STORAGE_KEY,
      JSON.stringify({ v: 1, collapsed: [], projectOrder: ["proj-b", "proj-a"] }),
    );
    renderPage();
    expect(groupOrder()).toEqual(["proj-b", "proj-a"]);
  });

  it("the arrow keys on a group's handle move it and the new order is remembered", () => {
    renderPage();
    expect(groupOrder()).toEqual(["proj-a", "proj-b"]);
    fireEvent.keyDown(screen.getByTestId("inbox-group-handle-proj-a"), { key: "ArrowDown" });
    expect(groupOrder()).toEqual(["proj-b", "proj-a"]);
    expect(JSON.parse(window.localStorage.getItem(INBOX_VIEW_STORAGE_KEY)!).projectOrder).toEqual([
      "proj-b",
      "proj-a",
    ]);
  });

  it("a project with no open item today keeps its saved slot when another group is moved", () => {
    window.localStorage.setItem(
      INBOX_VIEW_STORAGE_KEY,
      JSON.stringify({ v: 1, collapsed: [], projectOrder: ["proj-a", "proj-gone", "proj-b"] }),
    );
    renderPage();
    fireEvent.keyDown(screen.getByTestId("inbox-group-handle-proj-a"), { key: "ArrowDown" });
    expect(groupOrder()).toEqual(["proj-b", "proj-a"]);
    const saved = JSON.parse(window.localStorage.getItem(INBOX_VIEW_STORAGE_KEY)!).projectOrder as string[];
    expect(saved).toContain("proj-gone");
    expect(saved.indexOf("proj-b")).toBeLessThan(saved.indexOf("proj-a"));
  });

  it("a single group has no move handle", () => {
    mockedInbox.mockReturnValue({
      data: [makeAskItem({ taskId: "task-A", sessionUuid: "sess-A", toolUseId: "tu-A" })],
      isLoading: false,
    } as unknown as ReturnType<typeof useExternalInbox>);
    renderPage();
    expect(screen.queryByTestId("inbox-group-handle-proj-a")).not.toBeInTheDocument();
  });
});

// @covers FR-01.04
describe("Inbox and Triage share ONE body box (no left-edge jump when switching pages)", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const read = (f: string) => readFileSync(path.join(dir, f), "utf8");

  it("both pages use the same scroller padding and the same container", () => {
    for (const f of ["InboxPage.tsx", "TriagePage.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("flex-1 overflow-y-auto pt-4 pb-10 md:pt-6");
      expect(src, f).toContain("page-container density-surface");
    }
  });
});

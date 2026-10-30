import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { MissionInfoSidebar } from "./MissionInfoSidebar";
import type { ExternalTask } from "../../../lib/externalApi";

vi.mock("../FolderTree", () => ({
  FolderTree: ({ onSelect }: { onSelect: (p: string) => void }) => (
    <button data-testid="ft-stub" onClick={() => onSelect("README.md")}>tree</button>
  ),
}));
vi.mock("../SmartViewer", () => ({
  SmartViewer: ({ path }: { path: string | null }) => <div data-testid="sv-stub">{path ?? "empty"}</div>,
}));

const JSON_HDR = { "content-type": "application/json" };
const task = { taskId: "t1", projectId: "p1", cwd: "C:\\dev\\app", state: "active" } as unknown as ExternalTask;

const outputs = Array.from({ length: 7 }, (_, i) => ({
  path: `C:\\dev\\app\\src\\f${i}.ts`, tool: "Write", firstAt: null, lastAt: `2026-01-0${i + 1}`, agentId: null,
}));
outputs.push({ path: "D:\\other\\x.md", tool: "Write", firstAt: null, lastAt: "2025-01-01", agentId: null });

const info = {
  status: "ok",
  info: {
    sessionUuid: "u",
    context: { tokens: 12345, model: "claude-opus-4-7-20260101", at: null, compactedSince: false, tokensAfterCompaction: null },
    compaction: { count: 0, last: null },
    outputs,
    remoteControl: { active: true, onceEnabled: true, pid: 1 },
    subagents: [],
    scan: { truncated: false, scannedBytes: 1, sizeBytes: 1, outputsTruncated: 0, subagentsTruncated: 0 },
  },
};

let fetchMock: ReturnType<typeof vi.fn>;
const infoCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("session-info")).length;

function mount(compact = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MissionInfoSidebar task={task} compact={compact} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn(async (url: string) =>
    String(url).includes("/projects/")
      ? new Response(JSON.stringify({ data: { id: "p1", path: "C:/dev/app" } }), { status: 200, headers: JSON_HDR })
      : new Response(JSON.stringify(info), { status: 200, headers: JSON_HDR }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("MissionInfoSidebar", () => {
  it("renders Environment/Context/Outputs with tokens+model and no percentage", async () => {
    mount();
    expect(await screen.findByTestId("env-tokens")).toHaveTextContent("12.3k");
    expect(screen.getByTestId("env-model")).toHaveTextContent("claude-opus-4-7");
    expect(screen.getByTestId("env-context").textContent).not.toContain("%");
    expect(screen.getByTestId("env-folder")).toHaveTextContent("C:\\dev\\app");
    await waitFor(() => expect(screen.getByTestId("env-remote-pill")).toHaveTextContent("On"));
  });

  it("shows 5 outputs, Show more reveals the rest, outside-cwd file is inert", async () => {
    mount();
    await screen.findAllByTestId("env-output");
    expect(screen.getAllByTestId("env-output")).toHaveLength(5);
    fireEvent.click(screen.getByTestId("env-outputs-more"));
    expect(screen.getAllByTestId("env-output")).toHaveLength(7);
    expect(screen.getAllByTestId("env-output-inert")).toHaveLength(1);
  });

  it("clicking an output opens it in the Viewer segment", async () => {
    mount();
    const outs = await screen.findAllByTestId("env-output");
    fireEvent.click(outs[0]);
    expect(await screen.findByTestId("sv-stub")).toHaveTextContent("src/f6.ts");
    expect(JSON.parse(localStorage.getItem("shipwright:mission-sidebar")!).segment).toBe("viewer");
  });

  it("Folders segment reuses FolderTree and selecting opens the Viewer", async () => {
    mount();
    fireEvent.click(screen.getByTestId("mission-side-seg-folders"));
    fireEvent.click(await screen.findByTestId("ft-stub"));
    expect(await screen.findByTestId("sv-stub")).toHaveTextContent("README.md");
  });

  it("resizes via keyboard (persisted) and collapses", () => {
    mount();
    fireEvent.keyDown(screen.getByTestId("mission-side-splitter"), { key: "ArrowLeft" });
    expect(JSON.parse(localStorage.getItem("shipwright:mission-sidebar")!).width).toBe(330);
    fireEvent.click(screen.getByTestId("mission-side-collapse"));
    expect(screen.getByTestId("mission-side-expand")).toBeInTheDocument();
    expect(screen.queryByTestId("mission-side")).toBeNull();
  });

  it("compact mode has no splitter or collapse", () => {
    mount(true);
    expect(screen.queryByTestId("mission-side-splitter")).toBeNull();
    expect(screen.queryByTestId("mission-side-collapse")).toBeNull();
  });

  it("has no textarea / chat surface", () => {
    const { container } = mount();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("[data-testid^='chat-']")).toBeNull();
  });

  it("no session yet ({status:'missing'}) shows an explicit empty state and an unknown pill", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ status: "missing" }), { status: 200, headers: { "content-type": "application/json" } }));
    mount();
    expect(await screen.findByTestId("env-missing")).toBeInTheDocument();
    expect(screen.getByTestId("env-remote-unknown")).toHaveTextContent("Unknown");
    expect(screen.queryByTestId("env-remote-pill")).toBeNull();
  });

  it("a failed request is a non-blocking error state, never On/Off; Refresh recovers", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("{}", { status: 500, headers: { "content-type": "application/json" } }));
    mount();
    expect(await screen.findByTestId("env-error")).toBeInTheDocument();
    expect(screen.getByTestId("env-remote-unknown")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("env-refresh"));
    await waitFor(() => expect(screen.getByTestId("env-remote-pill")).toHaveTextContent("On"));
    expect(screen.queryByTestId("env-error")).toBeNull();
  });

  it("shows a loading state before the first answer", () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    mount();
    expect(screen.getByTestId("env-context-empty")).toHaveTextContent("Loading");
  });

  it("has NO timer: one request on mount, a manual Refresh adds exactly one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount();
      await screen.findByTestId("env-tokens");
      expect(infoCalls()).toBe(1);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(infoCalls()).toBe(1);
      fireEvent.click(screen.getByTestId("env-refresh"));
      await waitFor(() => expect(infoCalls()).toBe(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("the sidebar yielding (CSS) leaves the persisted layout untouched", () => {
    mount();
    fireEvent.keyDown(screen.getByTestId("mission-side-splitter"), { key: "ArrowLeft" });
    const saved = localStorage.getItem("shipwright:mission-sidebar");
    expect(saved).toContain("330");
    // Re-mounting (what closing an artifact card does to the row) restores the user's width.
    cleanup();
    mount();
    expect(screen.getByTestId("mission-side").style.width).toBe("330px");
    expect(localStorage.getItem("shipwright:mission-sidebar")).toBe(saved);
  });

  it("after a success, a failed Refresh flips the pill to Unknown and shows the error; a good Refresh recovers", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("env-remote-pill")).toHaveTextContent("On"));
    fetchMock.mockImplementationOnce(async () => new Response("{}", { status: 500, headers: JSON_HDR }));
    fireEvent.click(screen.getByTestId("env-refresh"));
    expect(await screen.findByTestId("env-error")).toHaveTextContent("last known");
    expect(screen.getByTestId("env-remote-unknown")).toBeInTheDocument();
    expect(screen.getByTestId("env-tokens")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("env-refresh"));
    await waitFor(() => expect(screen.getByTestId("env-remote-pill")).toHaveTextContent("On"));
    expect(screen.queryByTestId("env-error")).toBeNull();
  });

  it("shows the model even when no token usage is recorded yet", async () => {
    const withoutTokens = { ...info, info: { ...info.info, context: { ...info.info.context, tokens: null } } };
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/projects/")
        ? new Response(JSON.stringify({ data: { id: "p1", path: "C:/dev/app" } }), { status: 200, headers: JSON_HDR })
        : new Response(JSON.stringify(withoutTokens), { status: 200, headers: JSON_HDR }));
    mount();
    expect(await screen.findByTestId("env-model")).toHaveTextContent("claude-opus-4-7");
    expect(screen.queryByTestId("env-tokens")).toBeNull();
  });

  it("an unassigned task offers only Info (no Folders/Viewer) and every output is inert", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MissionInfoSidebar task={{ ...task, projectId: "unassigned" } as ExternalTask} compact={false} />
      </QueryClientProvider>,
    );
    await screen.findByTestId("env-tokens");
    expect(screen.queryByTestId("mission-side-seg-folders")).toBeNull();
    expect(screen.queryByTestId("mission-side-seg-viewer")).toBeNull();
    expect(screen.queryAllByTestId("env-output")).toHaveLength(0);
  });

  it("a hidden compact panel requests no scan", async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MissionInfoSidebar task={task} compact visible={false} />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(infoCalls()).toBe(0);
  });

  it("outputs resolve against the PROJECT root even when task.cwd is a worktree under it", async () => {
    mount();
    const outs = await screen.findAllByTestId("env-output");
    fireEvent.click(outs[0]);
    expect(await screen.findByTestId("sv-stub")).toHaveTextContent("src/f6.ts");
  });
});

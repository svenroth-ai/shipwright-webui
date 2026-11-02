import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { MissionInfoSidebar, type SidebarDocs } from "./MissionInfoSidebar";
import type { ExternalTask } from "../../../lib/externalApi";

vi.mock("../FolderTree", () => ({ FolderTree: () => null }));
vi.mock("../SmartViewer", () => ({
  SmartViewer: ({ path }: { path: string | null }) => <div data-testid="sv-stub">{path ?? "empty"}</div>,
}));

const task = { taskId: "t1", projectId: "p1", cwd: "C:\\dev\\app", state: "active" } as unknown as ExternalTask;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { id: "p1", path: "C:/dev/app" }, status: "ok", info: null }), { status: 200, headers: { "content-type": "application/json" } })));
});

function mount(docs: SidebarDocs) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (d: SidebarDocs): ReactNode => (
    <QueryClientProvider client={qc}>
      <MissionInfoSidebar task={task} compact={false} docs={d} />
    </QueryClientProvider>
  );
  const view = render(ui(docs));
  return { rerender: (d: SidebarDocs) => view.rerender(ui(d)) };
}

const mk = (request: SidebarDocs["request"], onActiveChange = vi.fn()): SidebarDocs => ({
  request,
  onActiveChange,
  render: (key, close) => (
    <div data-testid={`doc-${key}`}>
      body {key}
      <button data-testid="doc-close" onClick={close}>x</button>
    </div>
  ),
});

// @covers FR-01.66
describe("MissionInfoSidebar - Mission documents as Viewer tabs", () => {
  it("a document request opens the Viewer segment with a titled tab and the document body (one surface)", () => {
    const onActive = vi.fn();
    mount(mk({ key: "spec", label: "Spec", nonce: 1 }, onActive));
    expect(screen.getByTestId("mission-side-seg-viewer")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("viewer-tab-doc:spec")).toHaveTextContent("Spec");
    expect(screen.getByTestId("doc-spec")).toHaveTextContent("body spec");
    expect(screen.queryByTestId("sv-stub")).toBeNull();
    expect(onActive).toHaveBeenLastCalledWith("spec");
  });

  it("documents share the tab strip; switching tabs swaps the body; closing the front document tab reports null", () => {
    const onActive = vi.fn();
    const h = mount(mk({ key: "spec", label: "Spec", nonce: 1 }, onActive));
    h.rerender(mk({ key: "tests", label: "Tests", nonce: 2 }, onActive));
    expect(screen.getByTestId("doc-tests")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("viewer-tab-doc:spec"));
    expect(screen.getByTestId("doc-spec")).toBeInTheDocument();
    expect(onActive).toHaveBeenLastCalledWith("spec");
    fireEvent.click(screen.getByTestId("viewer-tab-close-doc:spec"));
    expect(screen.getByTestId("doc-tests")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("doc-close"));
    expect(screen.queryByTestId("viewer-tab-doc:tests")).toBeNull();
    expect(onActive).toHaveBeenLastCalledWith(null);
  });

  it("a document that no longer resolves says so instead of rendering an empty pane", () => {
    const docs: SidebarDocs = { request: { key: "gone", label: "Gone", nonce: 1 }, onActiveChange: vi.fn(), render: () => null };
    mount(docs);
    expect(screen.getByTestId("mission-side-doc-gone")).toHaveTextContent("no longer available");
  });
});

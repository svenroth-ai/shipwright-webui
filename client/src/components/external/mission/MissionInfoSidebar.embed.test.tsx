import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { MissionInfoSidebar } from "./MissionInfoSidebar";
import type { ExternalTask } from "../../../lib/externalApi";
import type { ViewerTarget } from "../../../lib/viewerTarget";

vi.mock("../SmartViewer", () => ({
  SmartViewer: ({ path }: { path: string | null }) => <div data-testid="sv-stub">{path ?? "empty"}</div>,
}));

const task = { taskId: "t1", projectId: "p1", cwd: "C:\\dev\\app", state: "active" } as unknown as ExternalTask;
const JSON_HDR = { "content-type": "application/json" };

interface HarnessProps {
  request?: { target: ViewerTarget; nonce: number } | null;
  headless?: boolean;
  visible?: boolean;
  onCollapse?: () => void;
  onActivePathChange?: (p: string | null) => void;
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Harness(props: HarnessProps) {
  const [segment, setSegment] = useState<"info" | "viewer">("info");
  return (
    <QueryClientProvider client={qc}>
      <MissionInfoSidebar
        task={task}
        compact={false}
        visible={props.visible ?? true}
        request={props.request ?? null}
        embed={{
          segment,
          onSegmentChange: setSegment,
          headless: props.headless,
          onCollapse: props.onCollapse,
          onActivePathChange: props.onActivePathChange,
        }}
      />
    </QueryClientProvider>
  );
}

const req = (path: string, nonce: number) => ({ target: { path, outside: false }, nonce });

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("/projects/")
        ? new Response(JSON.stringify({ data: { id: "p1", path: "C:/dev/app" } }), { status: 200, headers: JSON_HDR })
        : new Response(JSON.stringify({ status: "ok", info: null }), { status: 200, headers: JSON_HDR }),
    ),
  );
});

// @covers FR-01.66
describe("MissionInfoSidebar embedded in Files and Terminal (V8)", () => {
  it("offers exactly Info | Viewer in the shared .ft-head band (no Folders, no second tab row)", () => {
    render(<Harness />);
    expect(screen.getByTestId("task-detail-viewer-head").className).toContain("ft-head");
    expect(screen.getByTestId("ft-side-seg-info")).toBeInTheDocument();
    expect(screen.getByTestId("ft-side-seg-viewer")).toBeInTheDocument();
    expect(screen.queryByText("Folders")).toBeNull();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    // distinct ids: the Mission tab sidebar may be mounted at the same time
    expect(screen.queryByTestId("mission-side")).toBeNull();
  });

  it("a request opens the file as a tab above the viewer and switches to the Viewer segment", async () => {
    const seen: (string | null)[] = [];
    const onActive = (p: string | null) => seen.push(p);
    const { rerender } = render(<Harness onActivePathChange={onActive} />);
    expect(screen.queryByTestId("viewer-tab-bar")).toBeNull();
    rerender(<Harness onActivePathChange={onActive} request={req("a/b.ts", 1)} />);
    expect(await screen.findByTestId("sv-stub")).toHaveTextContent("a/b.ts");
    expect(screen.getByTestId("viewer-tab-a/b.ts")).toHaveAttribute("data-active", "true");
    rerender(<Harness onActivePathChange={onActive} request={req("c.md", 2)} />);
    expect(await screen.findByTestId("viewer-tab-c.md")).toBeInTheDocument();
    expect(screen.getByTestId("viewer-tab-a/b.ts")).toBeInTheDocument();
    expect(seen[seen.length - 1]).toBe("c.md");
  });

  it("tabs activate and close; closing the front tab falls back to the last remaining one", async () => {
    const { rerender } = render(<Harness request={req("a.ts", 1)} />);
    rerender(<Harness request={req("b.ts", 2)} />);
    await screen.findByTestId("viewer-tab-b.ts");
    fireEvent.click(screen.getByTestId("viewer-tab-a.ts"));
    expect(screen.getByTestId("sv-stub")).toHaveTextContent("a.ts");
    fireEvent.click(screen.getByTestId("viewer-tab-close-a.ts"));
    expect(screen.queryByTestId("viewer-tab-a.ts")).toBeNull();
    expect(screen.getByTestId("sv-stub")).toHaveTextContent("b.ts");
  });

  it("re-opening a file at a new line keeps its tab position but refreshes the stored target", async () => {
    const { rerender } = render(<Harness request={{ target: { path: "a.ts", outside: false, line: 10 }, nonce: 1 }} />);
    rerender(<Harness request={req("b.ts", 2)} />);
    rerender(<Harness request={{ target: { path: "a.ts", outside: false, line: 40 }, nonce: 3 }} />);
    const tabs = (await screen.findAllByRole("tab")).map((t) => t.getAttribute("data-testid"));
    expect(tabs).toEqual(["viewer-tab-a.ts", "viewer-tab-b.ts"]);
  });

  it("does not touch the remembered Mission sidebar layout", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("ft-side-seg-viewer"));
    expect(localStorage.getItem("shipwright:mission-sidebar")).toBeNull();
  });

  it("headless (phone) hides the in-card control; collapse calls the shell; a hidden tab renders no body", () => {
    const onCollapse = vi.fn();
    const { rerender } = render(<Harness onCollapse={onCollapse} />);
    fireEvent.click(screen.getByTestId("ft-side-collapse"));
    expect(onCollapse).toHaveBeenCalledTimes(1);
    rerender(<Harness headless />);
    expect(screen.queryByTestId("task-detail-viewer-head")).toBeNull();
    rerender(<Harness visible={false} />);
    expect(screen.queryByTestId("ft-side-body-info")).toBeNull();
  });
});

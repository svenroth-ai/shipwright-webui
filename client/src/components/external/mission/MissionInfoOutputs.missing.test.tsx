import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { MissionInfoOutputs } from "./MissionInfoOutputs";
import { resetPathProbe } from "../../../lib/pathProbe";

const B = String.fromCharCode(92); // Windows separator, spelled out so no tool re-escapes it
const ROOT = `C:${B}dev${B}app`;
const LIVE = `${ROOT}${B}src${B}live.ts`;
// A file written inside an iterate worktree that was removed after its merge: inside the project root, gone from disk.
const GONE = `${ROOT}${B}.worktrees${B}old-iterate${B}src${B}gone.ts`;

beforeEach(() => resetPathProbe());
afterEach(() => vi.unstubAllGlobals());

function stubProbe(openable: (p: string) => boolean, reason = "not_found") {
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
    const { paths } = JSON.parse(String(init?.body)) as { paths: string[] };
    return new Response(JSON.stringify({ results: paths.map((p) => (openable(p) ? { openable: true } : { openable: false, reason })) }), { status: 200 });
  }));
}

// @covers FR-01.66
describe("Outputs rows for files that no longer exist are hidden", () => {
  it("removes the row once the probe says 'no' and counts only visible rows", async () => {
    stubProbe((p) => !p.includes(".worktrees"));
    const onOpen = vi.fn();
    render(<MissionInfoOutputs taskId="t1" paths={[LIVE, GONE]} projectRoot={ROOT} rootReady emptyText="-" onOpen={onOpen} />);
    // stable while the probe is pending: both rows are there
    expect(screen.getAllByTestId("env-output")).toHaveLength(2);
    await waitFor(() => expect(screen.getAllByTestId("env-output")).toHaveLength(1));
    expect(screen.getByTestId("env-outputs-count")).toHaveTextContent("1 file");
    expect(screen.queryByText("missing")).toBeNull();
    fireEvent.click(screen.getByTestId("env-output"));
    expect(onOpen).toHaveBeenCalledWith({ path: "src/live.ts", outside: false });
  });

  it("'Show all N' counts visible rows only", async () => {
    const many = Array.from({ length: 8 }, (_, i) => `${ROOT}${B}src${B}f${i}.ts`);
    stubProbe((p) => !/f[67]\.ts$/.test(p));
    render(<MissionInfoOutputs taskId="t1" paths={many} projectRoot={ROOT} rootReady emptyText="-" onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("env-outputs-more")).toHaveTextContent("Show all 6"));
    expect(screen.getByTestId("env-outputs-count")).toHaveTextContent("6 files");
  });

  it("shows the normal empty state when every output is gone", async () => {
    stubProbe(() => false);
    render(<MissionInfoOutputs taskId="t1" paths={[GONE]} projectRoot={ROOT} rootReady emptyText="No files written yet." onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("env-outputs-empty")).toHaveTextContent("No files written yet."));
    expect(screen.queryByTestId("env-output")).toBeNull();
    expect(screen.queryByTestId("env-outputs-count")).toBeNull();
  });

  it("keeps a row that exists but cannot be previewed (reason other than not_found)", async () => {
    stubProbe(() => false, "not_previewable");
    render(<MissionInfoOutputs taskId="t1" paths={[LIVE]} projectRoot={ROOT} rootReady emptyText="-" onOpen={vi.fn()} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId("env-output")).toBeInTheDocument();
    expect(screen.getByTestId("env-outputs-count")).toHaveTextContent("1 file");
  });

  it("keeps rows visible and clickable when the probe is inconclusive (the Viewer reports the real state)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    render(<MissionInfoOutputs taskId="t1" paths={[GONE]} projectRoot={ROOT} rootReady emptyText="-" onOpen={vi.fn()} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByTestId("env-output")).toBeEnabled();
  });

  it("keeps the full path as tooltip on a long name and the outside-project tag", () => {
    stubProbe(() => true);
    const long = `C:${B}elsewhere${B}iterate-2026-11-02-smartviewer-html-images-html-preview-spec-extra-long-name.md`;
    render(<MissionInfoOutputs taskId="t1" paths={[long]} projectRoot={ROOT} rootReady emptyText="-" onOpen={vi.fn()} />);
    expect(screen.getByTestId("env-output")).toHaveAttribute("title", long);
    expect(screen.getByTestId("env-output-outside")).toBeInTheDocument();
  });
});

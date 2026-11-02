import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { MissionInfoOutputs } from "./MissionInfoOutputs";
import { resetPathProbe } from "../../../lib/pathProbe";

const ROOT = "C:\\dev\\app";
const LIVE = `${ROOT}\\src\\live.ts`;
// A file written inside an iterate worktree that was removed after its merge: inside the project root, gone from disk.
const GONE = `${ROOT}\\.worktrees\\old-iterate\\src\\gone.ts`;

beforeEach(() => resetPathProbe());
afterEach(() => vi.unstubAllGlobals());

// @covers FR-01.66
describe("Outputs rows for files that no longer exist", () => {
  it("shows a non-clickable row with a 'missing' tag instead of a dead click", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      const { paths } = JSON.parse(String(init?.body)) as { paths: string[] };
      return new Response(JSON.stringify({ results: paths.map((p) => ({ openable: !p.includes(".worktrees") })) }), { status: 200 });
    }));
    const onOpen = vi.fn();
    render(<MissionInfoOutputs taskId="t1" paths={[LIVE, GONE]} projectRoot={ROOT} rootReady emptyText="-" onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByTestId("env-output-missing")).toHaveTextContent("missing"));
    const [live, gone] = screen.getAllByTestId("env-output");
    expect(live).toBeEnabled();
    expect(gone).toBeDisabled();
    expect(gone).toHaveAttribute("data-missing", "true");
    fireEvent.click(gone!);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(live!);
    expect(onOpen).toHaveBeenCalledWith({ path: "src/live.ts", outside: false });
  });

  it("keeps rows clickable when the probe is inconclusive (the Viewer reports the real state)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    render(<MissionInfoOutputs taskId="t1" paths={[GONE]} projectRoot={ROOT} rootReady emptyText="-" onOpen={vi.fn()} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByTestId("env-output")).toBeEnabled();
    expect(screen.queryByTestId("env-output-missing")).toBeNull();
  });
});

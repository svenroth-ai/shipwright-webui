import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { MarkdownText } from "./MarkdownText";
import { FileOpenContext, type FileOpenValue } from "./FileOpenContext";
import { resetPathProbe } from "../../lib/pathProbe";

const ROOT = "C:\\dev\\app";

function mount(text: string, taskId: string | null = "t1") {
  const open = vi.fn();
  const value: FileOpenValue = { projectRoot: ROOT, open, taskId: taskId ?? undefined };
  render(
    <FileOpenContext.Provider value={value}>
      <MarkdownText text={text} />
    </FileOpenContext.Provider>,
  );
  return open;
}

const stubProbe = (openable: (p: string) => boolean) =>
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
    const { paths } = JSON.parse(String(init?.body)) as { paths: string[] };
    return new Response(JSON.stringify({ results: paths.map((p) => ({ openable: openable(p) })) }), { status: 200 });
  }));

beforeEach(() => resetPathProbe());
afterEach(() => vi.unstubAllGlobals());

// @covers FR-01.66
describe("chat file chips are probed before they are links", () => {
  it("renders a clickable chip only for paths the server says are openable; a dead one is plain text", async () => {
    stubProbe((p) => p === "docs/real.md");
    const open = mount("See `docs/real.md` and `session_handoff.md`.");
    const chip = await screen.findByTestId("mc-file");
    expect(chip).toHaveTextContent("real.md");
    const plain = await screen.findByTestId("mc-file-plain");
    expect(plain).toHaveTextContent("session_handoff.md");
    expect(plain.tagName).not.toBe("BUTTON");
    expect(plain).toHaveAttribute("title", expect.stringContaining("Not found"));
    fireEvent.click(chip);
    expect(open).toHaveBeenCalledWith({ path: "docs/real.md", outside: false });
    expect(screen.getAllByTestId("mc-file")).toHaveLength(1);
  });

  it("is plain text while the probe is still pending (never a link that may open nothing)", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    mount("`docs/real.md`");
    expect(screen.queryByTestId("mc-file")).toBeNull();
    expect(screen.getByTestId("mc-file-plain")).toHaveAttribute("data-state", "checking");
  });

  it("an inconclusive probe (server error) keeps the chip - the Viewer reports the real state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    mount("`docs/real.md`");
    await waitFor(() => expect(screen.getByTestId("mc-file")).toBeInTheDocument());
  });

  it("without a task in the context nothing is probed and chips behave as before", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    mount("`docs/real.md`", null);
    expect(screen.getByTestId("mc-file")).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });
});

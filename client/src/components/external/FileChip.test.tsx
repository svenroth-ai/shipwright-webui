import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { MarkdownText } from "./MarkdownText";
import { SmartViewer } from "./SmartViewer";
import { FileOpenContext, type FileOpenValue } from "./FileOpenContext";

const ROOT = "C:\\dev\\app";

function renderMd(text: string, open = vi.fn(), root: string | null = ROOT) {
  const value: FileOpenValue = { projectRoot: root, open };
  render(
    <FileOpenContext.Provider value={value}>
      <MarkdownText text={text} />
    </FileOpenContext.Provider>,
  );
  return open;
}

// @covers FR-01.66
describe("chat file chips (MarkdownText + FileOpenContext)", () => {
  it("turns backticked paths into .mc-file chips that open the viewer (relative, absolute-inside, absolute-outside)", () => {
    const open = renderMd("See `client/src/a.ts:98`, `C:\\dev\\app\\b.md` and `D:\\other\\c.json`.");
    const chips = screen.getAllByTestId("mc-file");
    expect(chips).toHaveLength(3);
    expect(chips.every((c) => c.classList.contains("mc-file"))).toBe(true);
    expect(chips[0]).toHaveTextContent("a.ts:98");
    expect(chips[0]).toHaveAttribute("title", "client/src/a.ts:98");
    fireEvent.click(chips[0]);
    expect(open).toHaveBeenLastCalledWith({ path: "client/src/a.ts", outside: false, line: 98 });
    fireEvent.click(chips[1]);
    expect(open).toHaveBeenLastCalledWith({ path: "b.md", outside: false });
    fireEvent.click(chips[2]);
    expect(open).toHaveBeenLastCalledWith({ path: "D:\\other\\c.json", outside: true });
    expect(chips[2]).toHaveAttribute("data-outside", "true");
  });

  it("turns markdown links to files into chips but leaves web links alone", () => {
    const open = renderMd("[the spec](docs/spec%20v2.md) and [site](https://example.com/a.md)");
    const chip = screen.getByTestId("mc-file");
    expect(chip).toHaveTextContent("the spec");
    fireEvent.click(chip);
    expect(open).toHaveBeenCalledWith({ path: "docs/spec v2.md", outside: false });
    const link = screen.getByRole("link", { name: "site" });
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("leaves non-file code, fenced blocks and unassigned relative paths as they were", () => {
    renderMd("Use `console.log` and `npm run build`.\n\n```ts\nconst p = 'a/b.ts';\n```");
    expect(screen.queryByTestId("mc-file")).toBeNull();
    expect(screen.getByTestId("fenced-code")).toHaveTextContent("a/b.ts");
    renderMd("rel `src/a.ts` abs `D:\\x\\y.md`", vi.fn(), null);
    expect(screen.getAllByTestId("mc-file")).toHaveLength(1); // only the absolute one without a project
  });

  it("renders plain markdown (no chips) outside any provider", () => {
    render(<MarkdownText text="`src/a.ts`" />);
    expect(screen.queryByTestId("mc-file")).toBeNull();
    expect(screen.getByText("src/a.ts").tagName).toBe("CODE");
  });
});

describe("SmartViewer for a file outside the project", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/tasks/t1/session-file")) {
          return new Response("body { color: red; }", { status: 200 });
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads through the task-scoped route and shows the Outside project header with Copy path", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<SmartViewer projectId="p1" path={"D:\\other\\mockup.css"} sessionTaskId="t1" />);
    expect(screen.getByTestId("smart-viewer-outside-tag")).toHaveTextContent("Outside project");
    expect(screen.getByTestId("smart-viewer-outside-path")).toHaveTextContent("D:\\other\\mockup.css");
    await waitFor(() => expect(screen.getByTestId("smart-viewer")).toBeInTheDocument());
    const fetchMock = vi.mocked(fetch);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/external/tasks/t1/session-file?path=");
    expect(decodeURIComponent(url)).toContain("D:\\other\\mockup.css");
    fireEvent.click(screen.getByTestId("smart-viewer-copy-path"));
    expect(writeText).toHaveBeenCalledWith("D:\\other\\mockup.css");
  });

  it("a project file shows no outside header", async () => {
    render(<SmartViewer projectId="p1" path="a.css" />);
    expect(screen.queryByTestId("smart-viewer-outside-head")).toBeNull();
  });
});

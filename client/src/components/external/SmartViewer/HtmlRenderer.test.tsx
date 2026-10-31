import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HtmlRenderer, buildHtmlSrcDoc } from "./HtmlRenderer";
import { resolveKind } from "../SmartViewer";

const { fetchFileText } = vi.hoisted(() => ({ fetchFileText: vi.fn() }));
vi.mock("../../../lib/externalApi", () => ({ fetchFileText }));

const LINKED = '<link rel="stylesheet" href="mockup.css"><p>x</p>';

// @covers FR-01.02
describe("HtmlRenderer", () => {
  it("resolves html/htm to the html kind", () => {
    expect(resolveKind("board.html").kind).toBe("html");
    expect(resolveKind("a/b.HTM").kind).toBe("html");
  });

  it("renders a sandboxed iframe without allow-same-origin", () => {
    render(<HtmlRenderer text="<h1>Hi</h1>" />);
    const frame = screen.getByTestId("smart-viewer-html-frame");
    const sandbox = frame.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    expect(frame.getAttribute("srcdoc")).toContain("<h1>Hi</h1>");
  });

  it("injects a CSP that forbids network and forms, before author markup", () => {
    const doc = buildHtmlSrcDoc("<p>x</p>");
    expect(doc.startsWith("<meta http-equiv=\"Content-Security-Policy\"")).toBe(true);
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("form-action 'none'");
  });

  it("keeps a leading doctype first, CSP before all other markup", () => {
    const doc = buildHtmlSrcDoc("<!DOCTYPE html><html><body>x</body></html>");
    expect(doc.startsWith("<!DOCTYPE html><meta http-equiv=\"Content-Security-Policy\"")).toBe(true);
    expect(doc.indexOf("<html>")).toBeGreaterThan(doc.indexOf("Content-Security-Policy"));
  });

  it("shows a pop-out button only when onPopOut is given", () => {
    const onPopOut = vi.fn();
    const { rerender } = render(<HtmlRenderer text="<p>x</p>" onPopOut={onPopOut} />);
    fireEvent.click(screen.getByTestId("smart-viewer-popout"));
    expect(onPopOut).toHaveBeenCalledOnce();
    rerender(<HtmlRenderer text="<p>x</p>" />);
    expect(screen.queryByTestId("smart-viewer-popout")).toBeNull();
  });

  it("holds the iframe until relative stylesheets are inlined, then loads once", async () => {
    fetchFileText.mockResolvedValue({ text: "p{color:red}", size: 12 });
    render(<HtmlRenderer text={LINKED} projectId="p" path="d/index.html" />);
    expect(screen.queryByTestId("smart-viewer-html-frame")).toBeNull();
    const frame = await screen.findByTestId("smart-viewer-html-frame");
    expect(fetchFileText).toHaveBeenCalledWith("p", "d/mockup.css");
    expect(frame.getAttribute("srcdoc")).toContain("<style>p{color:red}</style>");
    expect(frame.getAttribute("srcdoc")).not.toContain("<link");
  });

  it("falls back to the raw html when the stylesheet cannot be read", async () => {
    fetchFileText.mockRejectedValue(new Error("nope"));
    render(<HtmlRenderer text={LINKED} projectId="p" path="d/index.html" />);
    const frame = await screen.findByTestId("smart-viewer-html-frame");
    expect(frame.getAttribute("srcdoc")).toContain('<link rel="stylesheet" href="mockup.css">');
  });

  it("does not reuse an inlined result for a different path or text", async () => {
    fetchFileText.mockResolvedValue({ text: "a{}", size: 3 });
    const { rerender } = render(<HtmlRenderer text={LINKED} projectId="p" path="a/index.html" />);
    await screen.findByTestId("smart-viewer-html-frame");
    rerender(<HtmlRenderer text={LINKED} projectId="p" path="b/index.html" />);
    expect(screen.queryByTestId("smart-viewer-html-frame")).toBeNull();
    await waitFor(() => expect(fetchFileText).toHaveBeenCalledWith("p", "b/mockup.css"));
    expect(await screen.findByTestId("smart-viewer-html-frame")).toBeTruthy();
  });

  it("does not show another project's styles for the same path and text", async () => {
    fetchFileText.mockResolvedValue({ text: "a{}", size: 3 });
    const { rerender } = render(<HtmlRenderer text={LINKED} projectId="p1" path="d/index.html" />);
    await screen.findByTestId("smart-viewer-html-frame");
    rerender(<HtmlRenderer text={LINKED} projectId="p2" path="d/index.html" />);
    expect(screen.queryByTestId("smart-viewer-html-frame")).toBeNull();
    expect(await screen.findByTestId("smart-viewer-html-frame")).toBeTruthy();
    expect(fetchFileText).toHaveBeenCalledWith("p2", "d/mockup.css");
  });

  it("keeps the previous frame while only the text of the same file changes", async () => {
    fetchFileText.mockResolvedValue({ text: "a{}", size: 3 });
    const { rerender } = render(<HtmlRenderer text={LINKED} projectId="p" path="d/index.html" />);
    await screen.findByTestId("smart-viewer-html-frame");
    rerender(<HtmlRenderer text={LINKED + "<i>y</i>"} projectId="p" path="d/index.html" />);
    expect(screen.getByTestId("smart-viewer-html-frame")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("smart-viewer-html-frame").getAttribute("srcdoc")).toContain("<i>y</i>"),
    );
  });

  it("keeps the pop-out button outside the tablist", () => {
    render(<HtmlRenderer text="<p>x</p>" onPopOut={() => {}} />);
    expect(screen.getByRole("tablist").contains(screen.getByTestId("smart-viewer-popout"))).toBe(false);
  });

  it("toggles to Source", () => {
    render(<HtmlRenderer text="<h1>Hi</h1>" />);
    fireEvent.click(screen.getByTestId("smart-viewer-html-source"));
    expect(screen.queryByTestId("smart-viewer-html-frame")).toBeNull();
  });
});

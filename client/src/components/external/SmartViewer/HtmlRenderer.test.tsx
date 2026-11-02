import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HtmlRenderer, buildHtmlSrcDoc } from "./HtmlRenderer";
import { resolveKind } from "../SmartViewer";

// The renderer reads sibling files through the real file API URLs; serve them from a path -> body map.
type Served = string | { bytes: number[]; type: string };
const requested: string[] = [];
function serve(files: Record<string, Served>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = new URL(url, "http://localhost");
      const path = u.searchParams.get("path") ?? "";
      const owner = u.searchParams.get("assetOf");
      requested.push(`${u.pathname}?path=${path}${owner ? `&assetOf=${owner}` : ""}`);
      const body = files[path];
      if (body === undefined) return new Response("{}", { status: 404 });
      return typeof body === "string"
        ? new Response(body)
        : new Response(new Uint8Array(body.bytes), { headers: { "content-type": body.type } });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  requested.length = 0;
});

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
    serve({ "d/mockup.css": "p{color:red}" });
    render(<HtmlRenderer text={LINKED} projectId="p" path="d/index.html" />);
    expect(screen.queryByTestId("smart-viewer-html-frame")).toBeNull();
    const frame = await screen.findByTestId("smart-viewer-html-frame");
    expect(requested).toContain("/api/external/projects/p/file?path=d/mockup.css");
    expect(frame.getAttribute("srcdoc")).toContain("<style>p{color:red}</style>");
    expect(frame.getAttribute("srcdoc")).not.toContain("<link");
  });

  it("falls back to the raw html when the stylesheet cannot be read", async () => {
    serve({});
    render(<HtmlRenderer text={LINKED} projectId="p" path="d/index.html" />);
    const frame = await screen.findByTestId("smart-viewer-html-frame");
    expect(frame.getAttribute("srcdoc")).toContain('<link rel="stylesheet" href="mockup.css">');
  });

  it("does not reuse an inlined result for a different path or text", async () => {
    serve({ "a/mockup.css": "a{}", "b/mockup.css": "b{}" });
    const { rerender } = render(<HtmlRenderer text={LINKED} projectId="p" path="a/index.html" />);
    await screen.findByTestId("smart-viewer-html-frame");
    rerender(<HtmlRenderer text={LINKED} projectId="p" path="b/index.html" />);
    expect(screen.queryByTestId("smart-viewer-html-frame")).toBeNull();
    await waitFor(() => expect(requested).toContain("/api/external/projects/p/file?path=b/mockup.css"));
    expect(await screen.findByTestId("smart-viewer-html-frame")).toBeTruthy();
  });

  it("does not show another project's styles for the same path and text", async () => {
    serve({ "d/mockup.css": "a{}" });
    const { rerender } = render(<HtmlRenderer text={LINKED} projectId="p1" path="d/index.html" />);
    await screen.findByTestId("smart-viewer-html-frame");
    rerender(<HtmlRenderer text={LINKED} projectId="p2" path="d/index.html" />);
    expect(screen.queryByTestId("smart-viewer-html-frame")).toBeNull();
    expect(await screen.findByTestId("smart-viewer-html-frame")).toBeTruthy();
    expect(requested).toContain("/api/external/projects/p2/file?path=d/mockup.css");
  });

  it("keeps the previous frame while only the text of the same file changes", async () => {
    serve({ "d/mockup.css": "a{}" });
    const { rerender } = render(<HtmlRenderer text={LINKED} projectId="p" path="d/index.html" />);
    await screen.findByTestId("smart-viewer-html-frame");
    rerender(<HtmlRenderer text={LINKED + "<i>y</i>"} projectId="p" path="d/index.html" />);
    expect(screen.getByTestId("smart-viewer-html-frame")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("smart-viewer-html-frame").getAttribute("srcdoc")).toContain("<i>y</i>"),
    );
  });

  it("embeds a relative image as a data URI and holds the frame until it is loaded", async () => {
    serve({ "d/shot.png": { bytes: [137, 80, 78, 71], type: "image/png" } });
    render(<HtmlRenderer text='<img src="shot.png" alt="a">' projectId="p" path="d/index.html" />);
    expect(screen.queryByTestId("smart-viewer-html-frame")).toBeNull();
    const frame = await screen.findByTestId("smart-viewer-html-frame");
    expect(frame.getAttribute("srcdoc")).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="a">/);
  });

  it("an OUTSIDE page loads its resources through the session-file route, naming the page", async () => {
    const page = "C:/work/report/vergleich.html";
    serve({
      "C:/work/report/shot.png": { bytes: [1, 2, 3], type: "image/png" },
      "C:/work/report/mockup.css": "p{color:red}",
    });
    render(<HtmlRenderer text={'<link rel="stylesheet" href="mockup.css"><img src="shot.png">'} sessionTaskId="t1" path={page} />);
    const frame = await screen.findByTestId("smart-viewer-html-frame");
    expect(requested).toContain(`/api/external/tasks/t1/session-file?path=C:/work/report/shot.png&assetOf=${page}`);
    expect(requested).toContain(`/api/external/tasks/t1/session-file?path=C:/work/report/mockup.css&assetOf=${page}`);
    const doc = frame.getAttribute("srcdoc") ?? "";
    expect(doc).toContain("<style>p{color:red}</style>");
    expect(doc).toContain('src="data:image/png;base64,');
  });

  it("keeps the original image reference when the file is refused or missing", async () => {
    serve({});
    render(<HtmlRenderer text='<img src="gone.png">' projectId="p" path="d/index.html" />);
    const frame = await screen.findByTestId("smart-viewer-html-frame");
    expect(frame.getAttribute("srcdoc")).toContain('<img src="gone.png">');
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

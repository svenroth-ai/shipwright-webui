import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { HtmlRenderer, buildHtmlSrcDoc } from "./HtmlRenderer";
import { resolveKind } from "../SmartViewer";

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

  it("toggles to Source", () => {
    render(<HtmlRenderer text="<h1>Hi</h1>" />);
    fireEvent.click(screen.getByTestId("smart-viewer-html-source"));
    expect(screen.queryByTestId("smart-viewer-html-frame")).toBeNull();
  });
});

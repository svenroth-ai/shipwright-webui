/*
 * MarkdownChunk — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * Public surface contract:
 *   - Single prop `content: string` (rename of legacy MarkdownText's `text`).
 *   - Fenced code blocks render via rehype-highlight (language class on <code>).
 *   - GFM tables render via remark-gfm (<table> in the DOM).
 *   - Raw HTML in source is escaped per react-markdown defaults (NO <script>
 *     element in the DOM — the text is rendered as text only).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MarkdownChunk } from "./MarkdownChunk";

describe("MarkdownChunk", () => {
  it("renders fenced code blocks with rehype-highlight language class", () => {
    const md = "```ts\nconst x: number = 1;\n```";
    const { container } = render(<MarkdownChunk content={md} />);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    // rehype-highlight stamps a `language-…` class on the <code>.
    expect(code!.className).toMatch(/language-/);
  });

  it("renders GFM tables via remark-gfm", () => {
    const md = ["| h1 | h2 |", "| --- | --- |", "| a | b |"].join("\n");
    const { container } = render(<MarkdownChunk content={md} />);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(container.querySelectorAll("th")).toHaveLength(2);
  });

  it("escapes raw HTML in source — <script> rendered as TEXT, not element", () => {
    const md = "before <script>alert(1)</script> after";
    const { container } = render(<MarkdownChunk content={md} />);
    // react-markdown's default escapes HTML — there must be no <script> tag
    // in the rendered DOM. The literal string still appears as text content.
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(container.textContent).toContain("alert(1)");
  });

  it("applies the markdown-body wrapper class for theme parity", () => {
    render(<MarkdownChunk content="hi" />);
    // The wrapper is exposed via data-testid by the legacy renderer; this
    // assertion locks the prop wiring in place after the rename.
    expect(screen.getByTestId("markdown-body").textContent).toContain("hi");
  });
});

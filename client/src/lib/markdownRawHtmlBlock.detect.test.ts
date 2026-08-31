/*
 * markdownRawHtmlBlock.detect.test.ts — detectLossyConstructs coverage for
 * raw-HTML / comment classification (iterate-2026-08-31-markdown-raw-html-
 * passthrough). Split out of markdownRawHtmlBlock.test.ts to keep both files
 * under the repo's 300-line convention.
 */

import { describe, it, expect } from "vitest";

import { detectLossyConstructs } from "./markdownTiptap";

describe("detectLossyConstructs — raw HTML / comment classification", () => {
  // @covers FR-01.35
  it("flags an inline anchor carrying a non-href attribute as raw HTML (still lossy — only href-only anchors round-trip)", () => {
    expect(detectLossyConstructs('<a id="trg-1"></a>\n\ntext')).toContain("raw HTML");
  });

  // @covers FR-01.35
  it("does NOT flag a top-level (block) HTML comment — it's now preserved verbatim by RawHtmlBlock, same mechanism as any other raw HTML block", () => {
    expect(detectLossyConstructs("<!-- a comment -->\n\ntext")).not.toContain("HTML comments");
    expect(detectLossyConstructs("<!-- a comment -->\n\ntext")).not.toContain("raw HTML");
  });

  // @covers FR-01.35
  it("still flags an INLINE HTML comment (mid-paragraph) as lossy", () => {
    expect(detectLossyConstructs("text with <!-- comment --> inline")).toContain("HTML comments");
  });

  // @covers FR-01.35
  it("does NOT flag a top-level raw HTML block — the CTA-link case from the bug report", () => {
    const md =
      '<p><strong><a href="https://example.com" style="color: #4A7C59;">→ Explore Shipwright</a></strong></p>\n\ntext';
    expect(detectLossyConstructs(md)).not.toContain("raw HTML");
  });

  // @covers FR-01.35
  it("still flags a raw HTML block NESTED inside a blockquote or list (out of scope for RawHtmlBlock)", () => {
    expect(detectLossyConstructs("> <div>nested</div>\n> more")).toContain("raw HTML");
    expect(detectLossyConstructs("- <div>nested li</div>\n- two")).toContain("raw HTML");
  });

  // @covers FR-01.35
  it("does NOT flag an inline anchor whose sole attribute is href with a safe protocol", () => {
    expect(
      detectLossyConstructs('Built with <a href="https://github.com/svenroth-ai/shipwright">Shipwright</a>.'),
    ).not.toContain("raw HTML");
  });

  // @covers FR-01.35
  it("does NOT flag an href-only inline anchor using single quotes, unquoted, relative, fragment, or protocol-relative URLs — all round-trip losslessly via the same Link-mark isAllowedUri check (external review, iterate-2026-08-31)", () => {
    expect(detectLossyConstructs("See <a href='/docs'>docs</a>.")).not.toContain("raw HTML");
    expect(detectLossyConstructs("See <a href=/docs>docs</a>.")).not.toContain("raw HTML");
    expect(detectLossyConstructs('See <a href="#section">here</a>.')).not.toContain("raw HTML");
    expect(detectLossyConstructs('See <a href="//example.com/x">here</a>.')).not.toContain("raw HTML");
  });

  // @covers FR-01.35
  it("still flags an href-only inline anchor with a dangerous scheme (javascript:/data:) as raw HTML", () => {
    expect(detectLossyConstructs('<a href="javascript:alert(1)">x</a>')).toContain("raw HTML");
    expect(detectLossyConstructs('<a href="data:text/html,x">x</a>')).toContain("raw HTML");
  });

  // @covers FR-01.35
  it("still flags an inline anchor with target/rel/class attributes beyond href", () => {
    expect(
      detectLossyConstructs(
        'Powered by <a href="https://shipwright.dev" target="_blank" rel="noopener">Shipwright</a> today.',
      ),
    ).toContain("raw HTML");
  });

  // @covers FR-01.35
  it("still flags an inline <span> or other non-anchor inline tag", () => {
    expect(detectLossyConstructs('a <span style="color:red">word</span> here')).toContain("raw HTML");
  });
});

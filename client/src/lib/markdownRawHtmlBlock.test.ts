/*
 * markdownRawHtmlBlock.test.ts — round-trip + lossy-detection coverage for
 * the `rawHtmlBlock` node (iterate-2026-08-31-markdown-raw-html-passthrough).
 * Split out of markdownTiptap.test.ts to keep both files under the repo's
 * 300-line convention and mirror the markdownRawHtmlBlock.ts source split.
 *
 * Bug: a block-level raw-HTML construct (a line starting with a block tag
 * like <p>, per CommonMark html_block rule 6) that itself contains
 * schema-mappable inner tags (<strong>, <a href>) got silently reinterpreted
 * into ProseMirror's schema and re-serialized as plain Markdown — dropping
 * any attribute the schema doesn't model (style, class, id, data-*, ...).
 * Root cause: tiptap-markdown's MarkdownParser renders markdown-it's
 * `html_block` token to an HTML string and hands it to ProseMirror's DOM
 * parser, which maps recognized DOM elements (p/strong/a) onto matching
 * schema nodes/marks — attributes outside the schema are simply dropped.
 */

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/react";
import { MarkdownSerializerState } from "prosemirror-markdown";
import { DOMParser as PMDOMParser } from "prosemirror-model";

import { buildEditorExtensions, serializeEditorMarkdown } from "./markdownTiptap";
import { RawHtmlBlock } from "./markdownRawHtmlBlock";

function roundTrip(md: string): string {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content: md,
  });
  try {
    return serializeEditorMarkdown(editor as unknown as { storage: { markdown: { getMarkdown: () => string } } });
  } finally {
    editor.destroy();
  }
}

describe("raw HTML BLOCKS survive the round-trip verbatim", () => {
  // @covers FR-01.35
  it("preserves a styled CTA link block byte-for-byte instead of downgrading to a plain markdown link", () => {
    const source =
      '<p><strong><a href="https://example.com" style="color: #4A7C59; font-size: 1.15em;">→ Explore Shipwright</a></strong></p>';
    const out = roundTrip(source);
    expect(out).toBe(source);
  });

  // @covers FR-01.35
  it("round-trips a block with no attributes at all", () => {
    const source = "<div>plain block, no attributes</div>";
    expect(roundTrip(source)).toBe(source);
  });

  // @covers FR-01.35
  it("round-trips a multi-line raw HTML block", () => {
    const source = "<div>\n  <p>line one</p>\n  <p>line two</p>\n</div>";
    expect(roundTrip(source)).toBe(source);
  });

  // @covers FR-01.35
  it("round-trips a raw HTML block that sits between two prose paragraphs", () => {
    const source = [
      "Before the block.",
      "",
      '<p class="cta"><a href="https://example.com">Explore</a></p>',
      "",
      "After the block.",
    ].join("\n");
    const out = roundTrip(source);
    expect(out).toContain("Before the block.");
    expect(out).toContain('<p class="cta"><a href="https://example.com">Explore</a></p>');
    expect(out).toContain("After the block.");
  });

  // @covers FR-01.35
  it("is idempotent for a document containing a raw HTML block", () => {
    const source =
      '<p><strong><a href="https://example.com" style="color: #4A7C59;">CTA</a></strong></p>\n\nProse after.';
    const once = roundTrip(source);
    expect(roundTrip(once)).toBe(once);
  });

  // @covers FR-01.35
  it("renders the raw HTML as inert TEXT, never executes it (no innerHTML anywhere in the render path)", () => {
    // The node's whole purpose is to hold arbitrary, attacker-influenceable
    // file content — a `<script>` payload must render as literal source
    // text, never be parsed as markup (both external reviewers flagged this
    // as a high-severity risk if the preview used innerHTML).
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: buildEditorExtensions(),
      content: "",
    });
    try {
      editor.commands.setContent('<div>text with an <script>window.__pwned = 1;</script> payload</div>');
      const dom = editor.view.dom;
      expect(dom.querySelector("script")).toBeNull();
      expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();
      expect(dom.textContent ?? "").toContain("<script>window.__pwned = 1;</script>");
    } finally {
      editor.destroy();
    }
  });

  // @covers FR-01.35
  it("still round-trips a raw HTML block nested inside a blockquote or list — via the PRE-EXISTING (unimproved) path, out of scope for this iterate", () => {
    // Nested blocks are deliberately NOT intercepted by RawHtmlBlock (see
    // markdownRawHtmlBlock.ts file header) — proving here only that nothing
    // NEW broke; content fidelity for this case is unchanged from before
    // this iterate and remains flagged lossy by detectLossyConstructs
    // (see markdownRawHtmlBlock.detect.test.ts).
    expect(() => roundTrip("> <div>nested</div>\n> more")).not.toThrow();
    expect(() => roundTrip("- <div>nested li</div>\n- two")).not.toThrow();
  });

  // @covers FR-01.35
  it("writes a block-level javascript: scheme link back verbatim — a deliberate, documented asymmetry with the inline case (fidelity over sanitization; DocumentMarkdown sanitizes on render)", () => {
    const source = '<p><a href="javascript:alert(1)">x</a></p>';
    expect(roundTrip(source)).toBe(source);
  });

  // @covers FR-01.35
  it("cannot be wrapped in a blockquote or bullet list via the toolbar — the schema itself refuses the wrap (doubt-reviewer HIGH finding: state.text()'s per-line delimiter made a WRAPPED chip serialize correctly, but did not stop the wrap; on reopen the marker div is nested, falls through to verbatim rendering, and ProseMirror's DOM parser drops the attributes again — silently reintroducing the exact bug this iterate fixes)", () => {
    const source = '<p><strong><a href="https://example.com" style="color: #4A7C59;">CTA</a></strong></p>';
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: buildEditorExtensions(),
      content: source,
    });
    try {
      const before = editor.getJSON();
      editor.commands.selectAll();
      const blockquoteApplied = editor.commands.toggleBlockquote();
      const bulletListApplied = editor.commands.toggleBulletList();
      expect(blockquoteApplied).toBe(false);
      expect(bulletListApplied).toBe(false);
      expect(editor.getJSON()).toEqual(before);
      // The block itself is still fully intact and still round-trips.
      expect(roundTrip(source)).toBe(source);
    } finally {
      editor.destroy();
    }
  });

  // @covers FR-01.35
  it("serialize() applies its delimiter once PER LINE, not once for the whole block (state.text(html, false), not state.write(html)) — drives the REAL prosemirror-markdown MarkdownSerializerState directly (bypassing the schema restriction above, which means a live editor can no longer reach a delimited position) to pin the defense-in-depth behavior against the actual library, not a hand-rolled stand-in (code-reviewer HIGH finding)", () => {
    // The public .d.ts exposes no constructor and hides `delim`/`out` (both
    // present and used at runtime — verified against the installed
    // prosemirror-markdown source, see markdownRawHtmlBlock.ts's serialize
    // comment); a typed cast is the same idiom this file already uses for
    // `editor.storage` above.
    type SerializerStateInternals = {
      delim: string;
      out: string;
      text: (s: string, escape?: boolean) => void;
      write: (s?: string) => void;
      closeBlock: (n: unknown) => void;
    };
    const StateCtor = MarkdownSerializerState as unknown as new (nodes: object, marks: object, options: object) => SerializerStateInternals;
    const state = new StateCtor({}, {}, {});
    state.delim = "> "; // simulates being inside a blockquote's render
    const node = { attrs: { html: "<div>\n  <p>line one</p>\n  <p>line two</p>\n</div>" } };
    RawHtmlBlock.storage.markdown.serialize(state, node);
    const lines = state.out.split("\n").filter((line: string) => line.length > 0);
    expect(lines.length).toBe(4);
    for (const line of lines) {
      expect(line.startsWith("> ")).toBe(true);
    }
    expect(state.out).toContain("<div>");
    expect(state.out).toContain("<p>line one</p>");
    expect(state.out).toContain("<p>line two</p>");
    expect(state.out).toContain("</div>");
  });

  // @covers FR-01.35
  it("absorbs immediately-following prose into the SAME opaque chip when no blank line separates them (CommonMark html_block rule 6 blank-line termination) — content is preserved byte-for-byte, but that prose is no longer separately rich-editable", () => {
    // Corrected disclosure (code-reviewer MEDIUM finding): this is NOT
    // content loss, but editability of "Regular prose." genuinely changes
    // (it was a rich-editable paragraph before this fix existed at all).
    const source = "<p>Intro</p>\nRegular prose.";
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: buildEditorExtensions(),
      content: source,
    });
    try {
      expect(editor.state.doc.childCount).toBe(1);
      const onlyChild = editor.state.doc.firstChild;
      expect(onlyChild?.type.name).toBe("rawHtmlBlock");
      expect(onlyChild?.attrs.html).toContain("Regular prose.");
      expect(roundTrip(source)).toBe(source);
    } finally {
      editor.destroy();
    }
  });

  // @covers FR-01.35
  it("normalises inter-block spacing (not the block's own bytes) when a non-absorbing top-level construct (an HTML comment, terminated on its own line per CommonMark rule 2) is immediately followed by prose with no blank line — a visible diff on open, same whitespace-normalisation contract the editor already applies to any two adjacent StarterKit blocks, corrected from an overclaimed 'byte-for-byte' scope in AC-1 (doubt-reviewer MEDIUM finding: narrowed to 'the block's own bytes', not the whole file)", () => {
    const source = "<!-- note -->\nRegular prose.";
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: buildEditorExtensions(),
      content: source,
    });
    try {
      // Two separate top-level nodes (not absorbed, unlike rule 6 above).
      expect(editor.state.doc.childCount).toBe(2);
      expect(editor.state.doc.firstChild?.type.name).toBe("rawHtmlBlock");
      expect(editor.state.doc.firstChild?.attrs.html).toBe("<!-- note -->");
      const out = roundTrip(source);
      // The comment's own bytes and the prose text both survive...
      expect(out).toContain("<!-- note -->");
      expect(out).toContain("Regular prose.");
      // ...but a blank line the user never typed is inserted between them
      // (the standard block-separator every adjacent pair of blocks gets;
      // this is NOT unique to raw HTML — it is visible in the pre-save
      // diff either way, so it is not silent).
      expect(out).not.toBe(source);
      expect(out).toBe("<!-- note -->\n\nRegular prose.");
    } finally {
      editor.destroy();
    }
  });
});

describe("rawHtmlBlock marker provenance — a file that already contains a marker-shaped element must never be silently treated as our own marker", () => {
  // @covers FR-01.35
  it("does NOT swallow real content sitting inside a NESTED (blockquote/list) element that happens to share the marker tag+attribute — nested html_block content is rendered verbatim (out of scope, unchanged from before this fix), so a real div[data-raw-html-block] with real children reaching the DOM parser must fall through to normal parsing, not be replaced by decoded (bogus) attribute content", () => {
    const source = '> <div data-raw-html-block="not-a-real-payload">actual content</div>\n> more';
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: buildEditorExtensions(),
      content: source,
    });
    try {
      const text = editor.state.doc.textContent;
      expect(text).toContain("actual content");
    } finally {
      editor.destroy();
    }
  });

  // @covers FR-01.35
  it("does NOT produce mojibake or a silently-empty chip from a marker-shaped element whose attribute is NOT a payload we produced (missing the magic prefix) — falls through to normal (empty-element) parsing instead", () => {
    // Exercises parseHTML/getAttrs directly via ProseMirror's own DOMParser
    // (the same mechanism a clipboard paste of raw HTML uses) — going
    // through `editor.commands.setContent(string)` instead would route the
    // string through the MARKDOWN parser first, which (correctly) treats it
    // as html_block SOURCE and re-wraps it with a valid, magic-prefixed
    // payload of its own, never reaching this code path with malformed input.
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: buildEditorExtensions(),
      content: "",
    });
    try {
      const parser = PMDOMParser.fromSchema(editor.schema);
      // "hell" and "" are both valid base64 input (atob does not throw) but
      // carry no MARKER_MAGIC prefix — must not become a decoded-garbage or
      // silently-empty rawHtmlBlock node.
      for (const payload of ["hell", ""]) {
        const dom = document.createElement("div");
        dom.innerHTML = `<div data-raw-html-block="${payload}"></div>`;
        const parsed = parser.parse(dom);
        expect(parsed.firstChild?.type.name).not.toBe("rawHtmlBlock");
      }
    } finally {
      editor.destroy();
    }
  });
});

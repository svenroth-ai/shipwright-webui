/*
 * markdownTiptap.test.ts — the serialization SPIKE (FR-01.34).
 *
 * Proves the tiptap-markdown init/serialize wiring works in jsdom and that the
 * round-trip is STABLE (idempotent) for StarterKit prose, plus the lossy-construct
 * detection that drives the warn banner. If the headless Editor cannot mount in
 * jsdom this test fails loudly here (rather than surfacing as a blank editor in
 * production) — the round-trip would then move to E2E.
 */

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/react";

import {
  buildEditorExtensions,
  serializeEditorMarkdown,
  detectLossyConstructs,
} from "./markdownTiptap";

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

describe("markdownTiptap round-trip (spike)", () => {
  const fixture = [
    "# Heading 1",
    "",
    "Some **bold** and *italic* and `inline code`.",
    "",
    "- one",
    "- two",
    "",
    "1. first",
    "2. second",
    "",
    "> a quote",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "",
    "[a link](https://example.com)",
    "",
    "---",
    "",
    "Closing paragraph.",
    "",
  ].join("\n");

  it("mounts a headless editor and serializes back to markdown", () => {
    const out = roundTrip(fixture);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("preserves StarterKit prose constructs through the round-trip", () => {
    const out = roundTrip(fixture);
    expect(out).toContain("# Heading 1");
    expect(out).toContain("**bold**");
    expect(out).toContain("*italic*");
    expect(out).toContain("`inline code`");
    expect(out).toContain("const x = 1;");
    expect(out).toContain("> a quote");
    expect(out).toContain("[a link](https://example.com)");
  });

  it("is idempotent (serialize∘parse is a fixed point)", () => {
    const once = roundTrip(fixture);
    const twice = roundTrip(once);
    expect(twice).toBe(once);
  });

  it("parses markdown via editor.commands.setContent — the modal's actual load path (review #9)", () => {
    // The modal pre-populates with `editor.commands.setContent(text)`, NOT
    // init-time `content`. Prove tiptap-markdown parses markdown on that path
    // too (else the editor would load raw markdown as plain text).
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: buildEditorExtensions(),
      content: "",
    });
    try {
      editor.commands.setContent(fixture);
      const out = serializeEditorMarkdown(
        editor as unknown as { storage: Record<string, unknown> },
      );
      expect(out).toContain("# Heading 1");
      expect(out).toContain("**bold**");
      expect(out).toContain("[a link](https://example.com)");
    } finally {
      editor.destroy();
    }
  });

  it("handles empty / whitespace-only / single-newline input without crashing (review #14)", () => {
    expect(() => roundTrip("")).not.toThrow();
    expect(() => roundTrip("\n")).not.toThrow();
    expect(() => roundTrip("   \n   ")).not.toThrow();
    // and the empty round-trip is itself stable
    const empty = roundTrip("");
    expect(roundTrip(empty)).toBe(empty);
  });
});

describe("raw inline HTML links survive the round-trip", () => {
  // Regression: a blog article containing an inline `<a href>` link (e.g. a
  // "Built with Shipwright" attribution) was CORRUPTED on save — html:false
  // HTML-entity-escaped the tag to literal `&lt;a href=…&gt;…&lt;/a&gt;` text,
  // so the link silently stopped being a link. html:true now parses the anchor
  // into the Link mark and re-serializes it as an equivalent markdown link.

  it("preserves an inline <a href> link instead of escaping it to &lt;a&gt; text", () => {
    const out = roundTrip(
      'Built with <a href="https://github.com/svenroth-ai/shipwright">Shipwright</a>.',
    );
    // The bug signature: angle brackets escaped to HTML entities.
    expect(out).not.toContain("&lt;");
    expect(out).not.toContain("&gt;");
    // The link must survive as a functional markdown link (URL + text intact).
    expect(out).toContain(
      "[Shipwright](https://github.com/svenroth-ai/shipwright)",
    );
  });

  it("keeps the href intact when the anchor carries target/rel attributes", () => {
    const out = roundTrip(
      'Powered by <a href="https://shipwright.dev" target="_blank" rel="noopener">Shipwright</a> today.',
    );
    expect(out).not.toContain("&lt;");
    expect(out).toContain("[Shipwright](https://shipwright.dev)");
  });

  it("round-trips the recovered link idempotently", () => {
    const once = roundTrip(
      'See <a href="https://shipwright.dev">Shipwright</a> here.',
    );
    expect(roundTrip(once)).toBe(once);
  });

  it("does NOT smuggle a javascript: scheme link back to disk (SAFE_LINK_PROTOCOLS)", () => {
    const out = roundTrip('Danger <a href="javascript:alert(1)">x</a> end.');
    expect(out.toLowerCase()).not.toContain("javascript:");
    // The dangerous anchor is dropped to plain text — surrounding prose survives.
    expect(out).toContain("Danger");
    expect(out).toContain("end.");
  });
});

describe("detectLossyConstructs", () => {
  it("returns [] for a clean StarterKit-only document", () => {
    const clean = "# Title\n\nParagraph with **bold**.\n\n- a\n- b\n";
    expect(detectLossyConstructs(clean)).toEqual([]);
  });

  it("does NOT flag YAML frontmatter (preserved verbatim via splitMarkdownEnvelope)", () => {
    // Frontmatter is no longer lossy: the editor never sees it, so it round-trips
    // byte-for-byte. See markdownTiptap.envelope.test.ts for the round-trip proof.
    const md = "---\ntitle: hi\ntags: [a]\n---\n\n# Body\n";
    expect(detectLossyConstructs(md)).not.toContain("YAML frontmatter");
  });

  it("flags raw HTML and HTML comments", () => {
    expect(detectLossyConstructs('<a id="trg-1"></a>\n\ntext')).toContain("raw HTML");
    expect(detectLossyConstructs("text\n<!-- a comment -->\n")).toContain("HTML comments");
  });

  it("flags footnotes", () => {
    expect(detectLossyConstructs("text[^1]\n\n[^1]: note\n")).toContain("footnotes");
  });

  it("flags GFM tables and task lists", () => {
    const table = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    expect(detectLossyConstructs(table)).toContain("GFM tables");
    expect(detectLossyConstructs("- [ ] todo\n- [x] done\n")).toContain("task lists");
  });

  it("does NOT flag `<` inside a fenced code block as raw HTML", () => {
    const code = "```html\n<div>not real html in prose</div>\n```\n";
    expect(detectLossyConstructs(code)).not.toContain("raw HTML");
  });
});

/*
 * markdownTiptap.envelope.test.ts — round-trip BOUNDARY tests for the markdown
 * editor envelope (iterate-2026-06-03-md-editor-frontmatter-roundtrip).
 *
 * Pins the fix for the "whole file shows changed when only a comma was edited"
 * bug: YAML frontmatter, line endings (CRLF), and the trailing newline are
 * preserved VERBATIM because the editor only ever owns the prose `core`. The
 * round-trip serializer (tiptap-markdown getMarkdown) never sees them.
 *
 * Line endings are built from char codes (String.fromCharCode) on purpose:
 * literal "\n"/"\r" escapes in editor-written source have corrupted files in
 * this repo before (see project memory). Do NOT replace with escape sequences.
 */

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/react";
import { diffLines, type Change } from "diff";

import {
  buildEditorExtensions,
  serializeEditorMarkdown,
  detectLossyConstructs,
  splitMarkdownEnvelope,
  composeMarkdownEnvelope,
} from "./markdownTiptap";

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const CRLF = CR + LF;

/** Serialize a prose `core` through a headless editor — the modal's real path. */
function serializeCore(core: string): string {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(),
    content: "",
  });
  try {
    editor.commands.setContent(core);
    return serializeEditorMarkdown(
      editor as unknown as { storage: Record<string, unknown> },
    );
  } finally {
    editor.destroy();
  }
}

/** Full modal round-trip: split -> editor owns core only -> recompose. */
function roundTripFile(text: string): string {
  const env = splitMarkdownEnvelope(text);
  return composeMarkdownEnvelope(env, serializeCore(env.core));
}

const FM_LINES = [
  "---",
  'title: "Point Dynamic workflows on your own work (LinkedIn)"',
  'slug: "dynamic-workflows-on-your-own-work"',
  'content_type: "linkedin"',
  'keywords: ["dynamic workflows", "claude code"]',
  "---",
];
const BODY_LINES = [
  "",
  "Most workflows, pinned at your own work, stay small.",
  "",
  "Mark the opposite. He pointed it at himself.",
  "",
];

/** A frontmatter blog file using the given line ending. */
function fileWith(eol: string): string {
  return [...FM_LINES, ...BODY_LINES].join(eol);
}

function countLines(parts: Change[], which: "added" | "removed"): number {
  return parts
    .filter((p) => (which === "added" ? p.added : p.removed))
    .reduce((n, p) => n + (p.count ?? 0), 0);
}

describe("splitMarkdownEnvelope", () => {
  it("decomposes a frontmatter file into prefix / core / suffix / eol", () => {
    const env = splitMarkdownEnvelope(fileWith(LF));
    expect(env.eol).toBe(LF);
    expect(env.frontmatter.startsWith("---")).toBe(true);
    expect(env.frontmatter.includes('title: "Point Dynamic')).toBe(true);
    // editor owns ONLY the prose body, trimmed of surrounding whitespace
    expect(env.core.startsWith("Most workflows")).toBe(true);
    expect(env.core.endsWith("himself.")).toBe(true);
    expect(env.suffix).toBe(LF);
    // prefix carries the verbatim fence + the blank line separating it
    expect(env.prefix.includes(env.frontmatter)).toBe(true);
  });

  it("degrades to no frontmatter (prefix empty) when the file has none", () => {
    const file = ["Just a body.", "", "Second paragraph.", ""].join(LF);
    const env = splitMarkdownEnvelope(file);
    expect(env.frontmatter).toBe("");
    expect(env.core.startsWith("Just a body.")).toBe(true);
  });

  it("detects CRLF as the eol", () => {
    expect(splitMarkdownEnvelope(fileWith(CRLF)).eol).toBe(CRLF);
  });

  it("keeps first-body-line indentation in core, not prefix (only blank lines move out)", () => {
    // external review #1: arbitrary leading whitespace must NOT be hoisted into
    // prefix — an indented first line belongs to the editor-owned core.
    const file = [
      "---",
      "title: x",
      "---",
      "",
      "    indented first line",
      "plain second line",
      "",
    ].join(LF);
    const env = splitMarkdownEnvelope(file);
    expect(env.core.startsWith("    indented first line")).toBe(true);
    expect(env.prefix.endsWith(LF)).toBe(true); // ends at the blank separator
    expect(env.prefix.includes("indented")).toBe(false);
  });

  it("frontmatter-less body with an indented first line keeps the indent in core", () => {
    const file = ["    indented first line", "plain second line", ""].join(LF);
    const env = splitMarkdownEnvelope(file);
    expect(env.frontmatter).toBe("");
    expect(env.prefix).toBe(""); // no blank lines to consume
    expect(env.core.startsWith("    indented first line")).toBe(true);
  });
});

describe("markdown editor round-trip preserves the file envelope", () => {
  it("AC1: an unedited canonical-body frontmatter file is byte-identical", () => {
    const file = fileWith(LF);
    expect(roundTripFile(file)).toBe(file);
  });

  it("AC2: a single body edit yields exactly a one-line diff", () => {
    const file = fileWith(LF);
    const env = splitMarkdownEnvelope(file);
    // remove one comma in the body
    const editedCore = env.core.replace(
      "Most workflows, pinned at your own work, stay small.",
      "Most workflows pinned at your own work, stay small.",
    );
    const recomposed = composeMarkdownEnvelope(env, serializeCore(editedCore));
    const parts = diffLines(file, recomposed);
    expect(countLines(parts, "added")).toBe(1);
    expect(countLines(parts, "removed")).toBe(1);
  });

  it("AC3: YAML frontmatter is preserved byte-for-byte (no setext-heading mangling)", () => {
    const out = roundTripFile(fileWith(LF));
    expect(out).toContain(FM_LINES.join(LF));
    expect(out).not.toContain("## title"); // closing --- must NOT become an H2
    expect(out).toContain('keywords: ["dynamic workflows", "claude code"]'); // not escaped
  });

  it("AC4: CRLF line endings are preserved (unedited file byte-identical)", () => {
    const file = fileWith(CRLF);
    const out = roundTripFile(file);
    expect(out.includes(CR)).toBe(true);
    expect(out).toBe(file);
  });

  it("AC5: the trailing-newline convention is preserved (with and without)", () => {
    const withNl = fileWith(LF);
    expect(roundTripFile(withNl).endsWith(LF)).toBe(true);
    const withoutNl = [...FM_LINES, "", "Body line."].join(LF);
    const out = roundTripFile(withoutNl);
    expect(out.endsWith("Body line.")).toBe(true);
    expect(out).toBe(withoutNl);
  });

  it("AC6: a file with no frontmatter still round-trips byte-identically", () => {
    const file = ["Just a body.", "", "Second paragraph.", ""].join(LF);
    expect(roundTripFile(file)).toBe(file);
  });

  it("is idempotent: round-tripping twice equals once", () => {
    const once = roundTripFile(fileWith(LF));
    expect(roundTripFile(once)).toBe(once);
  });
});

describe("AC7: frontmatter is no longer a lossy construct", () => {
  it("detectLossyConstructs does not flag YAML frontmatter", () => {
    expect(detectLossyConstructs(fileWith(LF))).not.toContain("YAML frontmatter");
  });
});

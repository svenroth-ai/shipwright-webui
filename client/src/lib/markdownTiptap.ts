/*
 * markdownTiptap.ts — TipTap (ProseMirror) wiring for the SmartViewer markdown
 * editor (iterate-2026-06-03-smartviewer-markdown-editor, FR-01.34).
 *
 * "Rich editing, Markdown saved": markdown is parsed INTO the editor and
 * serialized BACK OUT via `tiptap-markdown`. The round-trip is NOT the identity
 * function — emphasis markers, list bullets, and whitespace can normalise — so
 * the editor modal ALWAYS shows a pre-save diff and a non-blocking warn banner
 * (see `detectLossyConstructs`) before any write. Phase 1 scope = StarterKit
 * prose nodes only (headings, bold/italic, lists, code, blockquote, link, HR);
 * tables / task-lists / raw HTML are detected and flagged, not represented.
 */

import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import type { Extensions } from "@tiptap/react";

/** Link schemes the editor will keep; `javascript:` et al. are dropped so a
 *  serialized doc can't smuggle an executable scheme back to disk (review #12).
 *  The read-only preview additionally sanitizes via rehype-sanitize. */
export const SAFE_LINK_PROTOCOLS = ["http", "https", "mailto"];

/**
 * The extension set shared by the live editor (`useEditor`) and the round-trip
 * tests. `html: false` keeps raw HTML out of the serialized output — such files
 * are flagged by {@link detectLossyConstructs} instead of silently round-tripped.
 */
export function buildEditorExtensions(): Extensions {
  return [
    StarterKit,
    Link.configure({
      openOnClick: false,
      autolink: false,
      protocols: SAFE_LINK_PROTOCOLS,
      HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
    }),
    Markdown.configure({
      html: false,
      tightLists: true,
      bulletListMarker: "-",
      linkify: false,
      breaks: false,
      transformPastedText: false,
      transformCopiedText: false,
    }),
  ];
}

/**
 * Serialize the current editor document back to Markdown via the
 * `tiptap-markdown` storage. Accepts the loose `Editor.storage`
 * (`Record<string, any>`) shape; returns "" if the extension is absent.
 */
export function serializeEditorMarkdown(editor: {
  storage: Record<string, unknown>;
}): string {
  const storage = editor.storage.markdown as
    | { getMarkdown?: () => string }
    | undefined;
  return storage?.getMarkdown?.() ?? "";
}

// --- Lossy-construct detection (warn banner) -------------------------------

/** Remove fenced + inline code so a `<` inside a code sample doesn't read as
 *  raw HTML. Cheap + good enough for a heuristic warning. */
function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`]*`/g, "");
}

interface LossyRule {
  id: string;
  label: string;
  test: (text: string) => boolean;
}

const LOSSY_RULES: LossyRule[] = [
  {
    id: "frontmatter",
    label: "YAML frontmatter",
    test: (t) => /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.test(t),
  },
  {
    id: "html-comment",
    label: "HTML comments",
    test: (t) => /<!--[\s\S]*?-->/.test(t),
  },
  {
    id: "raw-html",
    label: "raw HTML",
    test: (t) => /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?>/.test(stripCode(t)),
  },
  {
    id: "footnotes",
    label: "footnotes",
    test: (t) => /\[\^[^\]]+\]/.test(stripCode(t)),
  },
  {
    id: "table",
    label: "GFM tables",
    // A delimiter row: `|---|:--:|` style.
    test: (t) => /^\s*\|?[ \t]*:?-{3,}:?[ \t]*\|/m.test(t),
  },
  {
    id: "task-list",
    label: "task lists",
    test: (t) => /^\s*[-*+]\s+\[[ xX]\]\s/m.test(t),
  },
  {
    id: "ref-link",
    label: "reference-style links",
    test: (t) => /^\s*\[[^\]]+\]:\s+\S+/m.test(stripCode(t)),
  },
];

/**
 * Return human-readable labels for markdown constructs that the StarterKit-only
 * editor cannot represent and would therefore drop or normalise on save. An
 * empty array means "safe to rich-edit"; a non-empty array drives the modal's
 * non-blocking warn banner. Heuristic by design — false positives only nudge
 * the user to read the diff (which already shows every change). (review #9)
 */
export function detectLossyConstructs(text: string): string[] {
  const labels: string[] = [];
  for (const rule of LOSSY_RULES) {
    if (rule.test(text)) labels.push(rule.label);
  }
  return labels;
}

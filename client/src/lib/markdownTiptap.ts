/*
 * markdownTiptap.ts — TipTap (ProseMirror) wiring for the SmartViewer markdown
 * editor (iterate-2026-06-03-smartviewer-markdown-editor, FR-01.34).
 *
 * "Rich editing, Markdown saved": markdown is parsed INTO the editor and
 * serialized BACK OUT via `tiptap-markdown`. The round-trip is NOT the identity
 * function — emphasis markers, list bullets, and whitespace can normalise — so
 * the editor modal ALWAYS shows a pre-save diff and a non-blocking warn banner
 * (see `detectLossyConstructs`) before any write. Scope = StarterKit prose nodes
 * (headings, bold/italic, lists, code, blockquote, link, HR). Raw HTML is PARSED
 * (`html: true`) so inline tags that map to the schema survive — an `<a href>`
 * round-trips to its equivalent `[text](url)` markdown link instead of being
 * entity-escaped to corrupt `&lt;a&gt;` text (the editor used to break "Built
 * with Shipwright" attribution links on save). HTML with no schema node
 * (inline `<span>`, an anchor carrying attributes beyond `href`) is still
 * normalised away and stays flagged by {@link detectLossyConstructs}; tables /
 * task-lists / footnotes are likewise detected and flagged, not represented.
 *
 * A block-level raw-HTML construct (a markdown line that OPENS a block tag,
 * e.g. a styled CTA `<p><strong><a href="..." style="...">...</a></strong></p>`)
 * is a DIFFERENT case from the inline one above — it round-trips byte-for-byte
 * via the `RawHtmlBlock` node (iterate-2026-08-31-markdown-raw-html-passthrough,
 * see `markdownRawHtmlBlock.ts`), never normalised into the schema at all.
 */

import StarterKit from "@tiptap/starter-kit";
import Link, { isAllowedUri } from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import type { Extensions } from "@tiptap/react";
import MarkdownIt from "markdown-it";

import { RawHtmlBlock, RawHtmlBlockDocument, MARKDOWN_IT_OPTIONS } from "./markdownRawHtmlBlock";

export {
  type MarkdownEnvelope,
  splitMarkdownEnvelope,
  composeMarkdownEnvelope,
} from "./markdownEnvelope";

/** Link schemes the editor will keep; `javascript:` et al. are dropped so a
 *  serialized doc can't smuggle an executable scheme back to disk (review #12).
 *  The read-only preview additionally sanitizes via rehype-sanitize. */
export const SAFE_LINK_PROTOCOLS = ["http", "https", "mailto"];

/**
 * The extension set shared by the live editor (`useEditor`) and the round-trip
 * tests. `html: true` lets raw inline HTML that maps to the schema (notably
 * `<a href>`) round-trip as its markdown equivalent rather than being entity-
 * escaped into corrupt text; the `SAFE_LINK_PROTOCOLS` allowlist still drops a
 * `javascript:`-scheme anchor on the way in. HTML with no schema node is
 * normalised away and remains flagged by {@link detectLossyConstructs}.
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
    RawHtmlBlock,
    // MUST come after StarterKit — TipTap merges same-named extensions by
    // array order (later wins), and this overrides StarterKit's `doc` node.
    RawHtmlBlockDocument,
    Markdown.configure({
      html: MARKDOWN_IT_OPTIONS.html,
      tightLists: true,
      bulletListMarker: "-",
      linkify: MARKDOWN_IT_OPTIONS.linkify,
      breaks: MARKDOWN_IT_OPTIONS.breaks,
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

// NOTE: YAML frontmatter is deliberately NOT in this list. It used to be
// flagged as lossy, but `splitMarkdownEnvelope` now preserves it verbatim
// (the editor never sees it), so it round-trips cleanly. The modal surfaces a
// separate, neutral "frontmatter preserved" note instead of a lossy warning.
//
// NOTE: "HTML comments" and "raw HTML" are NOT in this regex-based list —
// they're detected by `detectHtmlLossiness` below via a markdown-it instance
// built from the SAME markdown-it CONFIG the editor's own parser uses
// (`MARKDOWN_IT_OPTIONS`) — not the same instance: tiptap-markdown's own
// instance additionally installs a task-lists plugin and a patched code-block
// renderer, irrelevant to html_block/html_inline classification but worth
// naming so a future reader doesn't assume token-for-token parity. A
// text-only regex cannot tell a now-safe block-level construct (preserved
// verbatim by `RawHtmlBlock`) from a still-lossy inline one, and a second,
// differently-CONFIGURED parser could disagree with what the editor actually
// does (iterate-2026-08-31-markdown-raw-html-passthrough, both external
// reviewers).
const LOSSY_RULES: LossyRule[] = [
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

// An inline anchor OPEN tag is lossless only when `href` is its SOLE
// attribute and the URI is one the Link mark itself would actually accept —
// any other attribute (id/class/style/target/rel/data-*) falls through to
// the lossy branch, and so does every other inline tag. A bare closing
// `</a>` carries no attributes and is never lossy on its own.
const SAFE_INLINE_ANCHOR_OPEN = /^<a\s+href=(?:"([^"]*)"|'([^']*)'|(\S+))\s*>$/i;
const SAFE_INLINE_ANCHOR_CLOSE = /^<\/a\s*>$/i;
const HTML_COMMENT = /^<!--[\s\S]*-->$/;

/**
 * URI safety uses tiptap's OWN `isAllowedUri` (the exact function the Link
 * mark's `renderHTML`/`parseHTML` call) instead of a hand-rolled scheme-
 * prefix check — a prior version here only accepted a double-quoted,
 * `SAFE_LINK_PROTOCOLS`-prefixed absolute URL and false-positived on a
 * single-quoted/unquoted attribute or a relative/fragment/protocol-relative
 * href (`/docs`, `#section`, `//example.com`) that the Link mark round-trips
 * losslessly (external review, iterate-2026-08-31). Two independently-
 * written acceptance rules for the same underlying behavior is exactly the
 * class of bug this was.
 */
function isSafeInlineAnchorOpen(tagText: string): boolean {
  const match = SAFE_INLINE_ANCHOR_OPEN.exec(tagText);
  if (!match) return false;
  const href = match[1] ?? match[2] ?? match[3];
  return !!isAllowedUri(href, SAFE_LINK_PROTOCOLS);
}

/**
 * Tokenizes `text` with the editor's own markdown-it configuration and
 * classifies its raw-HTML constructs the way the editor actually will:
 * a top-level (`level === 0`) `html_block` token is safe (preserved
 * byte-for-byte by `RawHtmlBlock`); a nested one (inside a blockquote/list —
 * out of scope for this iterate) and any inline HTML the schema can't
 * losslessly represent both remain lossy.
 */
function detectHtmlLossiness(text: string): { hasComment: boolean; hasRawHtml: boolean } {
  let tokens: Array<{ type: string; level: number; content: string; children?: Array<{ type: string; content: string }> | null }>;
  try {
    tokens = new MarkdownIt(MARKDOWN_IT_OPTIONS).parse(text, {});
  } catch {
    return { hasComment: false, hasRawHtml: false }; // malformed input — let the diff surface it
  }

  let hasComment = false;
  let hasRawHtml = false;
  for (const token of tokens) {
    if (token.type === "html_block") {
      if (token.level !== 0) hasRawHtml = true; // nested — still lossy, see file header
      continue;
    }
    if (token.type !== "inline" || !token.children) continue;
    for (const child of token.children) {
      if (child.type !== "html_inline") continue;
      if (HTML_COMMENT.test(child.content)) {
        hasComment = true;
      } else if (!isSafeInlineAnchorOpen(child.content) && !SAFE_INLINE_ANCHOR_CLOSE.test(child.content)) {
        hasRawHtml = true;
      }
    }
  }
  return { hasComment, hasRawHtml };
}

/**
 * Return human-readable labels for markdown constructs the StarterKit-only
 * editor cannot represent WITHOUT LOSING information — dropped entirely
 * (a table, an inline `<span style>` with no schema node), or rewritten to a
 * form that is not semantically equivalent. NOT flagged: a construct that
 * normalises to a schema-native, EQUIVALENT representation — an href-only
 * `<a href="...">text</a>` rewriting to `[text](url)` changes markup syntax
 * but preserves the same URL and text with nothing lost (the pre-existing
 * FR-01.34 fix this editor already relies on); a top-level raw HTML block
 * preserved byte-for-byte by `RawHtmlBlock` is equivalent by construction. An
 * empty array means "safe to rich-edit"; a non-empty array drives the modal's
 * non-blocking warn banner. Heuristic by design — false positives only nudge
 * the user to read the diff (which already shows every change). (review #9)
 */
export function detectLossyConstructs(text: string): string[] {
  const labels: string[] = [];
  const { hasComment, hasRawHtml } = detectHtmlLossiness(text);
  if (hasComment) labels.push("HTML comments");
  if (hasRawHtml) labels.push("raw HTML");
  for (const rule of LOSSY_RULES) {
    if (rule.test(text)) labels.push(rule.label);
  }
  return labels;
}

/*
 * markdownRawHtmlBlock.ts — the `rawHtmlBlock` TipTap node
 * (iterate-2026-08-31-markdown-raw-html-passthrough).
 *
 * Bug: a block-level raw-HTML construct (markdown-it's `html_block` token —
 * a markdown line that OPENS a block-level tag, e.g. a styled CTA
 * `<p><strong><a href="..." style="...">...</a></strong></p>`) was silently
 * reinterpreted into the TipTap/ProseMirror schema on load and re-serialized
 * as plain Markdown on save, dropping any attribute the schema doesn't model
 * (`style`, `class`, `id`, `data-*`, ...) with no warning. See
 * markdownTiptap.ts's file header for the parser/serializer architecture and
 * why `html:true` exists at all (an EARLIER, separate fix for inline
 * `<a href>` tags — untouched by this node, see the scope note below).
 *
 * Fix: intercept markdown-it's `html_block` token BEFORE tiptap-markdown's
 * MarkdownParser hands its rendered HTML string to ProseMirror's DOM-based
 * schema parser, and represent it as this atomic, non-editable node holding
 * the original markup as a string attribute — serialized back byte-for-byte
 * (content only; see the blank-line note on `serialize` below).
 *
 * Scope: TOP-LEVEL (`token.level === 0`) html_block tokens only. A block
 * nested inside a blockquote/list item is left untouched (still lossy, still
 * flagged by detectLossyConstructs) — CommonMark's per-line `> `/indent
 * prefix handling for a raw multi-line block is a materially different, and
 * separately risky, serialization problem this iterate does not take on
 * (external + internal review both flagged it). `html_inline` tokens
 * (raw HTML embedded mid-line, e.g. the pre-existing `<a href>` attribution
 * fix) are NEVER touched here — only `md.renderer.rules.html_block` is
 * overridden.
 */

import { Node } from "@tiptap/core";
import MarkdownIt from "markdown-it";

/** Shared with `detectLossyConstructs` (markdownTiptap.ts) so the warn-banner
 *  heuristic classifies HTML exactly the way this node (and the editor's own
 *  parser) actually will. */
export const MARKDOWN_IT_OPTIONS: { html: boolean; linkify: boolean; breaks: boolean } = {
  html: true,
  linkify: false,
  breaks: false,
};

const MARKER_TAG = "div";
const MARKER_ATTR = "data-raw-html-block";

/**
 * A literal prefix (outside the base64 alphabet) rather than a base64-decode
 * SUCCESS is what tells `getAttrs` this element is a marker WE produced.
 * `atob` on 4-char input, or on `""`, does NOT throw — it happily returns
 * mojibake or an empty string — so "decode didn't throw" is not evidence of
 * provenance. Without this, a file that legitimately contains
 * `<div data-raw-html-block="...">real content</div>` (nested, so
 * `htmlBlockRendererRule` leaves it verbatim per the level!==0 branch below)
 * would have its real children silently discarded and replaced by decoded
 * garbage on the next parse (doubt-reviewer MEDIUM finding,
 * iterate-2026-08-31 — a content-substitution risk, not just a decode
 * failure). Combined with the `childNodes.length === 0` check in `getAttrs`
 * (the renderer never emits children — real content would prove this is NOT
 * our marker), both known corruption paths (substitution + mojibake/empty
 * payload) are closed by construction rather than by guessing at malformed
 * input.
 */
const MARKER_MAGIC = "shipwright-v1:";

/** UTF-8-safe base64 — the raw HTML can contain quotes, `&`, `<`, newlines;
 *  anything else would need per-context escaping (attribute vs. text) and a
 *  matching unescape on the way back. An opaque payload sidesteps that
 *  entire class of bug (both external reviewers flagged naive interpolation
 *  here as a HIGH-severity correctness/security risk). */
function encodePayload(html: string): string {
  const bytes = new TextEncoder().encode(html);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return MARKER_MAGIC + btoa(binary);
}

/** Returns `null` — never throws — for anything not carrying our magic
 *  prefix, so `getAttrs` can tell "not our marker" apart from "our marker,
 *  malformed" (the latter genuinely shouldn't happen; the former is file
 *  content we must not touch). */
function decodePayload(payload: string): string | null {
  if (!payload.startsWith(MARKER_MAGIC)) return null;
  const binary = atob(payload.slice(MARKER_MAGIC.length));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * markdown-it renderer-rule override for the `html_block` token type.
 *
 * MUST be a stable, module-scoped function reassigned by plain identity on
 * every call to `parse.setup` (never captured-and-wrapped): tiptap-markdown
 * re-runs `parse.setup(md)` for every extension on EVERY `MarkdownParser.parse()`
 * call, and the `md` instance is long-lived across editor opens (one
 * `useEditor()` instance reused for the modal's whole lifetime). A closure
 * that reads `md.renderer.rules.html_block` and wraps "the current rule"
 * would stack a new wrapper on every modal open — this function never reads
 * the installed rule, so reassigning it is idempotent by construction.
 */
function htmlBlockRendererRule(tokens: Array<{ level: number; content: string }>, idx: number): string {
  const token = tokens[idx];
  if (token.level !== 0) {
    // Nested inside a blockquote/list — out of scope (see file header).
    // Falls through to markdown-it's own default html_block rendering
    // (verbatim content), unchanged from before this fix.
    return token.content;
  }
  // The token's content sometimes carries a trailing "\n" (when more block
  // content follows) and sometimes doesn't (end of document) — trim it so
  // the stored attribute never contains it. Blank-line spacing between this
  // block and its siblings is owned by the serializer's write()/closeBlock()
  // pair below, not by keeping the token's own trailing newline.
  const html = token.content.endsWith("\n") ? token.content.slice(0, -1) : token.content;
  return `<${MARKER_TAG} ${MARKER_ATTR}="${encodePayload(html)}"></${MARKER_TAG}>`;
}

export const RawHtmlBlock = Node.create({
  name: "rawHtmlBlock",
  // Deliberately NOT in the `"block"` group — see `RawHtmlBlockDocument`
  // below. Being in `"block"` would let blockquote/listItem's `block+`
  // content expression accept the chip via the toolbar's Blockquote/List
  // buttons; `state.text(html, false)` (the Stage-2 fix) makes THAT
  // serialize correctly, but on the NEXT load the marker div is now
  // nested (`token.level !== 0`), `htmlBlockRendererRule` falls through to
  // verbatim content, and ProseMirror's DOM parser drops the attributes
  // again — silently reintroducing the exact bug this iterate fixes
  // (doubt-reviewer HIGH finding, iterate-2026-08-31). No group membership
  // means no content expression this schema defines accepts the node except
  // the top-level `doc` override, so ProseMirror's OWN transform validation
  // (`wrapIn`, drag-and-drop, any future block-wrapping command) refuses
  // the wrap structurally — no per-command guard to keep in sync.
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      html: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: `${MARKER_TAG}[${MARKER_ATTR}]`,
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          // The renderer NEVER emits children — an element with real DOM
          // children is file content that happens to share our marker's
          // tag+attribute, not a marker we produced (doubt-reviewer MEDIUM
          // finding — content substitution). Checked before touching the
          // payload at all: this rejects real content regardless of what
          // the attribute value happens to be.
          if (el.childNodes.length !== 0) return false;
          const payload = el.getAttribute(MARKER_ATTR) ?? "";
          try {
            const html = decodePayload(payload);
            // MARKER_MAGIC missing (see decodePayload) or, in principle, a
            // corrupt base64 tail — either way this is not our marker, or
            // is one damaged beyond recovery; `false` falls through to
            // normal (empty-element) DOM parsing instead of a silently
            // empty rawHtmlBlock node (code-reviewer LOW finding).
            if (html === null) return false;
            return { html };
          } catch {
            return false;
          }
        },
      },
    ];
  },

  renderHTML({ node }) {
    const html = (node.attrs.html as string) ?? "";
    // String children become DOM TEXT nodes (never parsed as HTML) per
    // ProseMirror's DOMOutputSpec contract — the safe way to show untrusted
    // file content. Do NOT reach for innerHTML / a NodeView with innerHTML
    // here: `html` is attacker-influenceable file content (this node's
    // whole purpose is to hold arbitrary markup, `<script>` included).
    return [
      MARKER_TAG,
      {
        [MARKER_ATTR]: encodePayload(html),
        contenteditable: "false",
        "data-testid": "raw-html-block-chip",
        style:
          "margin: 0.5em 0; padding: 8px 10px; border-radius: 6px; " +
          "border: 1px solid var(--color-border, #e0dbd4); " +
          "background: var(--color-muted-bg, #ede8e1);",
      },
      [
        "div",
        {
          style:
            "font-size: 11px; font-weight: 500; text-transform: uppercase; " +
            "letter-spacing: 0.03em; color: var(--color-muted, #6b7280); margin-bottom: 4px;",
        },
        "Raw HTML — preserved as-is",
      ],
      [
        "pre",
        {
          style:
            "margin: 0; white-space: pre-wrap; word-break: break-word; " +
            "font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; " +
            "color: var(--color-text, #1a1a1a);",
        },
        ["code", {}, html],
      ],
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { text: (s: string, escape?: boolean) => void; closeBlock: (n: unknown) => void }, node: { attrs: { html: string } }) {
          // state.text(content, escape=false) — NOT state.write(content).
          // write() applies the state's block-nesting delimiter (e.g. "> "
          // for a blockquote, list indent for a list item) at most ONCE,
          // then appends the whole multi-line string raw, which would
          // corrupt a multi-line block on the delimiter'S line 1 only
          // (code-reviewer HIGH finding, iterate-2026-08-31). The node is no
          // longer wrappable at all now that it carries no `"block"` group
          // membership (see the node config above / `RawHtmlBlockDocument`
          // below — doubt-reviewer HIGH finding), so this is defense in
          // depth rather than the only guard: text() splits on "\n" and
          // calls the delimiter-applying write() once per line —
          // escape=false keeps every line byte-verbatim, matching
          // serialize's byte-for-byte contract; at the top level (the only
          // level this node can now occupy) there is no delimiter, so
          // output is identical to the old write() call.
          state.text(node.attrs.html, false);
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownIt) {
            md.renderer.rules.html_block = htmlBlockRendererRule;
          },
        },
      },
    };
  },
});

/**
 * Overrides StarterKit's default `doc` node (`content: "block+"`) to also
 * accept `rawHtmlBlock` — but ONLY at the document's own top level, since
 * `rawHtmlBlock` carries no `"block"` group membership. TipTap merges
 * extensions by `name`; placed after `StarterKit` in `buildEditorExtensions`,
 * this wins. Without it `rawHtmlBlock` would have no valid position in the
 * doc at all (doubt-reviewer HIGH finding, iterate-2026-08-31): making the
 * wrap structurally impossible at the schema level is what closes the
 * blockquote/list re-corruption case, rather than a per-command guard that
 * would need to be kept in sync with every future block-wrapping command.
 */
export const RawHtmlBlockDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "(block|rawHtmlBlock)+",
});

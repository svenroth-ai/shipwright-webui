# Raw HTML block passthrough via a structurally-restricted TipTap node

## Context

SmartViewer's markdown editor (TipTap + `tiptap-markdown`) silently rewrote any
top-level raw HTML block (e.g. a styled CTA `<p><a href="..." style="...">`) into
a plain Markdown link on save, dropping the styling with no warning. The user's
explicit preference was a fix, not a warning: the block must round-trip
byte-for-byte, not merely surface a more visible loss notice.

## Decision

Add a `RawHtmlBlock` atom node that stores the raw HTML verbatim (base64,
magic-prefixed for provenance) and serializes it back unchanged. Because
ProseMirror schema `group` membership is a *structural* transform guard — not
just a per-command check — `RawHtmlBlock` deliberately carries no `group:
"block"` membership; instead a `RawHtmlBlockDocument` node (`content:
"(block|rawHtmlBlock)+"`) overrides StarterKit's default `doc` so the node can
only ever exist at the document's own top level. This makes wrapping it into a
blockquote or list (via the toolbar or any other transform) structurally
impossible, rather than merely guarded, closing a corruption path a Stage-3
doubt review found in an earlier version of this fix that only patched the
node's serializer.

## Consequences

Top-level raw HTML (CommonMark html_block rules 1-7) now round-trips verbatim
through the editor; nesting inside a blockquote/list remains lossy (out of
scope — a pre-existing, disclosed limitation of markdown-it's own tokenizer
boundaries, not a regression). Inter-block whitespace can still normalize on
save for two adjacent blocks with no blank line between them (a pre-existing
editor-wide behavior, now also disclosed for this node) — this is a
"whole-file byte-for-byte" trade-off, not a violation of the "this block's own
bytes" round-trip guarantee the acceptance criteria actually make.

## Rationale

A per-command guard (checking the node type before allowing `toggleBlockquote`/
`toggleBulletList`) was tried first and rejected: it only prevents the *toolbar*
from performing the wrap, but ProseMirror's own `wrapIn` transform machinery
(drag-and-drop, programmatic calls, future toolbar buttons) would still succeed,
silently re-introducing the exact corruption this iterate fixes. Restricting via
the schema's content expression closes the class at the transform-validation
level itself, so no future caller can rediscover the bug.

## Rejected alternatives

(1) Warning banner only, rejected per explicit user preference for a real fix.
(2) Allow `RawHtmlBlock` inside `group: "block"` and rely on a `canWrap`
per-command guard, rejected as incomplete (see Rationale). (3) A full
inter-block whitespace preservation rewrite across all StarterKit node types,
rejected as a materially larger, editor-wide change out of scope for this bug
fix — deferred, documented as a known, disclosed trade-off instead.

## Full review record

Three internal review rounds (spec-reviewer PASS; code-reviewer 7 findings, all
fixed or disclosed; doubt-reviewer 6 doubts — 3 fixed in code including the
schema-restriction finding above, 2 rebutted with evidence, 1 accepted with a
documented bound) plus an external two-provider code review cascade (1 medium
finding, fixed) are recorded in full, including every finding's disposition and
resolution text, in the iterate spec:
`.shipwright/planning/iterate/2026-08-31-markdown-raw-html-passthrough.md`.

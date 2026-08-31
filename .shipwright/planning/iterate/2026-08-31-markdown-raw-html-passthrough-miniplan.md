# Mini-Plan: markdown-raw-html-passthrough

- **Run ID:** iterate-2026-08-31-markdown-raw-html-passthrough

## 1. Files to create/modify
- `client/src/lib/markdownTiptap.ts` (edit) — new `RawHtmlBlock` TipTap Node
  extension + wiring into `buildEditorExtensions()`; tighten
  `detectLossyConstructs`'s `raw-html` rule to skip content covered by the
  new passthrough.
- `client/src/lib/markdownTiptap.test.ts` (edit) — the failing repro (already
  added), a byte-identical round-trip assertion, an idempotency check, and
  updated `detectLossyConstructs` cases.
- `client/src/styles/*.css` or inline Tailwind classes for the NodeView chip
  (edit, minimal — reuse existing tokens, no new file).
- `client/e2e/flows/markdown-editor-raw-html-passthrough.spec.ts` (new) —
  F0.5 E2E: open the editor on a fixture file with a raw HTML block, confirm
  the chip renders, save, confirm the saved file is byte-identical for that
  block.
- `.shipwright/planning/*/spec.md` (edit) — FR-01.35 AC line + "Updates:"
  cell (F1/F2 territory, done at finalization time per artifact ownership).

## 2. Work breakdown
1. Implement `RawHtmlBlock` Node: schema (`atom: true`, `selectable: true`,
   `attrs: { html: {} }`), a markdown-it `html_block` renderer-rule override
   (registered via the node's `addStorage().markdown.parse.setup(md)` hook)
   that emits a `<div data-raw-html-block="...">` marker instead of the raw
   markup, a `parseHTML`/`renderHTML` pair that round-trips that marker to
   the node attr, a `NodeView` for the read-only chip+preview, and a
   `markdown.serialize` that writes `node.attrs.html` verbatim (CommonMark
   block spacing: blank line before/after). Test: the failing repro from the
   spec goes green.
2. Confirm the pre-existing inline-`<a href>` fix is untouched (regression
   suite green) — `html_inline` tokens are not intercepted, only
   `html_block`.
3. Update `detectLossyConstructs`'s `raw-html` rule: only flag raw HTML that
   is NOT going to be captured by the new `html_block` passthrough. Simplest
   correct approach: tokenize with the same markdown-it instance
   (`html:true`) used by the editor and flag only remaining `html_inline`
   tokens whose content isn't already covered by the existing inline-link
   allowance — reuse markdown-it directly instead of extending the regex
   heuristic, since the regex cannot distinguish block vs. inline HTML
   reliably. Test: updated `detectLossyConstructs` describe block.
4. Wire the NodeView chip's minimal styling (muted chip, monospace preview,
   collapsed by default with an expand toggle if the raw HTML is long).
5. Author + run the E2E Playwright spec (medium+ mandatory) against the dev
   stack; capture evidence for F0.5.
6. Update FR-01.35 (`## Spec Impact`, done during F1/F2).

## 3. Component hierarchy (UI)
`MarkdownEditorModal` → `EditorContent` (TipTap) → new `RawHtmlBlock`
NodeView (leaf, no children) — sibling to existing StarterKit nodes, no
change to `MarkdownEditorToolbar` or `MarkdownEditorBanners` structure
(the banner's `warnings` prop just gets a shorter list on affected files).

## 4. Data model changes
None.

## 5. Test strategy
- Unit (vitest): round-trip byte-identity for the reported fixture +
  additional raw-HTML-block fixtures (nested tags, multiple attributes, a
  block with no attributes at all, adjacent prose paragraphs before/after
  the block); idempotency (`roundTrip(roundTrip(x)) === roundTrip(x)`);
  inline-link regression suite unmodified and green;
  `detectLossyConstructs` block-vs-inline distinction.
- E2E (Playwright, medium+ mandatory): load→edit→save cycle through the
  real modal against the dev stack, confirming the on-disk file is
  unchanged for the raw-HTML region after a no-op save.

## 6. Alternative approach (considered, rejected)
**Alternative:** Pre/post-process the markdown text with a regex to
extract-and-restore raw HTML blocks around the TipTap parse/serialize call
(same technique as `splitMarkdownEnvelope`'s frontmatter handling), instead
of a proper TipTap Node + markdown-it token hook.
**Rejected because:** regex-based block detection cannot reliably replicate
CommonMark's own html_block start/end rules (blank-line termination,
the 7 distinct opening conditions per the spec) — the exact class of bug
this iterate exists to fix. Piggybacking on markdown-it's OWN tokenizer
(which already implements those rules correctly, and is already a
transitive dependency doing the parsing) is both more correct and less
code than a bespoke second parser. It also gives the user visible feedback
in the editor (the chip) that the frontmatter approach can't, since
frontmatter is invisible to the editor entirely by design.

# Iterate: smartviewer-editor-md-roundtrip

Run-ID: iterate-2026-11-12-smartviewer-editor-md-roundtrip
Intent: bug (restores specified behavior, FR-01.35 "Rich editing, Markdown saved")

## Goal
The SmartViewer markdown editor (TipTap) must show every common Markdown element as an editable element and must not damage the document on save. Today a GFM table is DESTROYED on save (cells concatenated: `| A | B |` becomes `AB12`), an image `![alt](src)` is DROPPED, task lists `- [x]` are escaped to `\[x\]`, a 4-backtick fence around a 3-backtick fence is shortened (corrupting the block), and a fenced `mermaid` block is only a plain code box with no diagram.

## Probe (empirical, before the fix)
Round trip of a fixture through `buildEditorExtensions()` + `serializeEditorMarkdown()`:
- table -> cell text concatenated (DATA LOSS); task list -> `\[ \]`; image -> removed (DATA LOSS)
- ````md fence containing a ``` fence -> fence shortened (CORRUPT)
- footnote `text[^1]` + `[^1]: note` -> `text[^1](note)` (CORRUPT)
- bullet/ordered/nested lists, quote, link, hr, heading, emphasis, raw HTML block: stable (cosmetic normalisation only: setext -> ATX, `__b__` -> `**b**`, hard break `  ` -> `\`)

## Acceptance Criteria
- AC1: GFM tables render as a real table in the editor (header row, borders, cell editing) and serialize back to a GFM pipe table; column alignment (`:--`, `:-:`, `--:`) is preserved. Toolbar can insert a table and add/delete rows and columns, and delete the table.
- AC2: Task lists (`- [ ]` / `- [x]`) render with checkboxes, toggle, and serialize back unescaped.
- AC3: Images `![alt](src "title")` survive the round trip (rendered in the editor, serialized unchanged).
- AC4: A fenced code block always serializes with a fence longer than any backtick run inside it (no corruption of nested fences); the info string is preserved.
- AC5: A fenced `mermaid` block shows a live rendered diagram below its (still editable) code; the markdown (fence + code) round-trips unchanged, and an invalid diagram shows an error without affecting the document.
- AC6: Constructs the editor still cannot represent without loss (footnotes) are detected and the editor does not silently corrupt them: the warning names them and the pre-save diff shows the change (unchanged safety net); tables and task lists are no longer reported as lossy.
- AC7: A round-trip test suite covers every element (heading, paragraph, bold/italic/strike/code, bullet, ordered, nested, task list, table, link, image, quote, code, mermaid, hr, raw HTML block) and asserts: unchanged documents stay byte-identical except documented cosmetic normalisation, and the serializer is idempotent.

## Spec Impact
NONE (`restores-specified-behavior`); affected FR-01.35.

## Out of Scope
Markdown parity with GitHub in the read-only preview (already separate). Footnote editing. Reference-style link syntax preservation (resolved to inline links, equivalent). Collaborative editing.

## Design Notes
- tiptap-markdown 0.9 already serializes tables (GFM when each cell is single-paragraph, HTML otherwise), task items and images; the editor just never loaded the corresponding nodes. Add `@tiptap/extension-table`, `@tiptap/extension-list` (TaskList/TaskItem), `@tiptap/extension-image` at the exact pinned 3.32.0 family.
- Alignment: markdown-it emits `style="text-align:..."` on th/td; carry it in an `align` attribute and emit it in a replacement table serializer.
- Fence length: override codeBlock serializer (tiptap-markdown's writes a fixed 3 backticks).
- Mermaid: ReactNodeViewRenderer on codeBlock; for `language === "mermaid"` render the existing `MermaidRenderer` (debounced) beneath the editable code. Real mermaid already sets `securityLevel: "strict"` (meta-test pins it).

## Affected Boundaries
Markdown text <-> ProseMirror document (parse + serialize); file written back through `saveMarkdown` (If-Match). No server change.

## Confidence Calibration
- **Boundaries touched:** markdown parse/serialize round trip; mermaid render inside a node view.
- **Empirical probes run:** round-trip probe above (before) and the new suite (after); real-browser E2E editing a table.
- **Test Completeness Ledger:** see F5 (every AC tested).
- **Confidence-pattern check:** depth = idempotence on every element; breadth = all elements in one fixture.

## Verification (medium+)
Vitest round-trip suite, toolbar/node-view unit tests, Playwright spec `md-editor-elements.spec.ts` (@smoke, @FR-01.35) against the isolated stack.

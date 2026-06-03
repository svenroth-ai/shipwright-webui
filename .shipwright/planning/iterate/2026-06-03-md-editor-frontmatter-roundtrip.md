# Iterate: Markdown-editor pre-save diff shows the whole file changed (frontmatter round-trip corruption)

- **run_id:** iterate-2026-06-03-md-editor-frontmatter-roundtrip
- **Intent:** BUG (root cause found) → remediation is a behavior CHANGE to the round-trip
- **Complexity:** medium
- **Spec Impact:** MODIFY (existing markdown editor, FR-01.34 / FR-01.35)
- **Risk flags:** touches_io_boundary (markdown parse/serialize round-trip + file write surface)
- **adr:** iterate-2026-06-03-md-editor-frontmatter-roundtrip

## Symptom (user report)

User edited a single comma in the BODY of a markdown file (a content-creator
LinkedIn article with YAML frontmatter) in the SmartViewer markdown editor.
The pre-save diff (`MarkdownDiffView`) showed the **entire document** as
changed, not the one comma. User suspected the diff was rendering incorrectly.

## Root cause (empirically proven — headless `tiptap-markdown` probe)

`MarkdownDiffView` renders faithfully. The diff is computed as
`original (raw file bytes)` vs `edited (serializeEditorMarkdown(editor))` in
`MarkdownEditorModal.tsx`. The full document is re-serialized through the lossy
Markdown -> ProseMirror -> Markdown round-trip. Three independent sources
mangle the *unedited* parts of the file:

1. **YAML frontmatter destroyed (critical / data-loss).** The closing `---` of
   the frontmatter parses as a **setext H2 underline**, collapsing all
   `key: value` lines into a single `## ...` heading; the opening `---` becomes
   a thematic break; `[...]` arrays get backslash-escaped. On **Save** this is
   written to disk -> the frontmatter is permanently lost. This is the dominant
   red/green block in the screenshot AND a latent data-corruption bug,
   independent of the cosmetic complaint.
2. **Line-ending normalization (Windows).** The serializer always emits LF. On
   a CRLF file every line differs by an invisible carriage return -> the entire
   document shows as one delete-block + one add-block. Save would also silently
   rewrite every line ending in the file.
3. **Trailing-newline dropped.** `getMarkdown()` drops the file's final newline
   and a trailing blank line.

The user's real one-comma body edit round-trips cleanly; it is buried under the
three noise sources above.

## Fix (root cause, full scope — user-approved 2026-06-03)

Stop sending non-prose / non-editable structure through ProseMirror. The editor
owns ONLY the canonical prose body; everything it does not own is preserved
verbatim.

Introduce a pure, testable **envelope** model in `lib/markdownTiptap.ts`:

- `splitMarkdownEnvelope(text)` -> `{ frontmatter, prefix, core, suffix, eol }`
  - `frontmatter`: the leading fenced `---...---` block (or empty).
  - `prefix`: `frontmatter` + any leading blank lines before the first body
    content (preserved verbatim, original endings).
  - `core`: the prose body the editor will load + own (leading/trailing
    whitespace stripped).
  - `suffix`: trailing whitespace / trailing newline run of the original
    (preserved verbatim).
  - `eol`: `CRLF` if the original contains any carriage-return-newline, else
    `LF`.
- `composeMarkdownEnvelope(env, serializedCore)` -> recomposed markdown:
  `prefix` + `serializedCore` (line endings re-applied to `env.eol`) + `suffix`.

Modal wiring (`MarkdownEditorModal.tsx`):
- On load: split the file; `editor.setContent(env.core)`; stash `env`.
- On "Review changes" / serialize: `composeMarkdownEnvelope(env, getMarkdown())`.
- Diff + Save consume the recomposed string (Save-button no-op guard unchanged).

Messaging (`detectLossyConstructs`): frontmatter is no longer lossy (it is
preserved), so REMOVE the `frontmatter` rule from `LOSSY_RULES` and surface a
neutral note instead ("YAML frontmatter is preserved unchanged and is not
edited here"). Per the **Test-Update-Klausel**, update the affected unit test in
the same diff.

## Acceptance criteria

- **AC1** A frontmatter file whose body is already canonical markdown, opened
  and saved with NO edit, produces a diff of "No changes" (frontmatter, line
  endings, and trailing newline contribute zero diff).
- **AC2** Editing a single comma in the body yields exactly one changed line in
  the diff (+1 / -1).
- **AC3** The YAML frontmatter block is byte-identical before and after the
  round-trip (no setext-heading mangling, no `[...]` escaping). Save never
  corrupts frontmatter.
- **AC4** A CRLF file round-trips with CRLF preserved (output contains carriage
  returns; no all-lines-changed diff).
- **AC5** The original file's trailing-newline convention is preserved.
- **AC6** A file with NO frontmatter still round-trips (envelope degrades to
  prefix="", suffix=trailing whitespace) and trailing newline is preserved.
- **AC7** `detectLossyConstructs` no longer reports "YAML frontmatter" as lossy;
  the affected unit test is updated to the new contract.

## Confidence Calibration

- **Boundaries touched:** markdown parse/serialize round-trip
  (`tiptap-markdown` getMarkdown) + the file write surface (PUT save). This is a
  `touches_io_boundary` change.
- **Empirical probes run:**
  - Headless-editor round-trip on the exact screenshot file shape -> confirmed
    frontmatter collapses to `## ...` H2, opening `---` -> thematic break,
    `[...]` -> `\[...\]` (4 changed blocks on an unedited file).
  - Frontmatter-split probe -> 4 blocks down to 3; residual = dropped trailing
    newline + lost inter-block blank line (=> envelope must capture prefix/
    suffix whitespace, not just the fence).
  - CRLF whole-file probe -> serializer output has zero carriage returns; whole
    file diffs as 2 blocks (all lines changed).
- **Test Completeness Ledger:** see `shipwright_test_results.json`
  `iterate_latest.test_completeness` at F5; every AC -> a unit/boundary test.
- **Confidence-pattern check:** depth = byte-level round-trip equality asserted
  (not "looks right"); breadth = frontmatter + CRLF + trailing-newline + no-
  frontmatter + comma-edit + idempotence all covered.

# Architecture Brief: markdown-raw-html-passthrough

## The problem

Editing a project markdown file through the webui's rich-text editor
silently discards formatting information whenever the file contains a raw
HTML block (a line that opens with a block-level tag, e.g. a styled call-to-
action link). The information is not merely reformatted — attributes like
`style` are dropped with no error and no visible warning, so a file authored
elsewhere for a third-party renderer that honors that raw HTML comes back
corrupted the first time anyone touches it in this editor. It has already
happened once in production content.

## What already exists here

- A markdown↔TipTap round-trip with a non-blocking "lossy construct" warning
  banner for constructs the schema can't represent (tables, footnotes,
  frontmatter used to be one, raw HTML in general).
- A frontmatter/prefix/suffix "envelope" that keeps non-prose file regions
  out of the editor's parse/serialize round-trip entirely, preserving them
  byte-for-byte — the same shape of problem (a file region the rich editor
  must not reinterpret) solved for YAML frontmatter already.
- An existing, intentional carve-out where inline raw HTML that maps onto
  the schema (an `<a href>` tag inline in a paragraph) is parsed into the
  schema and re-serialized as its Markdown equivalent, added for a prior
  "Built with Shipwright" attribution-link bug.

## What would newly, permanently exist

A new TipTap node extension that intercepts markdown-it's `html_block`
token during parse and represents it as an opaque, atomic editor node
holding the original markup as a string attribute, with its own NodeView
(read-only preview) and its own markdown serializer that writes that string
back verbatim. It becomes a permanent part of the editor's extension set
(`buildEditorExtensions()`) that every future change to the markdown editor
must be aware of, the same way the frontmatter envelope already is.

## Options on the table

- **A:** A dedicated TipTap node that intercepts markdown-it's `html_block`
  token and holds the raw block string as an opaque, non-editable node,
  serialized back byte-for-byte.
- **B:** Pre/post-process the file text with a regex to extract raw-HTML
  block regions before handing the body to TipTap and splice them back
  after serialization (same technique already used for YAML frontmatter).
- **C:** Do nothing structural — instead, make the existing warn banner
  block the Save action when raw HTML is present, forcing the user to
  either accept the lossy rewrite or edit the file outside the app.

## Constraints that are not negotiable

- The file's on-disk frontmatter/line-ending/trailing-newline handling
  (`splitMarkdownEnvelope`) must not change — unrelated boundary, already
  correct.
- The pre-existing inline `<a href>` → Markdown-link round-trip (fixing a
  prior "Built with Shipwright" bug) must not regress.

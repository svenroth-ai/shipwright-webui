# Mini-plan: smartviewer-editor-md-roundtrip

1. **Deps** (`client/package.json`): exact-pin `@tiptap/extension-table`, `@tiptap/extension-list`, `@tiptap/extension-image` at 3.32.0.
2. **Nodes** (new `client/src/lib/markdownEditorNodes.ts`): Table/Row/Header/Cell with `align`, GFM serializer with alignment row; TaskList/TaskItem(nested); Image (no base64); CodeBlock with safe fence length + mermaid node view hook. `buildEditorExtensions()` loads them.
3. **Mermaid view** (new `MermaidCodeBlockView.tsx`): node view = editable code + debounced `MermaidRenderer` for `language === "mermaid"`.
4. **Toolbar** (`MarkdownEditorToolbar.tsx` + new `MarkdownEditorTableBar.tsx`): task-list + table-insert buttons; contextual table bar (add/delete row/column, delete table).
5. **Styles** (`client/src/styles/`): editor table borders/header, task-list checkbox layout, mermaid preview frame (CSS vars, theme-safe).
6. **Lossy detection** (`markdownTiptap.ts`): drop table + task-list rules (now represented); keep footnotes; ref-links stay.
7. **Tests:** round-trip suite per element (idempotence + documented normalisation), serializer unit tests (fence length, alignment), toolbar tests, node-view test, Playwright `md-editor-elements.spec.ts` editing a table and a mermaid block through the real modal.

**Alternative rejected:** switching the editor to a source (CodeMirror) mode — loses the "Rich editing" promise (FR-01.34) and the user asked for rendered elements. **Alternative rejected:** a third-party table markdown plugin — tiptap-markdown already ships the serializer; only alignment needs a small replacement.

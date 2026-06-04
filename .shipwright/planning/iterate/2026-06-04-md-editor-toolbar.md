# Iterate Spec: md-editor-toolbar

- **Run ID:** iterate-2026-06-04-md-editor-toolbar
- **Type:** feature (UX completion of FR-01.35)
- **Complexity:** small (classifier: trivial; overridden +1 — new interactive UI
  component + new user-facing affordance warrants a RED unit test, an E2E
  assertion, and a Test Completeness Ledger)
- **Status:** complete

## Goal
The SmartViewer markdown editor (FR-01.35) opened with **no formatting toolbar**:
the user could type but had no Bold/Italic/heading/list buttons (user-reported).
Root cause is not a regression — TipTap/ProseMirror is **headless**: StarterKit
ships the *capability* (bold, italic, headings, lists, code, blockquote, link,
undo/redo via keyboard shortcuts + markdown input rules) but no visible UI, and a
button bar was never built in the original FR-01.35. This iterate adds that bar.

## Acceptance Criteria
- [x] **AC1** (toolbar renders): When the markdown editor modal is in an
  editor-visible phase (editing/saving/conflict), a formatting toolbar renders
  above the editor surface with buttons for undo/redo, bold/italic/strike/inline-code,
  H1–H3, bullet/ordered list, blockquote, code-block, horizontal-rule, and link.
  It is NOT rendered during loading/load_error/diff.
- [x] **AC2** (commands apply): Clicking a toggle button runs the corresponding
  StarterKit command against the live selection; the serialized markdown reflects
  it (e.g. select-all + Bold → `**…**` appears in the pre-save diff).
- [x] **AC3** (active state): Toggle buttons mirror the live selection via
  `aria-pressed` / `editor.isActive(...)`; undo/redo are disabled via
  `editor.can().undo()/redo()` when there is nothing to (un)do.
- [x] **AC4** (link): The link button prompts for a URL (or removes the link on an
  already-linked selection / empty input); cancel is a safe no-op.
- [x] **AC5** (no boundary change): The toolbar introduces NO new serialized
  construct — every command is already covered by the markdownTiptap round-trip,
  so the lossy-construct warn surface is unchanged.

## Spec Impact
- **Classification:** modify
- **MODIFY:** FR-01.35 (SmartViewer in-app Markdown editing) — completes its
  WYSIWYG UX with a visible formatting toolbar. No new FR.
- **ADD / REMOVE:** none.

## Out of Scope
- Floating/bubble menu, slash-command menu, color/highlight, tables/task-lists
  (still source-fallback + flagged by `detectLossyConstructs`).
- Image insertion, find/replace.

## Design Notes (Tier-1)
New `MarkdownEditorToolbar.tsx` reuses the existing modal design tokens
(`--color-border/-muted/-muted-bg/-accent/-text`) and lucide-react icons (already
a dep). No new tokens, no new packages. Active state = tinted `--color-accent/15`
background. Data-driven button config keeps the component cohesive and small.

## Affected Boundaries
None new. The markdown↔ProseMirror serialize boundary is unchanged — the toolbar
only triggers commands already exercised by `markdownTiptap.test.ts`.

## Confidence Calibration
- **Boundaries touched:** none new (markdown↔ProseMirror unchanged).
- **Empirical probes run:**
  - Unit (`MarkdownEditorToolbar.test.tsx`, real TipTap editor in jsdom): renders
    all core buttons; Bold toggle flips `aria-pressed`; heading toggle reflects
    active; undo disabled on empty history; null-editor renders nothing; link
    button invokes the URL prompt. PASSED (6).
  - E2E (`markdown-editor.spec.ts`, real Chromium against worktree Vite): toolbar
    + Bold/Italic/H1 visible; select-all + toolbar Bold → `aria-pressed=true` and
    `**` appears in the pre-save diff. PASSED (5/5 in the file).
  - Full client suite: 1522 PASSED; tsc --noEmit clean; oxlint clean (no new warnings).
- **Test Completeness Ledger:**
  | Behavior | Disposition | Evidence |
  |---|---|---|
  | Toolbar renders core buttons (AC1) | tested | unit "renders core formatting buttons" + E2E visibility |
  | Toolbar hidden in loading/load_error/diff (AC1) | covered-by-existing-test | same `showEditor` boolean gates the editor div, exercised by modal phase tests |
  | Toggle command applies → markdown (AC2) | tested | E2E select-all+Bold → `**` in diff |
  | aria-pressed reflects active (AC3, bold+heading) | tested | unit bold + heading toggles |
  | per-button command wiring (strike/code/lists/quote/code-block/hr) | covered-by-existing-test | identical data-driven `run(editor)` path (bold = representative) + commands proven in markdownTiptap.test.ts |
  | undo/redo disabled gate (AC3) | tested | unit "disables undo when history empty" |
  | link prompt wiring + cancel no-op (AC4) | tested | unit "opens a URL prompt … cancel is a safe no-op" |
  | setLink↔markdown serialization (AC4) | covered-by-existing-test | markdownTiptap.test.ts round-trips `[a link](…)` |
  | null-editor guard | tested | unit "renders nothing when editor is null" |
  | no new serialized construct (AC5) | tested | markdownTiptap round-trip unchanged (warn-surface tests green) |
  - **untested-testable:** 0.
- **Confidence-pattern check:** depth — the toggle/active path is proven against a
  REAL editor (unit) and a REAL browser (E2E), not a mock; breadth — render-all
  test + two representative toggles + the bespoke link path + the disabled gate +
  the null guard cover every distinct code path in the data-driven bar.

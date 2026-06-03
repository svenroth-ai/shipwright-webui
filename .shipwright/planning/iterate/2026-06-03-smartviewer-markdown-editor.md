# Iterate Spec: smartviewer-markdown-editor

- **Run ID:** iterate-2026-06-03-smartviewer-markdown-editor
- **Type:** feature
- **Complexity:** medium (classifier: small; overridden — first file-write surface in a
  read-only app + new dep tree + save-vs-Claude race + lossy MD↔ProseMirror roundtrip)
- **Status:** draft

## Goal
Add an "Edit" button to the SmartViewer markdown pane that opens a TipTap (ProseMirror)
rich-text editor in a modal. The user edits WYSIWYG; the document is serialized back to
Markdown and written to disk through a new path-guarded, optimistic-concurrency write
endpoint. Phase 1 = SmartViewer markdown pane only.

## Acceptance Criteria
- [ ] **AC1** (button gating): Given a `.md`/`.markdown` file is selected, when the SmartViewer
  markdown pane renders, an "Edit" button appears in the toolbar next to "Pop out". For
  `code`/`text`/`image`/`mermaid`/`unknown` kinds NO Edit button renders.
- [ ] **AC2** (load → rich): Given the Edit button is clicked, the modal opens a TipTap editor
  pre-populated from the file's CURRENT on-disk content; StarterKit constructs round-trip
  (heading, bold, italic, bullet/ordered list, code block, inline code, blockquote, link,
  thematic break) — i.e. `markdownToEditor` then `editorToMarkdown` on an unedited
  StarterKit-only document is semantically stable.
- [ ] **AC3** (lossy warn banner): Given the source contains YAML frontmatter, raw-HTML
  (e.g. `<a id="trg-…">`), or footnotes, when the editor opens a NON-blocking warning banner
  is shown. Given none of those, NO banner is shown.
- [ ] **AC4** (pre-save diff gate): Given edits exist, when the user clicks "Review changes",
  a unified line-diff (original markdown vs. serialized markdown) is shown; the write only
  fires after an explicit "Save" confirmation in the diff view. Cancel performs no write.
- [ ] **AC5** (save → refresh): Given a confirmed save and a fresh fingerprint, when PUT
  succeeds the file is updated atomically (tmp + rename), the modal closes, and the
  SmartViewer preview re-fetches and shows the new content.
- [ ] **AC6** (conflict → block): Given the on-disk fingerprint changed since the editor
  loaded the file, when the user saves the server returns **409** and the modal shows a
  "file changed externally" banner with a "Reload & re-edit" action; NO write occurs.
- [ ] **AC7** (server guards): The PUT endpoint rejects with no write on: non-`.md`/`.markdown`
  extension → **415**; traversal/absolute/null-byte/symlink-escape → **400**; body over the
  size cap (Content-Length precheck AND post-read) → **413**; missing project → **404**;
  missing target file → **404**.

## Spec Impact
- **Classification:** add
- **ADD** (new FR appended): **FR-01.34 — SmartViewer in-app Markdown editing** (rich editor
  modal + path-guarded optimistic-concurrency write endpoint). Append FR row + AC block to
  `.shipwright/planning/01-adopted/spec.md` at F1; carry FR-01.34 into F7 `--new-frs`.
- **MODIFY:** none
- **REMOVE:** none
- **NONE justification:** n/a

## Out of Scope
- FolderTree right-click "Edit" context menu (Phase 2).
- GFM tables, task-lists, inline image embedding in the editor (source-fallback only).
- Creating NEW files / renaming (editor only edits an existing selected `.md`).
- Editing non-markdown file types.
- Mid-session live sync; the SmartViewer preview refreshes only on a successful save.

## Design Notes (Tier-2)
Reuses the Radix-Dialog chrome + design tokens already established by `SmartViewerModal`
(`--color-surface`, `--color-border`, `--radius-card`, `--shadow-modal`, `--color-muted`,
`--color-text`, `--color-accent`). No new design tokens. Edit button mirrors the existing
"Pop out" button styling in `MarkdownRenderer` (`--color-surface` bg + `--color-border` + muted text).

Component tree (states shown in []):
```
MarkdownRenderer (existing)
├── toolbar (absolute top-right)
│   ├── EditButton          ← NEW (only when kind==="markdown"); opens modal
│   └── PopOutButton (existing)
└── MarkdownEditorModal (NEW, lazy)        [loading | load_error | ready | diff | conflict | saving]
    ├── Dialog.Overlay (dimmed backdrop — same as SmartViewerModal)
    └── Dialog.Content (centered, 90vh × min(1100px,92vw))
        ├── Header: FileText icon + mono path (Dialog.Title) + Close(X)
        ├── WarnBanner  ← NEW, conditional (frontmatter / raw-HTML / footnotes / table / task-list)
        ├── Body (min-h-0 flex-1 overflow-auto)
        │   ├── [ready]      EditorContent (TipTap; prose styling = .markdown-body)
        │   ├── [loading]    "Loading…" centered
        │   ├── [load_error] AlertCircle + message + Close
        │   ├── [diff]       MarkdownDiffView (escaped plain-text unified diff)
        │   └── [conflict]   AlertCircle banner "File changed on disk" + edits PRESERVED behind it
        └── Footer
            ├── [ready] Cancel | "Review changes →"
            ├── [diff]  "← Back to editor" | Save
            └── [conflict] Cancel | "Reload & discard my changes"
```

Prop shapes:
- `MarkdownRenderer` gains `projectId: string`, `path: string`, `onSaved?: () => void` (forwards
  from `SmartViewer` `TextFileViewer`).
- `MarkdownEditorModal`: `{ open: boolean; onOpenChange: (b:boolean)=>void; projectId: string;
  path: string; onSaved: () => void }`. Self-loads via `loadMarkdownForEdit` on open.
- `MarkdownDiffView`: `{ original: string; edited: string }` → renders `diffLines` chunks.

Deviations from guidelines: none. Editor body adopts the existing `.markdown-body` prose CSS so
the rich view matches the read-only preview typography.

## Affected Boundaries
This iterate introduces TWO serialized-format boundaries:

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `lib/markdownTiptap.ts::editorToMarkdown` | `lib/markdownTiptap.ts::markdownToEditor` + the on-disk `.md` (git / Claude) | Markdown ↔ ProseMirror doc |
| server GET `/file` `ETag` header (quoted strong `"sha256:<hex>"` content hash) | server PUT `/file` `If-Match` header | fingerprint string (content hash — review #2) |

`touches_io_boundary` was NOT auto-flagged (no `.env`/config-json/keyword match), but the
markdown round-trip is a genuine round-trip boundary → round-trip probes are run regardless
(Boundary Probe sub-step in Build).

## Confidence Calibration
{Populated before F0. Empirical probes — real round-trip / edge-case tests, not "re-read the diff".}

- **Boundaries touched:** markdown↔ProseMirror serialize (markdownTiptap); file fingerprint
  (GET ETag → PUT If-Match, content hash).
- **Empirical probes run:**
  - *TipTap-in-jsdom spike (the key risk):* mounted a headless `new Editor()` with StarterKit +
    tiptap-markdown and serialized back → **works**; `serialize∘parse` is a fixed point
    (idempotent) for StarterKit prose. `markdownTiptap.test.ts` (10) PASSED.
  - *Concurrency probe:* stale `If-Match` → 409 (no write); matching → 200; the returned
    fingerprint equals the next GET `ETag`; no `.md-write.tmp` residue. `file-write-route.test.ts` PASSED.
  - *Byte-accuracy probe:* a 1,000,000× `€` body (~3 MB) → 413, original untouched. PASSED.
  - *Edge inputs:* empty / single-newline / whitespace-only round-trips don't crash + are stable. PASSED.
  - *Diff XSS probe:* `<script>` in the edited text renders as escaped text, no live `<script>`
    element. `MarkdownDiffView.test.tsx` PASSED.
- **Test Completeness Ledger:**

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | AC1 Edit button gating (md-only + onSaved) | tested | `MarkdownRenderer.test.tsx` "Edit button (FR-01.34 AC1)" ×3 PASSED |
  | 2 | AC2 StarterKit round-trip stability | tested | `markdownTiptap.test.ts` round-trip + idempotent PASSED |
  | 3 | AC3 lossy-construct detection + warn banner | tested | `markdownTiptap.test.ts` detect ×6 + `MarkdownEditorModal.test.tsx` warn PASSED |
  | 4 | AC4 pre-save diff gate | tested | `MarkdownEditorModal.test.tsx` Review→diff→Save + `MarkdownDiffView.test.tsx` PASSED |
  | 5 | AC5 save → atomic write (server) + onSaved/close (client) | tested | `file-write-route.test.ts` atomic-write + `MarkdownEditorModal.test.tsx` onSaved+close PASSED |
  | 5b | AC5 preview re-fetch after save (SmartViewer reloadNonce) | tested | E2E `markdown-editor.spec.ts` (asserts preview shows new content post-save) |
  | 6 | AC6 409 conflict block + keep-edits | tested | `file-write-route.test.ts` 409 + `MarkdownEditorModal.test.tsx` conflict-banner + `markdownFileApi.test.ts` MarkdownConflictError PASSED |
  | 7 | AC7 server guards 415/400/413/404/not_a_file/missing-If-Match | tested | `file-write-route.test.ts` ×8 PASSED |

  0 testable-but-untested rows.

- **Confidence-pattern check:** *Asymptote (depth):* the one "are you confident TipTap serializes
  in jsdom?" question was answered by a real spike test (not a vibe) — passed, and the idempotency
  assertion is the falsifiable follow-up. *Coverage (breadth):* every AC has a `tested` row; the
  only behavior not covered by a Node unit test (AC5b — the SmartViewer `reloadNonce` → preview
  re-fetch) is covered by the F0.5 E2E run against the live stack.

## Verification (medium+)
- **Surface:** web
- **Runner command:** `shared/scripts/surface_verification.py` driving Playwright against the
  live dev stack (BASE_URL pinned 127.0.0.1) — exercises Edit button → modal → edit → diff →
  save → preview refresh (AC1, AC2, AC4, AC5) and the 409 conflict path (AC6).
- **Evidence path:** `.shipwright/runs/iterate-2026-06-03-smartviewer-markdown-editor/`
- **Justification (only if surface=none):** n/a — startable web surface exists.

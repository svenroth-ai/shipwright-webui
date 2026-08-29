# Mini-Plan: Clickable file references in Triage detail (compliance-first)

run_id: iterate-2026-08-29-compliance-file-viewer

## 1. Files to create/modify

- **New** `client/src/lib/extractFileMentions.ts` — pure function that scans a
  string (title/detail) for file-path-like tokens (`[\w./-]+\.(ts|tsx|js|jsx|py|md|json|yaml|yml)`
  style, plus bare known filenames like `CLAUDE.md`, `architecture.md`) and
  returns ordered `{start, end, path}` spans for text-splitting. No I/O, no
  path-guard call here — just text recognition.
- **New** `client/src/components/triage/FileLink.tsx` — small clickable
  file-path atom (monospace text + file icon), calls `onOpen(path)`. Used both
  for a single known path (`evidencePath`) and each mention found in free text.
- **New** `client/src/components/triage/FileMentionText.tsx` — renders a text
  blob as plain text interleaved with `<FileLink>` for each detected mention
  (uses `extractFileMentions`). Used for the `detail` body.
- **New** `client/src/components/triage/TriageFilePanel.tsx` — the right-side
  panel: header (path + close ×) + `<SmartViewer projectId path popOut={false} />`
  body. Plain bordered flex column, not its own Dialog/overlay (nests inside
  the Triage modal's existing Dialog.Content/overlay).
- **Edit** `client/src/components/triage/TriageDetailModal.tsx` — replace the
  inert `evidencePath` `<dd>` and the plain `detail` `<p>` with
  `<FileLink>`/`<FileMentionText>`; add `openFilePath` state (reset on
  item/open change, folded into the existing reset `useEffect`); widen
  `Dialog.Content` and split it into a fixed-width left column (existing
  content) + conditional `<TriageFilePanel>` right column. Net line delta
  must not increase the file's current count (375, already over the
  300-line/grandfathered ceiling) — the extraction above removes at least as
  many lines as the wiring adds.

## 3. Component hierarchy

```
TriageDetailModal (Dialog.Content, now flex-row, widens when a file is open)
├─ left column (existing width, scrollable) — unchanged controls
│   ├─ evidence row  → <FileLink path={evidencePath} onOpen={setOpenFilePath}/>
│   └─ detail body   → <FileMentionText text={detail} onOpen={setOpenFilePath}/>
└─ right column (only when openFilePath is set)
    └─ <TriageFilePanel projectId path={openFilePath} onClose={() => setOpenFilePath(null)}>
        └─ <SmartViewer projectId path popOut={false}/>   (existing, reused as-is)
```

## 4. Data model changes

None. Read-only reuse of the existing `GET /api/external/projects/:id/tree`
and `GET /api/external/projects/:id/file` routes (already `path-guard`'d per
CLAUDE.md rule 10). `TriageItem.evidencePath` is an existing field; no schema
change to `.shipwright/triage.jsonl`.

## 5. Test strategy

- Unit: `extractFileMentions.test.ts` — recognizes real extensions, ignores
  false positives (e.g. version strings, URLs), dedupes overlapping matches,
  handles text with no mentions.
- Unit/component: `FileMentionText` renders one clickable link per detected
  mention and plain text otherwise; `FileLink` calls `onOpen` with the exact
  path.
- Component: `TriageDetailModal` — clicking an evidence path or a detected
  in-text mention opens `TriageFilePanel` beside (not over) the existing
  content; closing the panel returns to the single-column layout; panel state
  resets when the modal is closed or a different triage item is opened.
- No E2E required at this tier for a non-`touches_io_boundary`, non-auth UI
  feature reusing an already-covered file-read API (small tier: `if feature+UI`
  in the matrix is triggered — will author + run a minimal Playwright check
  that a compliance triage item's detail-path click opens the panel with file
  content visible).

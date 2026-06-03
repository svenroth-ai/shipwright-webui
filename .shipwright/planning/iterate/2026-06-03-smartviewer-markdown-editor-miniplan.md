# Mini-Plan: smartviewer-markdown-editor

- **Run ID:** iterate-2026-06-03-smartviewer-markdown-editor
- **Complexity:** medium · **Risk:** touches_public_api (new endpoint), touches_build (deps)

## Approach (chosen)

Rich WYSIWYG editing via **TipTap v2 + StarterKit + `tiptap-markdown`**, opened in a Radix
dialog that mirrors `SmartViewerModal`. The editor loads the file FRESH on open (capturing
the on-disk fingerprint), serializes to Markdown on save, shows a mandatory pre-save line-diff,
and writes through a NEW path-guarded optimistic-concurrency endpoint.

### Library choice — TipTap roundtrip
- **Chosen:** `@tiptap/react` + `@tiptap/starter-kit` + `@tiptap/pm` + `tiptap-markdown`
  (+ `@tiptap/extension-link`). Markdown in via `content`, out via
  `editor.storage.markdown.getMarkdown()`. Smallest glue for the StarterKit-only node set;
  the **pre-save diff + warn banner are the safety nets** for imperfect serialization.
- **Alternative considered:** `prosemirror-markdown` (official) with a hand-written TipTap↔PM
  schema bridge, or a fully custom TipTap-JSON→markdown serializer. Rejected for Phase 1:
  significantly more glue code + test surface for no fidelity win at StarterKit scope
  (Simplicity First). Revisit if Phase 2 adds tables/task-lists where serializer control matters.
- **Versions pinned after `npm install` resolves them**; verify `tiptap-markdown` peer-compat
  with the installed `@tiptap` major (pin TipTap v2.x — `tiptap-markdown` targets v2). Caret
  ranges are OK here (client-only, no client/server addon pairing like xterm).
- **Bundle:** `MarkdownEditorModal` is **lazy-loaded** (`React.lazy` + Suspense, like
  `MermaidRenderer`) so TipTap/ProseMirror is code-split out of the initial bundle → keeps the
  `touches_build` bundle gate green.
- **Diff:** `diff` (jsdiff) `diffLines` for the pre-save unified diff (tiny, deterministic).

## Server (TDD)

**New** `server/src/external/file/write.ts` — `registerMarkdownWrite(app, { getProjectById })`,
called inside `createFileRouter`. `PUT /api/external/projects/:projectId/file?path=<rel>`:

Validation order (mirrors `actions/upload.ts`):
1. project resolvable + has `path` → 404 / 400
2. `path` query present → 400 `path_required`
3. `pathGuard(project.path, rel)` → 400 (`path_traversal` / `absolute_input` / `drive_change`)
4. extension ∈ {`.md`,`.markdown`} → **415** `not_markdown` (before touching fs)
5. `Content-Length` precheck > `MARKDOWN_WRITE_MAX_BYTES` (2 MiB) → **413**
6. read body (`c.req.text()`); **`Buffer.byteLength(body,'utf8')`** > cap → **413** (NOT
   string length — multi-byte chars; review #5)
7. `stat` target: ENOENT → **404** `not_found`; not a file → 400 `not_a_file`
8. `realPathGuard(project.path, absolute)` → 400 `path_traversal` (symlink escape)
9. fingerprint = **content hash** `sha256:<hex>` of the current on-disk bytes (review #2 —
   `mtime:size` is weak + Windows NTFS mtime is coarse); `If-Match` header missing → 400
   `precondition_required`; normalize (strip quotes) then compare; mismatch → **409**
   `fingerprint_mismatch` (+ `currentFingerprint`)
10. atomic write: `writeFileSync(tmp)` + `renameSync(tmp, file)`, tmp in the **same dir** as the
    target with `pid+timestamp` suffix (review #3 — cross-device rename + collision), cleanup on failure
11. re-hash new bytes → return `{ written: true, fingerprint, size }`

**Edit** `server/src/external/file/routes.ts` GET handler: add a quoted strong
`ETag: "sha256:<hex>"` header computed from the bytes it already reads (review #1; client
strips quotes). Route ignores conditional `If-None-Match` — ETag is for editor concurrency,
NOT cache validation (documented in a comment; review #13). Add `fileFingerprint(buffer)`
helper to `file/_helpers.ts` (single SSoT used by BOTH GET and PUT) + `MARKDOWN_WRITE_MAX_BYTES`.
Forbidden-path rules are enforced FOR FREE: run-config isn't `.md`; `~/.claude` JSONL is outside
project-root (path-guard). **Authz (review #6):** this app has no per-request auth by design —
it is loopback-bound + project-scoped (`getProjectById`) + path-guarded, the same posture as the
existing GET `/file` and the WS loopback-Origin gate. PUT inherits identically; documented in the ADR.

Tests: `file/write.test.ts` (415/400/413/404/409/200/missing-If-Match) + extend
`file-route.test.ts` for the ETag header.

## Client (TDD)

- **New** `lib/markdownFileApi.ts` (imports `EXTERNAL_API` — `externalApi.ts` is at its bloat
  ceiling): `loadMarkdownForEdit(projectId,path) → {text,fingerprint}` (GET, reads ETag);
  `saveMarkdown(projectId,path,text,fingerprint) → {fingerprint}` (PUT + `If-Match`);
  `MarkdownConflictError` (thrown on 409).
- **New** `lib/markdownTiptap.ts`: TipTap extension config (StarterKit + Markdown + Link with
  **restricted protocols** http/https/mailto/relative — review #12; preview already sanitizes via
  rehype-sanitize). `detectLossyConstructs(text): string[]` — **broadened** (review #9) beyond
  frontmatter / raw-HTML / footnotes to also flag GFM tables, task-lists (`[ ]`/`[x]`),
  reference-style links/images, and HTML comments (all lossy at StarterKit scope).
- **New** `SmartViewer/MarkdownEditorModal.tsx`: Radix dialog (mirror `SmartViewerModal`).
  Fresh-loads on open with explicit **loading / load-error / ready** states (review #4 — file
  may be deleted/renamed/unreadable between viewer render and editor open; non-crashing error +
  close); warn banner (AC3); editor body; footer Cancel / "Review changes" → diff view → Save
  (AC4); **409 → conflict banner that KEEPS the user's in-memory edits**, with an explicitly
  labelled "Reload & discard my changes" action (review #11); on success → `onSaved()` + close (AC5).
- **New** `SmartViewer/MarkdownDiffView.tsx`: renders `diffLines` output as **escaped plain text**
  (React default escaping, NO `dangerouslySetInnerHTML` — review #7); keeps the modal < 300 LOC.
- **Edit** `SmartViewer/MarkdownRenderer.tsx`: add "Edit" button next to "Pop out"; OWN the
  lazy modal + open-state here (66 LOC, room to grow). New props: `projectId`, `path`, `onSaved`.
- **Edit** `SmartViewer.tsx` (283/300 LOC — tight): `TextFileViewer` adds a `reloadNonce` state
  (bumped by `onSaved`, added to the fetch `useEffect` deps) + passes `projectId`/`path`/`onSaved`
  to `MarkdownRenderer`. Budget ~+8 LOC. **Contingency:** if it would breach 300, extract
  `TextFileViewer` verbatim into `SmartViewer/TextFileViewer.tsx` FIRST (cohesive-unit split,
  per the bloat-retirement rule), then add.

Tests: `markdownTiptap.test.ts` (round-trip stability + detection), `markdownFileApi.test.ts`
(msw: ETag parse, If-Match send, 409→error), `MarkdownEditorModal.test.tsx` (banner/diff/conflict
branches — mock `useEditor` if TipTap won't mount in jsdom), `MarkdownRenderer` Edit-button test.

## Doc-sync + E2E
- Add tokens `MarkdownEditorModal`, `markdownTiptap`, `markdownFileApi` to `doc-sync.test.ts`
  REQUIRED_TOKENS **and** reference them in `architecture.md` / `component_inventory.md` (same commit).
- E2E (F0.5, surface=web): three-pane → select `.md` → Edit → type → Review → Save → preview
  refreshes. 409 path covered by unit (E2E race is flaky).

## Key risks
1. **TipTap in jsdom** — ProseMirror may not mount cleanly; round-trip then covered by E2E +
   a headless `new Editor()` probe (Step 7.5). If unit-mount fails, modal test mocks `useEditor`.
2. **Roundtrip fidelity** — mitigated by mandatory pre-save diff + warn banner; not a silent write.
3. **SmartViewer.tsx LOC ceiling** — contingency extract `TextFileViewer` if +LOC breaches 300.
4. **Bundle weight** — mitigated by lazy-loading the modal.

## External review integration (Branch A · openrouter · 14 findings)
Marker written to `.shipwright/planning/iterate/{run_id}-review-state.json` (status=completed).
Decisions (logged to the iterate ADR at F3):

- **#2 HIGH fingerprint → content hash** (`sha256:<hex>`), single `fileFingerprint(buffer)` SSoT
  for GET + PUT. Robust to Windows coarse mtime. *(integrated above)*
- **#6 HIGH authz → documented inheritance** of the app's loopback + project-scope + path-guard
  model; no bespoke request auth (matches existing GET `/file`). *(integrated above)*
- **#8 tiptap-markdown init → SPIKE FIRST.** Build step 0 = a RED round-trip test
  (`markdownToEditor`→`editorToMarkdown` on a StarterKit fixture) that PROVES the exact init/parse
  wiring before any UI is built. If the headless Editor won't run in jsdom, capture round-trip in
  E2E + keep the lib module's serialize path covered by a node-hosted Editor probe.
- **Accepted & integrated above:** #1 quoted strong ETag (+ client strip), #3 same-dir tmp,
  #4 modal load-error state, #5 `Buffer.byteLength`, #7 escaped plain-text diff, #9 broadened
  lossy detection, #11 keep-edits-on-409, #12 Link protocol restriction, #13 ETag-not-cache comment.
- **#10 stale preview fetch** — already handled by `TextFileViewer`'s existing `cancelled` guard;
  confirm with a test. **#14 empty/whitespace/unsupported-only** — added as round-trip probes.
- **Added tests from review:** non-ASCII body near size cap (413 byte-accuracy); markdown
  containing `<script>`/HTML in the diff (safe escaped render); empty / single-newline /
  unsupported-only round-trips; `javascript:` link scheme rejected by the editor's Link config.

## Code review (Step 8 · external `--mode code` · openrouter · 9 findings)
Cold-read over the full diff AFTER build. Dispositions:

- **#2 HIGH "setContent uses HTML parsing, not markdown" → EMPIRICALLY FALSIFIED.** Wrote a
  probe: `editor.commands.setContent(<markdown>)` → serialize → full rich structure survives
  (tiptap-markdown patches setContent). Added a permanent test (`markdownTiptap.test.ts` "the
  modal's actual load path"). The spike had only covered init-content — this closes the gap (#9).
- **#1 HIGH "refresh only when popOut" → NOT A BUG (caller topology).** The only real `<SmartViewer>`
  callers are `TaskDetailPage` + `PreviewPage` (both default `popOut=true` → Edit + refresh work);
  the sole `popOut=false` instance is the nested pop-out modal, where suppressing Edit is the
  intended "no modal-in-modal" design. Documented in the `onSaved` prop doc.
- **#7 MEDIUM TOCTOU (stat→read) → FIXED.** `readFileSync` catch now maps ENOENT → 404 (not 500).
- **#5 MEDIUM no load cancellation → FIXED.** `loadGen` monotonic token discards superseded/stale
  loads; effect cleanup bumps it. Also **#3** addressed: load now gated on `open && editor`.
- **#4 MEDIUM "Review/Save with no edits" → FIXED.** Save disabled when the serialized doc is
  byte-identical to the on-disk original (true no-op); normalization-only changes still save (the
  diff shows them).
- **#8/#9 MEDIUM test gaps → FIXED.** setContent-path test added; modal save test now asserts the
  saved body equals the serialized loaded content (not "some string").
- **#6 MEDIUM "body buffered before cap if Content-Length lied" → ACCEPTED (documented).** Matches
  the existing `actions/upload.ts` posture (Content-Length precheck + `c.req.text()` + post-read
  byte cap); Hono has no streaming-cap primitive here. Bounded: loopback single-user. Note in ADR.

# Iterate — change: SmartViewer markdown rendering + UX

- **Run ID:** iterate-2026-05-30-smartviewer-render-ux
- **Intent:** CHANGE · **Complexity:** medium
- **Spec Impact:** MODIFY (FR-01.02 SmartViewer file preview)
- **Branch:** iterate/smartviewer-render-ux

## Context

The SmartViewer renders project markdown files (architecture.md, session_handoff.md,
traceability-matrix.md, triage_inbox.md, …) through the SAME XSS-safe `MarkdownText`
renderer the transcript uses (react-markdown, NO rehype-raw). For real project docs
that breaks four things (UAT 4/6/7/8) and the pane lacks pop-out + a page-level
horizontal scrollbar (UAT 5):

- (4) HTML comments `<!-- … -->` render as visible literal text.
- (6) YAML frontmatter (`---\n…\n---`) renders as raw body text.
- (7) Inline HTML anchors `<a id="trg-…"></a>` render as visible literal text.
- (8) Internal anchor links (e.g. `FR-01.01` in the RTM → `#…`) don't scroll to the
  target within the pane.
- (5) No "open in new window"; only wide tables scroll, not the whole document.

## Design

These document features need a controlled subset of HTML — which the transcript
renderer MUST NOT gain (DO-NOT guards #4/#5: no raw HTML in the transcript). So a
SEPARATE document renderer (`SmartViewer/DocumentMarkdown.tsx`) is introduced for
**file preview only** (project files = the user's own, trusted content); the
transcript keeps `MarkdownText` byte-for-byte.

DocumentMarkdown pipeline: `remark-gfm` + `rehype-raw` → `rehype-sanitize` (custom
schema: allow `id` + `className` everywhere, `href` incl. `#fragment`; everything
dangerous stripped) → `rehype-slug` → `rehype-highlight`. Frontmatter is converted
to a fenced ` ```yaml ` block by a leading-`---…---` string preprocess (dep-free).

## Acceptance Criteria

1. **AC4 — comments hidden.** A markdown file containing `<!-- x -->` renders with no
   visible `<!--` text.
2. **AC6 — frontmatter as a metadata block.** Leading `---\n…\n---` renders as a
   highlighted YAML code block (recognised as frontmatter), not raw body text.
3. **AC7 — inline anchors.** `<a id="trg-x"></a>` renders as a real (invisible) anchor
   element carrying `id="trg-x"` — never visible literal text — with NO script/style/
   event-handler HTML surviving the sanitizer.
4. **AC8 — in-pane anchor nav.** Clicking a `[…](#trg-x)` / `[…](#heading)` link scrolls
   the matching `id` into view WITHIN the SmartViewer pane (not the window), heading IDs
   provided by `rehype-slug`.
5. **AC5 — pop-out + page scroll.** A pop-out button opens the rendered file full-screen
   in a new tab (route `/preview?projectId=&path=`); the in-pane document gets a single
   page-level horizontal scrollbar (wide tables / ASCII diagrams scroll the whole pane,
   not just themselves).

## Affected Boundaries

- No `.env`/config/JSON io-boundary. Client-only render + a new client route.
- **New deps:** `rehype-raw`, `rehype-sanitize`, `rehype-slug` (client) — `touches_build`
  (package.json) → performance-budget advisory.

## Security

- `rehype-raw` is enabled ONLY in DocumentMarkdown (file preview), and ALWAYS paired with
  `rehype-sanitize` (custom schema) — no `<script>`/`on*`/`style`/`javascript:` survives.
  The transcript renderer is untouched (no raw HTML there). File preview content is the
  user's own project files (more trusted than transcript output).

## Confidence Calibration
- **Boundaries touched:** SmartViewer markdown render pipeline (file preview only); a new full-screen `/preview` route; 3 new client deps (`touches_build`).
- **Empirical probes run:** unit tests render fixtures for each of comment-hidden / frontmatter-block / anchor-with-id / sanitizer-strips-`<script>`; an in-pane-nav unit/E2E click test; F0.5 E2E previews a real `.md` with all four constructs + clicks an anchor + opens the pop-out, asserting in real Chromium.
- **Edge cases NOT probed + why acceptable:** malformed/unterminated frontmatter (preprocess only fires on a fully-closed leading `---…---`; otherwise content renders as-is); deeply nested raw HTML (sanitizer strips to the allow-list — failure mode is "less renders", never script execution).
- **Confidence-pattern check:** the risky asymptote is the sanitizer allow-list — explicitly probe that a `<script>`/`onclick` in a fixture does NOT survive, so "anchors render" is not the only verified path.

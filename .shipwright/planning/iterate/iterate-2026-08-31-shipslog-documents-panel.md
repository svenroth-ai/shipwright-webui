# Iterate: Ship's-Log Documents panel — Requirements/Iterate/Agent Docs/Compliance links, in-place Edit

- **Run ID:** `iterate-2026-08-31-shipslog-documents-panel`
- **Intent:** FEATURE — Sven: "Im Ships log haben wir nirgends die Links zu
  den Compliance Docs, den Agent Docs und den Specs. Das ist aber schade,
  weil man es so nur im File Viewer oder im Mission Tab findet."
- **Complexity:** medium (`classify_complexity.py`: confidence 0.75,
  risk_flags `["touches_shared_infra"]` → `full_test_suite` enforced —
  `SmartViewer.tsx`/`MarkdownRenderer.tsx` are shared across the File
  Viewer, Triage file panel, and this new panel)
- **Spec Impact:** ADD — new read surface, new UI, no existing contract
  narrowed.
- **Affected FRs:** FR-01.60 (Ship's Log)

## Design process (6 rounds, HTML mockup, user-approved before build)

Sven asked for a clean-HTML proposal to approve visually before any code —
delivered via the `Artifact` tool across 6 revisions, converging on:

1. **Layout** — split Ship's Log into a full-page two-column grid, 2/3
   (existing drawer/promptbox/graduation/logbook, unchanged) : 1/3 (new
   Documents panel), not just the top strip. Confirmed explicitly after an
   earlier "top strip only" option was floated and rejected.
2. **Specs are two SEPARATE tabs**, not one merged list — "Requirements"
   (the ur-spec per planning SECTION, `.shipwright/planning/<section>/
   spec.md`) and "Iterate" (the flat `*.md` mini-specs under
   `.shipwright/planning/iterate/`, ~230 today, search-filterable). Scope
   oscillated during design (v1–v3 merged them; Sven corrected to
   Requirements-only in v4; then asked to restore Iterate as a second tab
   in v5/v6) — the two-tab structure is the final, approved shape.
3. **Agent Docs** (5, fixed): Dashboard, Architecture, Decision Log,
   Conventions, Design Tokens. **Compliance** (5, fixed): Dashboard,
   Traceability Matrix, Test Evidence, Change History, SBOM. Every row
   shows its last-changed date for a consistent feel across all four
   groups.
4. **Editing** — reuse the REAL SmartViewer/MarkdownEditorModal pipeline
   (TipTap), not a simplified viewer, opened via the existing
   `SmartViewerModal` overlay. Sven surfaced mid-design that the Edit
   button was missing inside that overlay ("das fehlt eh noch im modal")
   — traced to `MarkdownRenderer`'s Edit gating being coupled to the same
   `onSaved` callback that also implied "primary pane," so a modal-nested
   `SmartViewer` (`popOut={false}`) never got one. Fixed as part of this
   iterate (see Fix §2).
5. **Uncommitted-changes notice** — a save through `MarkdownEditorModal` is
   pure filesystem I/O (confirmed by reading `external/file/write.ts`: no
   git call anywhere on that path); Sven asked for an explicit banner
   saying so, added GLOBALLY (every `MarkdownEditorModal` use), not just
   in this new panel.
6. **Accessibility** — real `<h2>`/`<h3>` headings, `@radix-ui/react-tabs`
   (already a dependency, one existing usage site) rather than a hand-
   rolled tab widget, a visually-hidden `<label>` on the Iterate search
   input.
7. **"mach den Iterate autonom. du hast alles."** — the design was fully
   settled through the mockup-approval loop; build proceeded end-to-end
   without further check-ins.

## Fix

1. **New read surface** — `server/src/core/shipslog-docs-types.ts` (SoT
   shapes, mirrored client-side per ADR-080) +
   `server/src/core/shipslog-docs-reader.ts` (pure fs reader) +
   `server/src/external/shipslog-docs/routes.ts`
   (`GET /api/external/projects/:id/shipslog-docs`). Every path —
   including the two dynamically-`readdir`'d directories (planning
   sections, iterate specs) — is re-verified with `pathGuard` +
   `realPathGuard` before it is stat'd or returned (CLAUDE.md rule 10),
   even though nothing here is client-supplied (defense in depth, and
   `realpathSync(projectRoot)` is hoisted once per read rather than paid
   ~230 times, per `path-guard.ts`'s own documented batch-caller
   optimization). A curated file that doesn't exist on disk is skipped
   silently — no "unavailable" row.
2. **Edit-button decoupling** — `SmartViewer.tsx`'s `TextFileViewer` now
   always wires `MarkdownRenderer`'s `onSaved` (previously gated on
   `popOut`); only `onPopOut` stays `popOut`-gated. `MarkdownRenderer.tsx`'s
   `canEdit` logic is unchanged (`projectId && path && onSaved`) — what
   changed is that every caller now supplies `onSaved`, so a modal-nested
   instance (`SmartViewerModal`, and incidentally `TriageFilePanel`, which
   shares the same `popOut={false}` path) can open the TipTap editor too.
   The "no modal-in-modal" comment is updated to reflect that Radix
   dialogs portal to `<body>` and nest correctly — only the pop-out
   AFFORDANCE itself stays non-recursive.
3. **Uncommitted-changes banner** — `MarkdownEditorBanners.tsx` gains an
   unconditional info notice, shown in every phase except
   `loading`/`load_error` (same visibility rule as the existing
   frontmatter banner), `data-testid="md-editor-uncommitted-note"`.
4. **New client components** — `ShipsLogDocumentsPanel.tsx` (shell + one
   shared `SmartViewerModal` instance keyed by the last-clicked row),
   `ShipsLogSpecsTabs.tsx` (Radix Tabs), `ShipsLogDocList.tsx` (shared row
   renderer, reused for Agent Docs/Compliance and inside each Specs tab).
   Rows reuse the existing `.logentry` class (already reset for
   `on-photo.css` legibility); groups reuse `.sheet`/`.sheet-h`. New CSS
   is confined to the tab strip, search input, and the two-column grid
   itself — split into `ships-log-docs.css` to keep `ships-log.css` under
   the 300-LOC convention (it was already at 301 before this feature).
5. **`ShipsLogPage.tsx`** — `.ships-log` becomes a 2fr:1fr CSS grid
   (`.sl-main` left, the new panel right). The right column is
   `position: sticky; top: 24px; max-height: calc(100vh - 120px);
   overflow-y: auto` — it tracks the page scroll and caps itself to the
   viewport rather than trying to mirror `.sl-main`'s height via a
   percentage on an auto-sized grid row (see `## Self-Review` — the
   original `min-height:0` + `height:100%` grid attempt was flagged by
   external review and empirically confirmed broken: the row grew to the
   panel's own content height instead of clipping it). Its direct children
   also carry `flex-shrink: 0` — a SECOND bug the first fix's own
   verification test caught: without it, each `.sheet` group's nested
   `overflow:auto` list silently shrank to fit inside the max-height cap
   (CLAUDE.md rule 24) instead of the panel genuinely overflowing and
   scrolling, so `scrollHeight === clientHeight` even though content was
   visibly clipped. Collapses to a single (non-sticky) column ≤900px.

## Confidence Calibration

- **Boundaries touched:** one new fs-backed read route (own reader,
  path-guard discipline mirrored from `external/tree/routes.ts`); one
  existing shared-component prop-wiring change (`SmartViewer.tsx`); one
  additive UI banner. No schema change, no write surface, no new I/O
  format → `touches_shared_infra` is the correct (and only) risk flag, not
  `touches_io_boundary`.
- **Empirical probes run:**
  - Read `MarkdownRenderer.tsx`, `SmartViewer.tsx`, and
    `SmartViewerModal.tsx` in full before touching anything, to confirm
    the ACTUAL gating mechanism (`onSaved` presence, not a separate
    `canEdit` prop) rather than trusting the mockup-round's guess at it.
  - Grepped the whole client test suite for `smart-viewer-edit` before
    changing the wiring — confirmed no existing test asserted Edit's
    ABSENCE inside a modal-nested `SmartViewer` (only the pop-out button's
    absence is asserted), so the decoupling changes no documented
    contract; added a new regression test locking in the new behavior
    instead of just hoping nothing broke.
  - Ran the full server (393 files / — vitest) and full client (393
    files, 3635 tests) suites, both green, before treating the shared-
    component change as safe.
  - Ran the new real-browser E2E flow (`A16b-shipslog-documents-panel.spec.ts`)
    AND the pre-existing `A16-ships-log.spec.ts` through
    `client/e2e/isolated-stack.mjs` against a real production build — the
    layout refactor does not regress the existing Ship's-Log flow, and the
    new panel's full click-through (Requirements → Iterate search → Edit →
    the new banner → Agent Docs → Compliance) works against real seeded
    files on disk, not mocked API responses (the server's own fs
    discovery is exercised, not just client rendering).
- **Test Completeness Ledger:** in `iterate_latest.test_completeness`.
- **Confidence-pattern check:**
  - *Asymptote:* the reader's fs-discovery behavior (curated skip-if-
    missing, requirements section discovery + label derivation, iterate
    newest-first sort, an unreadable project root degrading gracefully) is
    proven against a REAL temp directory tree (`mkdtempSync` +
    `utimesSync` for deterministic mtime ordering), not a mocked `fs`
    module — the same discipline `run-data-join.file.test.ts` uses.
  - *Coverage:* server (reader unit tests + router contract tests +
    types-mirror drift guard), client (three new component test files +
    the SmartViewer/MarkdownEditorBanners regression additions +
    `ShipsLogPage.test.tsx` composition update), and one real-browser E2E
    flow exercising the full stack.
  - *Honest gap:* the visual-regression baseline for `ships-log.png` is
    guaranteed to shift (the whole page layout changed) — this is a
    KNOWN, EXPECTED baseline change, handled via the documented
    Linux-container regen flow (`.github/workflows/visual-baselines.yml`)
    after push, not a gap in this iterate's own testing.

## Internal Plan Review

Executed as a fork with no Agent-tool subagent access (harness constraint
on this run) — the spec-reviewer / code-reviewer / doubt-reviewer cascade
this project's `CLAUDE.md` pre-grants was therefore run as rigorous
self-review passes against this diff (spec compliance, code quality,
adversarial doubt) rather than via spawned subagents. See `## Self-Review`
below for the recorded findings and dispositions.

## Self-Review

`external_review.py --mode code` (openai + deepseek, both pinned
providers) against the full staged diff + this spec returned `revise` from
both — no contradiction (both agreed within one step). Two findings, both
investigated to a verified conclusion rather than taken on trust:

1. **deepseek, medium, `MarkdownEditorBanners.tsx`** — claimed the new
   banner's `&amp;` and `<code>…</code>` render as literal text rather
   than a decoded ampersand and a real element. **Dismissed as a false
   positive**, verified rather than assumed: a targeted unit assertion
   (`MarkdownEditorBanners.test.tsx`, "renders a real `<code>` element and
   a decoded ampersand") reads the rendered DOM directly —
   `note.querySelector("code")?.textContent === "/shipwright-iterate"`,
   `note.textContent` contains `"Commit & push"`, and does NOT contain
   `"&amp;"`. JSX text nodes decode HTML entities and `<code>` compiles to
   a real element; the reviewer appears to have evaluated the diff as
   literal output rather than JSX source.
2. **openai, medium, `ships-log-docs.css`** — claimed `.sl-docs
   { height: 100% }` inside `.ships-log`'s auto-sized grid row does not
   reliably resolve, so a right column taller than the left could grow the
   row instead of scrolling internally, and that the shipped E2E spec
   never exercised that scenario. **Confirmed correct** — my own earlier
   manual visual check had in fact hit exactly this shape (an empty
   logbook next to a populated panel) and I had misread it as fine. Fixed
   in two steps, each verified against a real browser via a new E2E test
   (`A16b…geometry`, seeding a project with no runs next to a fully
   populated Documents panel):
   - Replaced the `min-height:0` + `height:100%` grid-stretch attempt with
     `position: sticky; top: 24px; max-height: calc(100vh - 120px);
     overflow-y: auto` — sidesteps the auto-row circularity entirely by
     capping the panel to the viewport instead of trying to mirror
     `.sl-main`'s height. First E2E run confirmed the box height genuinely
     caps (`clientHeight: 380` on a 500px-tall test viewport) — but also
     surfaced a **second, deeper bug the review didn't name**: `scrollHeight
     === clientHeight === 380`, meaning content was being silently
     SQUEEZED to fit rather than actually overflowing.
   - Root cause: `.sl-docs`'s direct children (the three `.sheet` groups,
     each containing its own `overflow-y:auto` list) have default
     `flex-shrink: 1` + `min-height: auto` — CLAUDE.md rule 24's exact
     footgun, just on a sticky/max-height container instead of a plain
     flex one. Added `.ships-log .sl-docs > * { flex-shrink: 0; }`; re-run
     confirmed `scrollHeight: 799` vs `clientHeight: 380` — the panel now
     genuinely overflows and scrolls instead of quietly clipping.

Neither finding was dismissed without independent verification (a unit
assertion for #1, a real-browser E2E measurement for #2); #2 caught a bug
worse than the one the reviewer named.

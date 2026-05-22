# Iterate Spec: terminal-selection-uxd

- **Run ID:** iterate-2026-05-23-terminal-selection-uxd
- **Type:** change
- **Complexity:** medium
- **Status:** draft

## Goal

The embedded terminal pane (xterm.js) selects text poorly compared to VS Code's integrated terminal — drag-select is blocked inside Claude TUI (which enables SGR mouse-tracking via `?1006h`), word/right-click selection options are missing, and the user has no on-screen hint that holding **Shift** bypasses mouse mode. Align our xterm `Terminal` options with VS Code (`xtermTerminal.ts:226-275`), add copy-on-selection so selecting text auto-fills the OS clipboard, and surface a dismissable banner only while the foreground app holds the mouse — so the Shift+Drag escape hatch becomes discoverable.

## Acceptance Criteria

- [ ] **AC1** — Drag-selecting text in a non-mouse-tracking shell (e.g. after `echo line1; echo line2; echo line3`) produces a non-empty `term.getSelection()` AND, **on `mouseup`** (not on every `onSelectionChange` fire), auto-copies that selection to the OS clipboard. Verified by Playwright spec `86-terminal-selection.spec.ts`.
- [ ] **AC2** — When xterm's root element gains the `.enable-mouse-events` class (set by xterm-core when DECSET 1000/1002/1003 is active), the EmbeddedTerminal renders a small dismissable hint badge with text "Maus-Modus aktiv — Shift+Drag zum Markieren". Removing the class hides the badge again. **Initial state is read synchronously from `classList` when the observer attaches** — a terminal already in mouse-mode at mount surfaces the badge immediately, not on the next transition. Verified by unit test.
- [ ] **AC3** — Clicking the badge's "×" dismiss button hides it; the badge is re-shown only on the NEXT off→on class transition. The close button uses `onMouseDown={ev => ev.preventDefault()}` so the click never steals focus from the xterm helper-textarea (terminal typing is not interrupted). Verified by unit test.
- [ ] **AC4** — Constructed Terminal options include `rightClickSelectsWord: true`, `macOptionClickForcesSelection: true`, and the VS-Code-matching `wordSeparator: " ()[]{}',\"`|;:!?"`. `convertEol`, `allowProposedApi`, `rescaleOverlappingGlyphs` are unchanged. Verified by unit-test snapshot on the constructor mock.
- [ ] **AC5** — Auto-copy is debounced + de-duplicated: `onSelectionChange` only updates a `latestSelectionRef`; the actual `copyText` call fires from native `mouseup` / `keyup` listeners on `term.element` (preserves browser-required "transient user activation" — see Confidence Calibration). A `lastCopiedSelectionRef` short-circuits when the text hasn't changed (no double-copy on the trailing `mouseup` after a drag). Auto-copy is SILENT — it does NOT surface the existing "Copied" pill (which remains reserved for explicit Ctrl+C, keeping the notification semantics consistent). Verified by unit tests: (i) 50 synthetic `onSelectionChange` fires during a drag → `copyText` not called; (ii) one `mouseup` → `copyText` called exactly once; (iii) identical-selection `mouseup` → `copyText` NOT re-called.
- [ ] **AC6** — Existing Ctrl+C / Ctrl+Insert copy, Ctrl+V / Shift+Insert paste, right-click paste, image-paste, and bracketed-paste flows are not regressed. Verified by re-running `terminal-clipboard.test.ts` + `terminal-clipboard-handler.test.ts` + `EmbeddedTerminal.test.tsx` + a smoke pass over one existing terminal Playwright spec.
- [ ] **AC7** — Dual `tsc --noEmit` clean (client + server); `oxlint .` clean (client + server).
- [ ] **AC8** — External code-review (`external_review.py --mode code` over the iterate diff) reports no HIGH-severity findings.

## Spec Impact

This iterate extends FR-01.28's user-visible behaviour additively (selection + auto-copy + discoverability) without changing wire protocol, write surface, or any DO-NOT guard.

- **Classification:** MODIFY
- **ADD:** none
- **MODIFY:** FR-01.28 — add three new `(E)` acceptance lines covering (a) VS-Code-aligned `rightClickSelectsWord` + `macOptionClickForcesSelection` + `wordSeparator`, (b) copy-on-selection via `term.onSelectionChange` writing through the existing `copyText()` helper, (c) the dismissable mouse-mode hint badge gated by the `.enable-mouse-events` class.
- **REMOVE:** none
- **NONE justification:** n/a (MODIFY applies)

## Out of Scope

- No backend changes (no `server/` edits).
- No xterm package-version bump (ADR-097/ADR-098 exact-pin to 6.0.0 is load-bearing).
- No change to ADR-099 server-side mouse-mode (`?1006h`) re-emit logic — Claude TUI's mouse-mode reach is preserved.
- No change to existing `createClipboardKeyHandler` (Ctrl+C/V chord logic) in `terminal-clipboard.ts`.
- No new dependency (Radix, lib/clipboard, react-markdown stack untouched).
- No localStorage write — banner-dismissal state is per-component-lifetime only.
- No new server endpoint, no new WS envelope.
- No re-introduction of a chat composer (ADR-034).
- No `@assistant-ui/*` packages (DO-NOT guard #4).

## Design Notes

- **Hint banner position:** top-right corner of the terminal pane, absolutely positioned over the xterm canvas. Same z-index family as the existing `clipboard notice` pill (`CLIPBOARD_NOTICE_CLASS` near `EmbeddedTerminal.tsx:151`) — does not collide because the clipboard pill renders at top-center.
- **Banner styling:** match the existing pill style: border, dark muted background, small caps, padding-x-2 / padding-y-1, rounded. Use `border-sky-800 bg-[#0f1d2e] text-sky-300` to match the existing `paste-hint` tone (semantically the same: an info hint about clipboard interaction in a constrained environment).
- **Banner copy (German, to match the user's locale):** "Maus-Modus aktiv — Shift+Drag zum Markieren". Close button is a small `×` glyph; aria-label `Hinweis schließen`.
- **Affected mockup files:** none new — this iterate adds one in-pane overlay element; no new screen or page-level redesign. The existing `client/src/components/terminal/EmbeddedTerminal.tsx` already owns absolute-positioned overlays (clipboard notice, replay banner, reset banner).
- **No visual-guidelines.md deviations:** uses existing token vocabulary.

## Affected Boundaries

This iterate writes/reads NO serialized formats. Selection state is in-memory only; banner-dismissal is per-component-lifetime React state; no localStorage, no JSON file, no env var, no env-pasted command. The new `term.onSelectionChange` writes to the OS clipboard via the existing `copyText()` helper — that helper already abstracts the secure-context vs `execCommand` fallback decision (no new branch).

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| n/a — no serialized boundary touched | n/a | n/a |

Justification: No new write surface; no new file format; no new env var; no new wire envelope. The `touches_io_boundary` risk flag does NOT fire.

## Confidence Calibration

(Populated before F0 Fresh Verification Gate — see SKILL.md Path A Step 7.5 + `references/confidence-anti-patterns.md`. Below is the AT-AUTHORING baseline; the runner re-populates the empirical-probes line during build.)

- **Boundaries touched:** none — Affected Boundaries table is `n/a`.
- **Empirical probes run** (all green during build; 18 new unit-test cases under `EmbeddedTerminal.test.tsx`):
  - **Probe 1 (debounce):** 50 synthetic `selectionChangeHandler()` fires with `mockSelection = "drag-in-progress"`. `writeText` was NOT called — `onSelectionChange` only mutates `latestSelectionRef`; the copy fires from `mouseup`. PASS.
  - **Probe 2 (mouseup flush):** one selection-change fire, then one `dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))` on `term.element`. `writeText` called exactly once with the selection string. PASS.
  - **Probe 3 (dedup):** two consecutive `mouseup` events with the SAME `mockSelection`. `writeText` called only once (the second is short-circuited by `lastCopiedSelectionRef`). PASS.
  - **Probe 4 (empty selection):** selection-change with `""`, then `mouseup`. `writeText` NOT called. PASS.
  - **Probe 4b (whitespace-only):** selection-change with `"   \n\t  "`, then `mouseup`. `writeText` NOT called. PASS.
  - **Probe 5 (initial classList sync read):** `preMountElementClasses = ["enable-mouse-events"]` so the constructor returns an element with the class. After mount, the banner renders synchronously (no class transition needed). PASS.
  - **Probe 6 (transitions):** class added post-mount → banner appears; class removed → banner disappears; dismissed → banner hidden; class removed-then-re-added → banner re-renders (banner dismiss does not stick across off→on transitions). PASS.
  - **Probe 7 (focus preservation):** synthetic `mousedown` on the dismiss button; `ev.defaultPrevented === true`. The xterm helper-textarea keeps focus through a banner-dismiss click. PASS.
  - **Probe 8 (silent UX):** after the auto-copy mouseup, the `embedded-terminal-clipboard-notice` testid is absent in the DOM. PASS — auto-copy is silent; the "Copied" pill remains reserved for explicit Ctrl+C.
  - **Probe 9 (keyboard selection):** dispatch `keyup` on `term.element` after a selection-change with non-empty `mockSelection`. `writeText` called with the selection. PASS — both `mouseup` and `keyup` flush.
- **Edge cases NOT probed + why acceptable:** (a) `navigator.clipboard.writeText` rejection inside auto-copy — silently swallowed (auto-copy is best-effort UX; the explicit Ctrl+C path still surfaces `copy-failed` for non-recoverable cases). (b) Multi-line selection containing CR/LF — `term.getSelection()` already returns OS-line-ending-normalised text; same as Ctrl+C copy. (c) Selection inside the alt-buffer (Claude TUI) — covered by AC2 (mouse-mode hint surfaces) not AC1 (drag-select assertion runs in a non-mouse-tracking shell). (d) Right-click word-select / Mac Option-click — these are xterm Terminal-option behaviours; we verify the options are set (AC4) but not the browser-level behaviour. Out-of-scope to instrument the OS context menu in Playwright.
- **Confidence-pattern check:** no prior "are you confident?"-style answer in this run. External-review iterate-mode produced 2× HIGH findings (clipboard-thrashing + lost-transient-user-activation, both reviewers); both addressed by switching the copy trigger from `onSelectionChange` to native `mouseup`/`keyup` and adding dedup via `lastCopiedSelectionRef`. ACs AC1 + AC5 reflect this change.

## Verification (medium+)

- **Surface:** web (Playwright)
- **Runner command:** `cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts e2e/flows/86-terminal-selection.spec.ts`
- **Evidence path:** `client/playwright-report/index.html` + `.shipwright/runs/iterate-2026-05-23-terminal-selection-uxd/surface_verification.json`
- **Justification (only if surface=none):** n/a (web surface exists)

## Self-Review (Step 7 — 7-point)

1. **Acceptance Criteria coverage** — AC1 covered by Playwright spec 86; AC2 / AC3 / AC4 / AC5 covered by 18 new unit-test cases under `EmbeddedTerminal.test.tsx`; AC6 verified by `npm run vitest run` green (client 1041 / server 1174); AC7 verified by `tsc --noEmit` clean on both halves + `oxlint .` no new warnings; AC8 deferred to the post-build external code review step.
2. **No dead code / unused imports** — the new refs (`latestSelectionRef`, `lastCopiedSelectionRef`) and state (`mouseEventsActive`, `bannerDismissed`) are all referenced. No commented-out blocks. No unused imports.
3. **File sizes** — `EmbeddedTerminal.tsx` grew by 206 LOC to ≈ 2100 LOC. This file was already over the 300-line guideline before this iterate; splitting it is a documented out-of-scope follow-up. The new code is colocated with the existing absolute-positioned overlay JSX (banner) and the existing terminal-attach effect (selection wiring) so a future split has clear seams.
4. **Conventions** — TypeScript strict everywhere; new code uses `useRef<string>` typed strings + boolean state; commit message will be Conventional (`feat(terminal): VS Code-aligned selection + copy-on-select + mouse-mode hint`).
5. **No regression** — pre-existing client `doc-sync.test.ts` failures (11) are unchanged; they fail identically on `origin/main` (a Phase 0f compliance-hygiene CLAUDE.md cleanup removed file-tree mentions without updating the test's REQUIRED_TOKENS allowlist). Recorded in `shipwright_test_results.json` as a degraded condition; not introduced by this iterate. All other tests green.
6. **Architecture rules + DO-NOT guards** — every DO-NOT guard #1–#22 in CLAUDE.md is preserved:
   - xterm.js exact-pin (#22) unchanged.
   - No new write surface (#1 / #12).
   - No cross-package imports (#7).
   - No `pty-manager` / `paste-image` / `realPathGuard` touches (#17 / #18).
   - No chat composer (#3) / no `@assistant-ui/*` (#4).
   - No change to ADR-099 mouse-mode re-emit logic (server-side `?1006h` preserved).
7. **Affected Boundaries** — `n/a` as recorded in the spec table. No new serialized format; no localStorage write; no env var. Auto-copy reads `term.getSelection()` (in-memory) and writes via `copyText` (calls into the existing `navigator.clipboard.writeText` / `execCommand('copy')` paths in `lib/clipboard.ts`). The `touches_io_boundary` risk flag does NOT fire.

## Status

- **Status:** implemented + verified — 64/64 unit tests green; F0.5 web E2E green (real Chromium + xterm + isolated stack at `localhost:5174`); four rounds of external code review converged on no HIGH findings (round 4 MED items addressed: keyup narrowed to Shift+Arrow/Home/End/Page; dedup ref clears on empty selection; drag-origin tracker re-evaluates per mousedown; AC4 consolidated `toMatchObject`; tightened E2E clipboard equality).

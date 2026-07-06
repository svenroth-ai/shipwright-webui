# Iterate: Terminal copy — survive the redraw-clear (selection cache + Copy affordance)

- **run_id:** `iterate-2026-07-06-terminal-copy-selection-cache`
- **intent:** bug (restore broken behavior)
- **complexity:** medium
- **spec impact:** NONE (bug fix to intended behavior) — affected FR: terminal copy/paste (iterate-2026-05-18-terminal-copy-paste)
- **scope:** COPY only. Paste double-send investigation/hardening is a **separate follow-up iterate** (user-directed 2-step split).

## Problem (empirically confirmed)

Reported: "Copy (Shift+Drag then Ctrl+C) no longer works — completely broken." Root cause found via live browser instrumentation (`window.__embeddedTerminal` wrap, real http/Tailscale session):

1. Claude's TUI runs **any-motion mouse tracking (mode 1003)** → every mouse move is reported to the app (`onData "[<..M"`).
2. Each mouse-report makes Claude **redraw**; an xterm redraw **clears the selection**. Confirmed sequence: `selectionChange "HELLO123"` → `selectionChange ""` within a moment.
3. By the time the user presses Ctrl+C, `hasSelection=false` → the copy handler passes through → **`` (SIGINT)** is sent (`onData ""`). Copies nothing; can interrupt Claude.
4. `ENV`: `isSecureContext=false, protocol=http:, navigator.clipboard=absent` → the async Clipboard API is dead; copy must use the `execCommand` fallback, paste is native-only.

**#186 connection:** copy-on-selection (removed as a default by #186) was the only thing that captured the text at `mouseup` *before* the redraw wiped it. Removing it exposed the underlying fragility — hence "broke after #186."

## Approach

Capture the selection the instant it settles and hold it, instead of fighting xterm/Claude over selection persistence.

## Acceptance Criteria

- **AC-1** When the live selection has been cleared (redraw), Ctrl+C / Ctrl+Insert copies the **last captured** selection (cache) instead of sending SIGINT.
- **AC-2** With no recent selection (cache empty/invalidated), Ctrl+C still passes through as **SIGINT** — interrupt is preserved.
- **AC-3** After a selection settles (mouseup), a mouse-only **"Copy" affordance** appears; clicking it copies the captured selection. No keyboard chord, no releasing Shift.
- **AC-4** The cache + affordance are **invalidated** on a new selection gesture (mousedown in the terminal) and on committing keyboard input — a stale selection never hijacks a later Ctrl+C-as-SIGINT.
- **AC-5** Copy-on-selection auto-write stays **opt-in / default-off** (#186 NOT regressed). Capturing-for-copy never writes to the OS clipboard on its own — no clobber.
- **AC-6** The copy write works in a **non-secure (http) context** via the `execCommand` fallback (no `navigator.clipboard` dependency).

## Design

- **`useTerminalClipboard.ts`** (new hook) — owns `clipboardNotice` state + auto-dismiss (moved out of `EmbeddedTerminal` to stay ≤316 LOC / not ratchet the bloat baseline), plus the selection cache (`cacheRef`), the `copyableSelection` pill state, and `onCopySelection` (execCommand-backed). Exposes `notify / captureSelection / invalidateSelection / getCachedSelection / copyableSelection / onCopySelection / clipboardNotice / dismissClipboardNotice`.
- **`useTerminalSelection.ts`** — track the last **non-empty** selection (stop clobbering the tracker with `""`); on mouseup capture it (always, into the cache) and only auto-copy when the opt-in pref is ON (unchanged #186 gate); reset the tracker + invalidate on mousedown; invalidate on committing keydown.
- **`terminal-clipboard.ts`** — `createClipboardKeyHandler` gains optional `getCachedSelection` (fallback when live selection empty) + `onCopySuccess` (clears pill/cache after a copy). SIGINT passthrough preserved when both live and cache are empty.
- **`TerminalBanners.tsx`** — render the "Copy" pill from `copyableSelection` + `onCopySelection` (does NOT consume right-click, so native right-click→Paste stays intact over http).

## Confidence Calibration
- **Boundaries touched:** terminal clipboard/selection (client only). No IO-boundary files, no auth/rls/migration/build risk flags.
- **Empirical probes run:** live `window.__embeddedTerminal` instrumentation over real http/Tailscale — proved (a) selection is created then cleared by redraws, (b) Ctrl+C emits `` when `hasSelection=false`, (c) `isSecureContext=false` / clipboard API absent, (d) one bracketed-paste per paste action (no reproduced double-send → paste deferred).
- **Test Completeness Ledger:** every AC → a test (see below); 0 untested-testable.
- **Confidence-pattern check:** depth — cache fallback + SIGINT preservation + invalidation unit-pinned; breadth — hook state, selection capture, handler fallback, pill render, and a real-browser E2E reproducing the redraw-clear. No `cross_component` machinery touched.

### Test Completeness Ledger
| Behavior | AC | Disposition | Evidence |
|---|---|---|---|
| Ctrl+C copies cached selection when live is empty | AC-1 | tested | terminal-clipboard-handler.test.ts (cache-fallback) |
| Ctrl+C with empty cache → SIGINT passthrough | AC-2 | tested | terminal-clipboard-handler.test.ts |
| mouseup captures selection → pill shows | AC-3 | tested | useTerminalClipboard.test.ts + useTerminalSelection.test.ts |
| pill click copies via copyText | AC-3 | tested | useTerminalClipboard.test.ts |
| mousedown / keydown invalidates cache+pill | AC-4 | tested | useTerminalSelection.test.ts + useTerminalClipboard.test.ts |
| copy-on-selection stays opt-in default-off | AC-5 | tested | useTerminalSelection.test.ts (existing, kept green) |
| copy write works with no navigator.clipboard (execCommand) | AC-6 | tested | lib/clipboard existing execCommand path + E2E over http-like context |
| end-to-end: redraw clears selection, copy still works | AC-1/3 | tested | Playwright E2E (real browser) |

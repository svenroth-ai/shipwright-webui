# Iterate Spec — Terminal "smear" on window/tab refocus

- **Run ID:** iterate-2026-06-14-terminal-smear-window-focus
- **Intent:** BUG
- **Complexity:** medium (escalated from `small`: load-bearing WebGL renderer / CLAUDE.md rule 22, cross-cutting across every navigation path, user-requested multi-scenario verification)
- **Spec Impact:** NONE (behavior-restoring bug fix; no functional spec-doc contract change)
- **Risk flags:** none

## Problem (user report)

> "Oft wenn ich zurückkomme und das Edge-Fenster öffne, sieht es verschmiert
> aus. Auch wenn ich von der Triage, Card oder der Inbox komme, verschmiert
> es manchmal. Was hilft, ist das Fenster schnell etwas grösser/kleiner zu
> machen — dann geht es weg."

Two variants of the same defect, confirmed from the screenshot:
1. **Verschoben** — window moved to a smaller monitor: Claude's alt-buffer TUI
   stayed wrapped at the *old* width; the task title + statusline bled into the
   right half of the terminal.
2. **Verschmiert** — same width, ghost/stale glyphs (WebGL frame not repainted).

A manual window resize was the only remedy.

## Root cause (F-debug)

xterm's WebGL renderer (ADR-099) force-repaints on exactly **three** triggers:
`ResizeObserver` (manual resize), tab activation (`active` rising edge), and
scroll (`scroll-repaint.ts`). There was **no** handler for:

- `window` `focus` / `document` `visibilitychange` / `pageshow` — returning to
  a backgrounded Edge window or a bfcache restore. Chromium/Edge stop painting
  (and may drop) the WebGL canvas for backgrounded windows → a stale frame
  persists.
- WebGL **context loss** — a dropped GPU context freezes the canvas on its last
  frame with no recovery.

Empirical confirmation: `grep -rE "visibilitychange|onContextLoss|pageshow"`
over `client/src` returned **zero** matches before this iterate.

Why a resize healed it: a real dimension change runs `fit()` → `term.resize()`
(full reflow/repaint) AND sends a WS resize → SIGWINCH → Claude's TUI redraws
at the new width.

## Fix

1. **`useTerminalResize.ts`** — new one-shot effect listening on `window` `focus`,
   `window` `pageshow`, and `document` `visibilitychange`. On fire (and not
   `document.hidden` / not disposed): `safeFit()` + `term.refresh(0, rows-1)` +
   dedupe-send the WS `resize` frame. Reuses the hook's existing `safeFit`,
   `lastSentRef` dedupe, and `disposedRef` guards. Covers BOTH buffers:
   `refresh` heals the same-width stale-GPU-frame; the dedupe-send SIGWINCH
   heals the alt-buffer width mismatch. `fit()` is a safe no-op when the pane
   is `display:none` (FitAddon returns early on a 0-dim container).
2. **`xtermAddons.ts`** — register `webgl.onContextLoss(() => webgl.dispose())`
   (canonical xtermjs/xterm.js pattern). A genuinely lost GPU context cleanly
   falls back to the DOM renderer instead of a frozen smear.

### Alternatives considered
- **New standalone `repaint-on-visibility.ts` module** (à la `scroll-repaint.ts`).
  Rejected: duplicates the `safeFit`/dedupe/`socketSend` plumbing
  `useTerminalResize` already owns; visibility-regain *is* a refit trigger like
  the two already living there. Cohesion + bloat.
- **Disable WebGL / force DOM renderer.** Rejected: regresses Claude TUI
  alt-screen perf (the reason ADR-099 chose WebGL). Too blunt.

## Confidence Calibration
- **Boundaries touched:** xterm WebGL renderer lifecycle (client); the existing
  WS `resize`-frame dedupe path (reused, not changed). No file/env/IO boundary,
  no server change.
- **Empirical probes run:**
  - `grep visibilitychange|onContextLoss|pageshow client/src` → 0 matches
    (confirmed the missing-handler gap).
  - Screenshot crop analysis → reflow + stale-frame smear (title/statusline
    bleed into the terminal's right half) confirms width-mismatch + stale GPU.
  - Real-browser E2E (Chromium, spec 91) → `focus`/`visibilitychange`/`pageshow`
    each increment a full-viewport `refresh(0,rows-1)` counter ≥1; route-nav
    remount re-attaches the listeners.
- **Test Completeness Ledger:**

  | # | Behavior | Disposition | Evidence |
  |---|----------|-------------|----------|
  | 1 | `window` focus → refit + full-viewport refresh + resize frame | tested | unit `useTerminalResize.test.ts` "window focus triggers refit + term.refresh + a resize frame"; E2E 91 scenario 1 |
  | 2 | `visibilitychange` (visible) → refit + refresh | tested | unit "document visibilitychange (becoming visible)…"; E2E 91 scenario 2 |
  | 3 | `pageshow` (bfcache) → refit + refresh | tested | unit "pageshow (bfcache restore)…"; E2E 91 scenario 3 |
  | 4 | `visibilitychange` while `document.hidden` → no-op | tested | unit "visibilitychange while document.hidden=true is a no-op" |
  | 5 | disposed term → no-op | tested | unit "focus after disposed=true is a no-op" |
  | 6 | listeners removed on unmount | tested | unit "removes the focus/visibility/pageshow listeners on unmount" |
  | 7 | unchanged dims → repaint but dedupe the resize frame | tested | unit "focus with unchanged dims still repaints but dedupes" |
  | 8 | listeners re-attach after route-nav remount | tested | E2E 91 "listeners re-attach after route navigation" |
  | 9 | WebGL `onContextLoss` → dispose (DOM fallback) | tested | unit `xtermAddons.test.ts` "registers a WebGL onContextLoss handler that disposes the addon" |
  | 10 | Actual visual smear clears on a real GPU + monitor switch | untestable (`requires-physical-device`) | WebGL GPU-context-loss + per-monitor DPR cannot be reproduced headless; real-device smoke = user |

  0 untested-testable behaviors.
- **Confidence-pattern check:** asymptote (depth) — every branch incl. the
  hidden/disposed/unmount/dedupe edges has a pinning test. coverage (breadth) —
  all three events + remount + context-loss. No `cross_component` framework
  machinery touched → no integration-coverage flag.

## Verification
- `npx vitest run` (client) — **160 files / 1668 tests pass**.
- `tsc --noEmit` — clean. `oxlint` — clean (no new findings).
- E2E spec `91-terminal-repaint-on-refocus.spec.ts` — **2/2 pass** in real
  Chromium against an isolated stack (temp USERPROFILE, loopback, no Claude
  spawn). surface=web, exit 0.

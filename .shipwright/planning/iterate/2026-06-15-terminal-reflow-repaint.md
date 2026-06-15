# Iterate Spec — Terminal input-box broken/wrapped after reflow

- **Run ID:** iterate-2026-06-15-terminal-reflow-repaint
- **Intent:** BUG
- **Complexity:** medium (load-bearing WebGL renderer / CLAUDE.md rule 22; follow-up to PR #146; user-requested multi-scenario verification)
- **Spec Impact:** NONE (behavior-restoring bug fix; FR-01.28)
- **Risk flags:** none

## Problem (user follow-up to PR #146)

> "Es ist besser. Aber irgendwie ist das Input Field noch komisch. Das ist
> manchmal sogar weg oder wird komisch umgebrochen." (smaller/second monitor)

Screenshot: Claude's TUI **input box** renders broken — top border gestrichelt/
unvollständig, rounded corners + vertical sides missing, a stray `▯` glyph, and
the task-title (`--name`) cell floating cyan-highlighted mid-border (same
signature as PR #146's "Notifikationen Github" bleed, same spot).

## Root cause (F-debug)

Claude's TUI lives in the **alt-buffer** and redraws **asynchronously** after a
SIGWINCH (our WS `resize` frame). The WebGL renderer's per-cell dirty detection
skips cells whose glyph equals what's already drawn at that screen position — but
a **width change shifts the logical→screen mapping**, so stale glyphs (old box
border, the floating title cell) survive Claude's redraw. This is the same
WebGL partial-dirty class `scroll-repaint.ts` already documents (for scroll).

The gap: **nothing repainted AFTER Claude's async redraw.**
- `onDataChunk` (useReplayDrainGate) does a bare `term.write(chunk)` — no refresh.
- The ResizeObserver path (`resizeAndSend`) sent the resize but never refreshed.
- The focus/visibility path (PR #146) refreshed **synchronously** — BEFORE
  Claude's async redraw lands, so it repaints the pre-redraw frame, not the
  broken post-redraw one.

PR #146 fixed the stale-frame-on-refocus class; this fixes the residual
reflow-of-alt-buffer class.

## Fix

`useTerminalResize.ts` — `POST_RESIZE_REPAINT_DELAYS_MS = [130, 350]`: after
**every dimension change** (a `resize` frame actually sent, on all three paths —
ResizeObserver, tab-activation, focus/visibility) schedule **staggered trailing
`term.refresh(0, rows-1)`** passes that repaint AFTER Claude's async redraw lands
(fast + slow). Reset on each resize; cancelled on unmount; disposed-guarded.
Same remedy `scroll-repaint.ts` uses for the wheel-driven async redraw.

### Alternatives considered
- **Standalone `post-resize-repaint.ts` module** (à la scroll-repaint). Rejected:
  the trailing repaint is gated by the hook's own dedupe state (only fires when a
  resize was actually sent); splitting it out would move that coupling outward
  (cf. ADR-101/103 — don't fragment a cohesive deep module for a line count;
  `terminal/routes.ts` 620 LOC is accepted). Kept in the resize hook; comments
  trimmed to stay ~at the 300-LOC guideline.
- **Force the WebGL renderer to always full-repaint.** Rejected: kills the
  per-cell dirty optimisation (the point of WebGL); the targeted post-resize
  repaint is surgical.

## Confidence Calibration
- **Boundaries touched:** xterm WebGL repaint timing in the resize hook (client).
  No server change; no new IO/env/file boundary.
- **Empirical probes run:**
  - Read `useReplayDrainGate.onDataChunk` → confirmed bare `term.write` with no
    refresh (the missing post-redraw repaint).
  - Confirmed the ResizeObserver path had no `term.refresh` and the focus path
    refreshed synchronously (pre-redraw).
  - Real-browser E2E (spec 92, Chromium): a width change produces a full-viewport
    repaint AFTER the synchronous resize settles.
- **Test Completeness Ledger:**

  | # | Behavior | Disposition | Evidence |
  |---|----------|-------------|----------|
  | 1 | dims-changing ResizeObserver resize → staggered trailing `refresh(0,rows-1)` | tested | unit "a dims-changing resize schedules trailing full-viewport repaints"; E2E 92 |
  | 2 | dedupe no-op resize (unchanged dims) → NO trailing repaint | tested | unit "no trailing repaint when the resize is a dedupe no-op" |
  | 3 | focus with dims change → synchronous repaint + trailing repaints | tested | unit "focus with a dims change adds trailing repaints on top of the synchronous one" |
  | 4 | pending trailing repaints cancelled on unmount | tested | unit "pending trailing repaints are cancelled on unmount" |
  | 5 | trailing timer firing after disposal → no-op | tested | unit "a trailing repaint that fires after disposal is a no-op" |
  | 6 | the actual broken-box clearing in Claude's real TUI on a real GPU/monitor | untestable (`requires-physical-device`) | needs Claude's live alt-buffer TUI + GPU + monitor reflow, not reproducible headless; real-device smoke = user |

  0 untested-testable behaviors.
- **Confidence-pattern check:** asymptote (depth) — every branch incl. dedupe,
  unmount-cancel, disposed-guard pinned. coverage (breadth) — all three resize
  paths + real-browser reflow. No `cross_component` machinery → no
  integration-coverage flag.

## Verification
- `npx vitest run` (client) — **160 files / 1672 tests pass** (incl. 5 new).
- `tsc --noEmit` clean; `oxlint` clean.
- E2E `92-terminal-reflow-repaint.spec.ts` — **1/1 pass** in real Chromium
  (isolated stack, no Claude spawn). surface=web, exit 0.

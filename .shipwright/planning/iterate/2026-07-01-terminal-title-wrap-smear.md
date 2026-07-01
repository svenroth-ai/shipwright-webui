# Iterate — BUG: terminal input title-wrap smear ("Der" → "D er")

- **run_id:** `iterate-2026-07-01-terminal-title-wrap-smear`
- **intent:** bug · **complexity:** medium · **spec impact:** NONE (restores FR-01.28's intended faithful rendering; no spec-text change)
- **FR:** FR-01.28 (Embedded terminal — pty + WebSocket + rendering)

## Symptom

In the embedded terminal, with a **long task title**, at a **half-screen (narrow) pane**, the Claude Code input area smears: the title-pill banner wraps and the first character of the first word lands on the `>` prompt row (e.g. "Der" → "D er"). Intermittent; persists across resize / tab-switch / typing until a clean redraw.

## Root cause (evidence-backed)

- The cyan block above the prompt is Claude Code's own **session-title pill** — it emits `\x1b[30m\x1b[46m<title>\x1b[49m──` (black-on-ANSI-cyan `#22D3EE`), verified in the raw pty scrollback (`d7a7ef2d.log` byte 708051). Pixel sample of the artifact = `(34,211,238)` = ANSI cyan **background**, NOT the selection layer (brown `#6b5e56`) and NOT a WebGL framebuffer smear — so `term.refresh()` (the #146/#167/#175 fixes) cannot heal it.
- The pty is spawned at a **hardcoded 120 cols** (`server/src/terminal/pty-manager.ts` `opts.cols ?? 120`; `ws-upgrade-handler.ts` calls `spawn()` with no cols). The client's real (narrower) width reaches the pty only via a 250 ms-throttled `resize` that **races** the auto-launch.
- When `claude … --name "<long title>"` runs before the real width is applied, Claude lays its width-sensitive banner out for 120 cols; on a narrower xterm grid that ~116-col line **auto-wraps one extra row**, shifting every subsequent cursor-addressed line up one → the title's first char collides onto the `>` row. Headless replay proved a *consistent*-width stream renders clean at every width 116–140 → the defect requires a **width transition between Claude's incremental redraws** (pty↔xterm column desync).

## Fix

1. **Pre-launch size sync (primary).** `useAutoLaunch` gains `onBeforeDispatch`, called on the same ordered WS immediately before BOTH launch data-frame writes (auto-inject + manual-send). `EmbeddedTerminal.syncSizeNow` = `safeFit` + `send({type:"resize", cols, rows})` — so the pty is at the client's real width before Claude renders. WS ordering + synchronous `pty.resize` guarantee the resize applies before the command.
2. **Post-replay writer convergence.** After a `replay_snapshot` settles, a WRITER re-converges its xterm (temporarily resized to the snapshot's serialized width) back to the real container width and pushes the matching resize — closing the "xterm stranded at snapshot cols ≠ Claude's render width" divergence on re-attach. **Writer-gated** (via a render-body role ref) so a reader keeps the snapshot width and #150 (reader-reflow) is preserved.

## Confidence Calibration

- **Boundaries touched:** WS resize/data frame ordering (client→pty); xterm FitAddon ↔ pty cols; replay-snapshot width path.
- **Empirical probes run:**
  - Pixel-sampled the artifact → `#22D3EE` ANSI-cyan **background** (not selection/GL smear).
  - Decoded raw pty scrollback → confirmed Claude emits the `\x1b[46m` title pill with hard `CR/LF` wraps.
  - Headless `@xterm/headless` replay of the captured stream at cols 116–140 → clean at every consistent width (⇒ defect is a width-transition, not a static-width render).
  - Real-browser E2E (chromium, isolated stack) → a `resize` frame is the tx frame immediately before the launch data-frame, <150 ms before it.
- **Test Completeness Ledger:** 6 behaviors `tested` (unit + E2E), 1 `untestable` (`requires-manual-visual-judgment` — the live glyph outcome needs an authenticated Claude TUI + long title + narrow pane; user validates). `untested_testable = 0`. Full block in `shipwright_test_results.json.iterate_latest.test_completeness`.
- **Confidence-pattern check:** depth — the fix targets the *width desync* root cause (not another `term.refresh` band-aid on the GL-smear class); breadth — both entry paths (launch, replay re-attach) + the reader-regression (#150) are covered by deterministic tests; no `cross_component` machinery touched (no integration-coverage requirement).

## Verification

- Unit: full client suite **1817 passed**; new deterministic tests — `useAutoLaunch.sizesync.test.ts` (2), `useReplayDrainGate.test.tsx` post-replay (1), `EmbeddedTerminal.test.tsx` writer-converges / reader-skips (2). typecheck + lint clean.
- E2E: `terminal-title-wrap-size-sync.spec.ts` **1 passed** (real browser, isolated stack).
- External adversarial review: no HIGH; one MEDIUM (writer→reader handoff role-staleness) fixed by render-body role ref + the reader-skip guard test.

## Follow-up (out of scope)

- The pure reflow-mid-live-session case (aggressive resize while Claude is already correct) relies on Claude's SIGWINCH full redraw; if artifacts persist there, a separate webui-side heal is a follow-up.
- Definitive visual confirmation ("no D-er") is a user check in the live webui (isolated stack has no Claude auth).

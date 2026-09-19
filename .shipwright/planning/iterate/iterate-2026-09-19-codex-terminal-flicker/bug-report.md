# Bug report (small-complexity BUG iterate — no formal spec file)

## Symptom (user report, 2026-09-19)
When a task runs under the Codex runtime, the embedded terminal (xterm.js
pane) visibly flickers: two checkmark-looking glyphs repaint in the input
box area ("Ask Codex to do anything"), and a region three lines further up
also repaints. Not observed with the Claude runtime's embedded terminal.

## Investigation

### Ruled out first
- **Not a webui resize artifact.** `useTerminalSizeSync` only fires once
  before launch and once after a replay settles — not a repeating loop.
  Confirmed independently: the repro below never resizes the pty at all
  (fixed 120×30 for its whole life) and still reproduces the symptom.
- **Not DO-NOT #28 (WebGL glyph-atlas corruption).** The default renderer
  is DOM (no atlas exists to corrupt), and the symptom does not depend on
  scrolling or GPU state.
- **Not DO-NOT #29 (Claude's CUF differential-repaint stale-cell bug).**
  That mechanism needs a snapshot restore / reconnect and a producer that
  *skips* cells with `ESC[nC`. This reproduces on Codex's very first live
  render, no reconnect involved, and Codex's writes are not CUF-skips —
  they are ordinary cursor-addressed rewrites of correct content.

### Reproduction (isolated from the webui entirely)
Spawned `codex.cmd` directly via `@lydell/node-pty` (the same pty library
`server/` depends on) in a bare PowerShell shell, 120×30, capturing every
`pty.onData()` chunk with a wall-clock timestamp. No webui server, no
client, no WebSocket — just Codex's raw output stream.

Findings from the captured byte stream:
1. Codex correctly uses DEC private mode 2026 (Synchronized Output,
   `\x1b[?2026h` … `\x1b[?2026l`) around some of its updates (observed
   around cursor-style changes, `\x1b[0 q`).
2. On startup, Codex performs **~9 partial box-relayout redraws** —
   redrawing/repositioning its `╭─…─╮` input-box border and the `>_`
   prompt glyph, moving the box's row position (row 7 → 8 → 16 → 18 in one
   capture) — spread over **~0.2 to ~2 real seconds**. Every one of these
   nine writes is **emitted OUTSIDE any `2026h`/`2026l` bracket.**
3. This happens identically with `--disable in_app_updates` (no "Update
   available!" banner at all), so the relayout storm is not specifically
   caused by the update-checker UI — it is Codex resolving other startup
   state (model info, MCP init, etc.) and redrawing incrementally as each
   piece resolves.
4. Because the gaps between some of these writes exceed a browser's
   16 ms animation-frame budget by 10–40×, xterm.js (or any terminal)
   necessarily renders each intermediate box position as its own visible
   frame — there is no batching window that could coalesce them without
   adding hundreds of milliseconds of artificial lag to all terminal
   output.

### Root cause (part 1 — startup box reflow)
Codex CLI 0.155.0's TUI does not wrap its startup box-relayout sequence in
Synchronized Output, unlike some of its other updates. xterm.js 6.0
correctly implements DECSET 2026 (`_syncOutputHandler`, confirmed in the
pinned bundle) and would batch this cleanly if Codex wrapped it — the gap
is in what Codex emits, not in how xterm.js or this project's pty relay
handle it. `pty-manager.ts` forwards every `pty.onData()` chunk immediately
by design (rule 7 — no SSE, sequential relay, no server-side buffering),
so the terminal faithfully shows Codex's own multi-step redraw in real
time, exactly as a native terminal running `codex` directly would.

### Reproduction, part 2 — a live turn (not just startup)
The first repro only ran through startup and idle. A second, more
realistic repro (`codex-pty-repro2.mjs`) sent an actual prompt and
captured a full turn. That capture showed a second, independent,
*recurring* redraw source during "thinking": Codex updates the terminal
title (an OSC 0 sequence carrying a Braille spinner glyph,
`⠙⠹⠸⠼⠴⠦⠧⠇⠏⠋…`) plus a periodic status-widget repaint roughly **every
~108ms** for the full duration of the turn — this is what the user
actually sees as the "nervig" (annoying) recurring flicker, not the
one-time startup reflow.

### Fix found: `-c tui.animations=false`
Codex exposes an upstream config key, `tui.animations` (confirmed via
`openai/codex` issues #45564 and #46111), that gates exactly this
decorative animation/spinner path. A third repro
(`codex-pty-repro3.mjs`), run as an A/B against the same live-turn
scenario, confirmed:
- **Without** the flag: ~1 title-spinner/status-redraw chunk every
  ~108ms for the whole turn.
- **With** `-c tui.animations=false`: **zero** such chunks — the
  recurring flicker is eliminated.

It does **not** touch the startup box reflow (still ~9 redraws over
~0.2–2s on launch) — that remains a separate, unfixed upstream mechanism
(root cause part 1, above), matching `openai/codex#39268`'s description
of per-row `queue!(writer, Print("\r\n"))` writes defeating batching at
the Rust source level.

**Known trade-off** (`openai/codex#45564`, upstream bug): with animations
off, the elapsed "Working Xs" counter in the status widget freezes until
the terminal is hidden/shown again. A frozen decorative counter was judged
preferable to continuous flicker on every turn.

### Implementation
`server/src/core/launcher-codex.ts`: `renderCodex()` now appends
`-c tui.animations=false` to every Codex launch (fresh and resume), via a
new `buildTuiAnimationFlags()` helper. Reversible per-launch via
`SHIPWRIGHT_CODEX_TUI_ANIMATIONS=0`, mirroring the existing
`SHIPWRIGHT_TERMINAL_NO_FLICKER` opt-out contract
(`server/src/terminal/spawn-env.ts`) for anyone who wants the elapsed
timer back more than they want the flicker gone. Claude-runtime launches
(`launcher.ts`) are untouched — `renderCodex()` is only reached when
`runtimeForTask(task) === "codex"`.

Documented as CLAUDE.md DO-NOT #32 (updated) so the startup-reflow half of
this symptom — still unfixed — is recognized immediately rather than
re-investigated as a #28/#29 regression, and so the fixed half is not
re-attempted from scratch.

## Recommendation
File upstream with `openai/codex` if the startup box reflow needs fixing
at the source (wrap it in `\x1b[?2026h`…`\x1b[?2026l`, matching the
synchronized-output discipline Codex already uses elsewhere in the same
TUI).

## Spec impact
NONE — Codex CLI launch-flag addition only, no webui-observable behavior
contract changes (the terminal already relays whatever the launched
process emits).

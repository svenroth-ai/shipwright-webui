# ADR-132 — Touch-scroll routes by xterm buffer type: alt-buffer → pty keystrokes, normal-buffer → scrollLines

**Date:** 2026-06-07
**Run-ID:** iterate-2026-06-07-fix-touch-scroll-pty-keystrokes
**Section:** Iterate — bug-fix: touch-scroll inside Claude Code TUI / alt-screen TUIs
**Architecture impact:** component
**Status:** Implemented + tested. Follows ADR-131 / PR #110 (diagnosis).

---

## Context

ADR-131 (PR #110) empirically proved that `term.scrollLines()` is a no-op inside the xterm.js alternate-screen buffer. Claude Code runs in alt-screen by default (CLAUDE.md rule 22 / ADR-095: `CLAUDE_CODE_NO_FLICKER=1` ON), so the touch-scroll handler from PR #61 (ADR-129) silently produced no scroll motion while Claude's TUI was foregrounded — even though both code paths (mouse-wheel and finger-pan) reached the same `term.scrollLines()` call. The diagnosis iterate added three bench tests with a real `@xterm/xterm` Terminal in jsdom that documented this failure mode.

This iterate implements the production fix on top of that empirical floor.

The hypothesis that arrow-key keystrokes scroll TUIs in alt-screen is empirically supported by the canonical xterm.js behavior: in alt-buffer with no mouse-tracking mode active, wheel events are translated to Cursor-Up/Down keystrokes sent to the pty (the same pattern vim / less / htop rely on for wheel-scroll). We replicate that translation for touch pan-delta.

## Decision

`attachTouchScroll` (`client/src/components/terminal/touch-scroll.ts`) gains an optional `sendData?: (data: string) => void` callback in its `TouchScrollDeps`. A new internal helper `routeScroll(term, lines, sendData)` reads `term.buffer.active.type` and branches:

- **`alternate`** — if `sendData` is provided, emit Cursor-Down (`\x1b[B`) × `lines` for downward pans or Cursor-Up (`\x1b[A`) × `|lines|` for upward pans, then call `sendData(seq)`. If `sendData` is absent the call is a clean no-op (no fallback to `term.scrollLines`, which would itself be a no-op there — explicit absence is the cleaner contract).
- **`normal`** — call `term.scrollLines(lines)` as before (preserves the PR #61 behavior).

`EmbeddedTerminal.tsx:215` wires `sendData` to `(payload) => socket.send({type:"data", payload})` — the same WS data-frame path used by `term.onData` for user keystrokes (line 224, 6 lines below). No new socket allocation, no new envelope type, no transport-layer change. The wire-up is 3 LOC plus a 6-line comment block referencing ADR-132 + ADR-131 + ADR-095.

The four bench assertions in `touch-scroll.alt-buffer.test.ts` were updated to invert into regression guards:

1. Unchanged — xterm buffer state-machine: DECSET 1049 flips `buffer.active.type` to `"alternate"`.
2. Unchanged — xterm buffer state-machine: `scrollLines(-10)` moves `viewportY` in normal-buffer but not in alt-buffer.
3. **INVERTED** — alt-buffer pan: `term.scrollLines` MUST NOT be called; `sendData` receives the concatenated arrow-key sequence with exactly `|lines|` repeats.
4. **NEW** — normal-buffer pan: `term.scrollLines` IS called with the line count; `sendData` is NOT invoked. Preserves PR #61 behavior under the new branch.
5. **NEW** — absent `sendData` in alt-buffer: clean no-op (no throw, no scrollLines fallback). Defense-in-depth for test ergonomics.

The mock-Terminal cohort in `touch-scroll.test.ts` was extended with `buffer: { active: { type: "normal" } }` so the new `routeScroll` branch resolves cleanly; the existing 15 assertions about pixel→line accumulation and listener disposal are unchanged.

## Rationale

**Why arrow keystrokes and not SGR mouse-wheel?** The arrow-key path is the safer default. SGR mouse-wheel (`\x1b[<64;col;rowM` / `\x1b[<65;col;rowM`) requires the TUI to have enabled SGR mouse tracking (`?1006h`). Claude's TUI does not consistently enable that mode (it varies by build / Claude Code version), so wheel-mode is a brittle target. Arrow keystrokes are universal and degrade well — if a TUI happens to bind `\x1b[A` to history-up in some prompt mode, the worst case is a benign no-op or a single arrow being inserted. Pan-scrolling already moves multiple lines at once, so even an unexpected arrow press is recoverable (the user can tap once to cancel a wrong-direction press). The implementation leaves room for a later SGR mouse-wheel variant guarded by `mouseEventsActive` from `useTerminalSelection`.

**Why no PgUp / PgDn fast-scroll yet?** YAGNI. Pan-delta produces ≤ ~5 lines per touchmove event in practice (60 fps + typical finger velocity). Long pans accumulate the per-event arrow sequences without UX cost. If profiling shows long pans burning frame budget on `socket.send` calls we can batch ≥5-line deltas into a single `\x1b[5~` / `\x1b[6~` (PgUp / PgDn) — but until that signal exists, simpler is better.

**Why `sendData` as an option rather than a required dep?** Two reasons. (1) Unit-test ergonomics — the mock-Terminal cohort in `touch-scroll.test.ts` only exercises the normal-buffer path, so requiring `sendData` would force every test to wire it up for no gain. (2) Defense-in-depth — if a future caller forgets to wire it, the result is a silent no-op (matching the pre-fix behavior) rather than a runtime exception that would break the entire terminal mount-effect.

## Consequences

- **Production behavior change:** One-finger pan now scrolls Claude's TUI (and every other DECSET-1049 alt-screen TUI: vim, less, htop, …). Normal-buffer (bare shell prompt) behavior is unchanged.
- **Diff size:** 4 files touched; production code change is ~15 LOC (the `routeScroll` helper + the EmbeddedTerminal wire-up). All under the 300-LOC file ceiling.
- **Test surface:** mock-Terminal cohort 15/15 + alt-buffer cohort 6/6 = 21/21 green (was 18/18 after PR #110). Full client suite 1556/1556 across 149 files (+3 from the previous baseline 1553 — three new alt-buffer tests minus three superseded ones from PR #110).
- **No new architecture surface:** `socket.send` already carries `term.onData` keystrokes; touch-scroll re-uses that path. The pty-manager whitelist (ADR-067) is unchanged. CLAUDE.md DO-NOT regression guards 17–22 untouched.
- **Regression-guard:** The 6 alt-buffer assertions land in main as a permanent guard against future code that calls `term.scrollLines` unconditionally in the touch path.
- **iPad UAT outstanding:** Real-device verification on iPad is the post-deploy gate. The bench cohort proves the routing semantics in CI; the device proves the user-visible motion + that Claude's TUI consumes the arrow keystrokes the way `vim` and `less` do.

## Rejected alternatives

1. **Send SGR mouse-wheel escape (`\x1b[<64;col;rowM`) instead of arrow keys.** Rejected as the default because SGR mouse tracking is opt-in by the TUI (`?1006h`) and Claude Code does not consistently set it. The arrow-key path works against any line-oriented TUI. SGR mouse-wheel could be added later, gated on `mouseEventsActive` from `useTerminalSelection`.

2. **PgUp / PgDn for fast-scroll on long pans.** Rejected as YAGNI. Per-frame socket sends of 1–5 arrow sequences are not measurably expensive. If frame-budget profiling later flags it, batch ≥5-line deltas into `\x1b[5~` / `\x1b[6~`.

3. **Branch on `term.options.altScreen` or a state flag exposed at mount.** Rejected — that value is set during construction; the buffer the parser is currently in (`buffer.active.type`) is the only thing the runtime cares about, and it's the one xterm.js itself exposes for this exact purpose.

4. **Require `sendData` (drop the optional `?`).** Rejected — see Rationale above. Optional fits the unit-test ergonomics and degrades to the pre-fix no-op rather than a hard failure if a caller forgets to wire it.

5. **Detect `buffer.active.type` at gesture-start (in `onTouchStart`) instead of per-`touchmove`.** Considered but rejected. A multi-second pan could straddle a buffer switch (the user presses `q` to quit Claude mid-pan and ends up in normal-buffer with arrow-keys mid-flight). Per-touchmove resolution costs O(1) — `term.buffer.active.type` is a property accessor, not a search — so the safer correctness wins.

## Follow-up

- **iPad UAT post-deploy** — the only outstanding empirical gate. Three states: (a) bare shell prompt (normal-buffer; pan scrolls scrollback), (b) Claude TUI active (alt-buffer; pan scrolls Claude's view), (c) Claude exits back to shell (normal-buffer again).
- **Memory entries** — none specifically required by this iterate; the diagnosis-iterate's ADR-131 + PR #110 already pinned the buffer-type knowledge. Consider adding a memory entry for future maintainers if a similar buffer-aware branch is needed elsewhere in the terminal subsystem.

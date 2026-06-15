# ADR-133 — Touch-scroll replicates the mouse wheel: a synthetic WheelEvent on `term.element`, not hand-rolled arrow keys

**Date:** 2026-06-15
**Run-ID:** iterate-2026-06-15-touch-scroll-wheel-events
**Section:** Iterate — bug-fix: one-finger touch-scroll navigates Claude's input history instead of scrolling
**Architecture impact:** component
**Status:** Implemented + unit-tested. iPad UAT is the post-deploy gate. **Supersedes ADR-132** (and the diagnosis ADR-131 it built on).

---

## Context

User report 2026-06-15 (iPad, Safari, current build): one-finger touch in the embedded terminal does **not** scroll Claude's TUI. Instead it *"iteriert durch die letzten Inputs durch"* — it cycles through the last prompts. The mouse wheel and the two-finger Magic-Keyboard trackpad scroll correctly in the same context.

This is the third user-visible failure of touch-scroll in Claude's TUI (PR #61 → ADR-131 diagnosis → ADR-132 fix → still broken). The pattern `feedback_stop_stacking_patches` warns about applies, so this iterate traced the **actual xterm.js 6.0 source** before touching anything rather than guessing again.

### Root cause (traced through `@xterm/xterm` 6.0)

ADR-132 routed an alt-screen-buffer pan to **raw arrow-key escapes** (`\x1b[A` / `\x1b[B`) sent down the pty, on the theory that "alt-screen TUIs scroll on arrow keys" — true for `vim` / `less` / `htop`. But:

- **Claude Code runs in the alt-screen buffer** (CLAUDE.md rule 22 / ADR-095, `CLAUDE_CODE_NO_FLICKER=1` default-ON) **and binds Up/Down to input-history navigation**, not viewport scroll. So the arrow burst cycled the last prompts — exactly the symptom.
- **Claude enables mouse tracking.** xterm puts `enable-mouse-events` on `term.element` and, per `Viewport.ts:65-70`, *disables* the scrollback wheel-handler when the active mouse protocol includes WHEEL. A real mouse wheel is then encoded as a **mouse-report** (button 64/65) in `CoreBrowserTerminal.bindMouse` (`sendEvent` → `triggerMouseEvent`) and Claude consumes that to scroll. That is *why the mouse works and the hand-rolled arrows do not* — they take different code paths, and only one is the path Claude listens to.

## Decision

Stop hand-rolling. Make a finger-pan **replicate the mouse / trackpad** by dispatching a synthetic `WheelEvent` onto `term.element`, and let xterm encode it. By construction the bytes reaching the pty are identical to the wheel that already works.

`routeScroll` (in `client/src/components/terminal/touch-scroll.ts`) now branches:

- **mouse-tracking active (`.enable-mouse-events`) OR alt-screen buffer** → forward the touchmove's **raw pixel delta** as a pixel-mode `WheelEvent` (`deltaMode = 0`, `deltaY = deltaPx`, `clientX/clientY` = finger position) on `term.element`. xterm's own handlers then do exactly what they do for a two-finger trackpad scroll:
  - mouse-tracking on → mouse-report in the app-negotiated protocol/encoding (Claude scrolls);
  - mouse-tracking off (vim/less in alt-screen) → xterm converts the wheel to Cursor-Up/Down itself, honouring application-cursor-keys mode (`\x1bOA` vs `\x1b[A`) — which the hand-rolled path got wrong;
  - xterm's `CoreMouseService.consumeWheelEvent` does the trackpad-style sub-line accumulation, so the *feel* matches the trackpad the user already likes.
- **normal buffer, no mouse tracking** → unchanged `term.scrollLines(lines)` via the `consumeTouchDelta` accumulator (the scrollback scroller lives on a *descendant* of `term.element`, unreachable by a root-dispatched wheel, so `scrollLines` stays the right primitive).

Defensive: if `term.element` is null (pre-open) we fall back to the scrollLines path — never a throw.

The `sendData` dep (the ADR-132 socket coupling) is **removed** from `TouchScrollDeps` and the `EmbeddedTerminal` wire-up; touch-scroll no longer touches the WS socket.

## Test strategy

- The ADR-131/132 alt-buffer cohort assertions (which expected `sendData` arrow escapes) are **inverted**: a mock `term` exposing a real `element` proves the pan dispatches a `WheelEvent` on `term.element` with the correct `deltaY` sign + pixel `deltaMode`, that `scrollLines` is *not* called in the mouse-active / alt-buffer cases, and that the finger coords flow into the event. The two real-`@xterm/xterm` buffer-state guards (DECSET 1049 flips to "alternate"; `scrollLines` is a no-op there) are kept — they are the empirical floor that justifies routing away from `scrollLines`.
- The byte-level mouse-report encoding is xterm's own (well-tested) code and needs a live renderer (`getMouseReportCoords` requires valid char size), which jsdom lacks. **iPad UAT is therefore the end-to-end gate** — the same gate ADR-131/132 flagged. The unit layer proves our routing decision; only the device proves Claude consumes the wheel the way the mouse already does. Scroll *speed* may need a one-line `scrollSensitivity` tweak after device testing.
- Full client suite green (1696/1696, 166 files); terminal cohort 251/251; typecheck + lint clean.

## Consequences

- **Production behavior change:** one-finger pan now scrolls Claude's TUI (and every mouse-tracking or alt-screen TUI) identically to the mouse/trackpad. Normal-buffer scrollback unchanged.
- **Diff:** `touch-scroll.ts` (rewrite of the routing tail), `EmbeddedTerminal.tsx` (drop `sendData`), `touch-scroll.alt-buffer.test.ts` (inverted cohort). All files < 300 LOC.
- **Decoupling:** touch-scroll no longer references the WS socket — the brittle arrow/SGR guessing is deleted.
- **Regression guard:** the inverted cohort fails if any future code reintroduces an unconditional `scrollLines` or arrow-key path in the touch handler.

## Rejected alternatives

1. **Hand-rolled SGR mouse-wheel sequences (`\x1b[<64/65;col;rowM`).** Considered (it is directly byte-assertable in unit tests) but rejected: it assumes Claude uses SGR (1006) encoding — if Claude negotiated another encoding it would break a *fourth* time. Delegating to xterm's encoder is guaranteed to match the working mouse path whatever the encoding.
2. **Line-notch wheel events (`deltaMode = LINE`, one per cell-row).** Rejected in favour of forwarding raw pixel deltas: notches risk over-scroll if Claude scrolls N lines per notch, and pixel deltas reproduce the trackpad feel the user explicitly likes (xterm self-tunes via `consumeWheelEvent`).
3. **Dispatch on `screenElement` / let xterm handle scrollback too.** Rejected: the normal-buffer scrollback scroller is a VS-Code `SmoothScrollableElement` whose synthetic-wheel handling is less certain; `scrollLines` already works there, so leave it untouched and only route the alt/mouse cases through the wheel.
4. **Branch on `term.buffer.active.type` alone (ADR-132's gate).** Insufficient: a TUI can enable mouse tracking in the normal buffer too; the decisive signal is mouse-tracking-active, with alt-buffer as the secondary trigger for no-mouse TUIs.

## Follow-up

- **iPad UAT post-deploy (gate):** (a) bare shell prompt → pan scrolls scrollback; (b) Claude TUI active → pan scrolls Claude's view (no history cycling); (c) `vim`/`less` → pan scrolls the pager. Tune `scrollSensitivity` if the speed is off.
- Memory: `project_terminal_touch_action_none_for_touchscroll` updated with the wheel-replication root cause + the arrow-keys-are-history-nav lesson.

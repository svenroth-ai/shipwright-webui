# ADR-131 — Touch-scroll resolves to a no-op inside DECSET-1049 alt-buffer (Claude Code TUI)

**Date:** 2026-06-07
**Run-ID:** iterate-2026-06-07-fix-touch-scroll-alt-buffer
**Section:** Iterate — bug-fix diagnosis: embedded-terminal touch-scroll alt-buffer no-op
**Architecture impact:** none
**Status:** Diagnosis confirmed; fix routes through follow-up iterate.

---

## Context

PR #61 (ADR-129, 2026-05-25) shipped `client/src/components/terminal/touch-scroll.ts`, which translates one-finger pan into `term.scrollLines()` calls. User-reported follow-up 2026-06-07:

> "touch (scrolling) des Keyboards hat nicht funktioniert. das meine ich, geht nur mit Maus."

— scrolling does not work during an active Claude session even though the same code path works at the bare shell prompt.

The relevant invariants:

- **CLAUDE.md rule 22 + ADR-095** keep `CLAUDE_CODE_NO_FLICKER=1` default-ON.
- **ADR-095** documents that Claude Code with that flag renders into the xterm.js alternate-screen buffer.
- **ADR-096** confirms the entry/exit semantic: Claude emits `DECRST 1049` on exit, so entry is `DECSET 1049` — the standard `?1049h` private-mode toggle.

The xterm.js alternate buffer has no scrollback by definition: `buffer.length == rows`. `term.scrollLines(n)` operates by moving the viewport within the active buffer's scrollback; with no scrollback present, the call resolves with no viewport motion.

PR #61 passed CI green because its `touch-scroll.test.ts` mock-Terminal pattern (`scrollLines: vi.fn()`) only records call shape — it cannot model buffer-type behavior. The bug shape is exactly what `feedback_external_code_review_catches_high_bugs` in memory warns about: an empirically-incomplete test surface that confirms reachability while missing the semantic outcome.

## Decision

**Diagnosis-only iterate.** No production code changes in this iterate.

Add `client/src/components/terminal/touch-scroll.alt-buffer.test.ts` — three vitest cases that instantiate a real `@xterm/xterm` `Terminal` inside jsdom (no `term.open()`; the buffer state-machine runs synchronously on `write()` without a renderer) and empirically demonstrate:

1. `term.write("\x1b[?1049h")` flips `term.buffer.active.type` from `"normal"` to `"alternate"`.
2. `term.scrollLines(-10)` moves `buffer.active.viewportY` in the normal buffer (sanity baseline) but produces **no** motion in the alt buffer.
3. `attachTouchScroll` wired to a real alt-buffer xterm still routes touch-pan through `term.scrollLines` — the structural defect.

These assertions PASS with the broken code on purpose. They document the current failure mode so the follow-up iterate (`iterate-2026-06-07-fix-touch-scroll-pty-keystrokes`) inherits an inversion target instead of a hand-authored RED test that might miss the same buffer-type dimension.

Split the original `touch-scroll.test.ts` is left at 200 LOC (mock-Terminal cohort only); the real-xterm cohort lives in its own file (117 LOC), per memory `feedback_bloat_retirement_split` (cohesive file-level extraction, not per-handler).

## Rationale

**F-debug Iron Law**: "NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST." PR #61 (5 weeks prior) is an empirical example of the failure mode the constitution warns about — a mock pattern that didn't model the SUT semantic and shipped green. Reproducing the bug in CI BEFORE designing the fix means the next iterate inherits a passing-into-failing test instead of a hand-authored RED test that might miss the same dimension a second time.

Doc/test-only PR keeps main reversible (zero behavior change) while pinning the knowledge in tests + ADR. The user's instruction was explicit ("Erst nur Repro/Diagnose, kein Fix in dem Iterate") and the memory reflex `feedback_stop_stacking_patches` reinforces the discipline: investigate empirically before patching.

## Consequences

- **Tests added:** `touch-scroll.alt-buffer.test.ts` (117 LOC, 3 cases).
- **Tests reorganized:** `touch-scroll.test.ts` trimmed back to 200 LOC (mock-Terminal cohort only).
- **Suite status:** 18/18 client unit tests under `terminal/touch-scroll`. Full client suite still green: 1553/1553 across 149 files.
- **Production behavior:** unchanged; touch-scroll inside an active Claude TUI session remains broken until the follow-up iterate lands.
- **Tooling discovery:** real-xterm.js in jsdom is a viable test substrate. The Canvas `getContext` not-implemented warnings xterm emits during construction are jsdom noise, harmless — the parser runs synchronously and buffer state is observable without `term.open()`. Future tests that need to model alt-buffer behavior or DEC-private modes can reuse this pattern.
- **Follow-up iterate has a clear inversion target:** three `expect()` calls flip from "reach `scrollLines`" to "reach `send()`" (the pty-data path).

## Rejected alternatives

1. **Patch + ship in one PR.** Rejected because the load-bearing hypothesis (arrow-key keystrokes scroll Claude's TUI in alt-buffer) has not been empirically verified on a real device. iPad UAT is the gate before the fix iterate's GREEN; shipping the fix without that verification would risk a third round of "tests green, device broken."

2. **Playwright spec instead of vitest+real-xterm.** Rejected because the WebSocket roundtrip adds no signal — the bug is a single-method-call branch (`term.scrollLines` vs `socket.send({type:"data"})`), not an integration concern. Vitest+real-xterm is faster, deterministic, and CI-native.

3. **Manual UAT on iPad as the sole verification.** Rejected because that does not produce a regression guard. A bench test that ships in main does.

## Follow-up

`iterate-2026-06-07-fix-touch-scroll-pty-keystrokes` (to be opened next):

- Invert the three alt-buffer assertions:
  - assertion 3 → `scrollLines` MUST NOT be called in alt-buffer
  - new assertion → `send` callback receives the expected escape sequence (`\x1b[A` × n for up-pan, `\x1b[B` × n for down-pan)
- Extend `attachTouchScroll` signature with a `send: (payload: string) => void` callback wired through `EmbeddedTerminal.tsx:215` to the existing `socket.send({type:"data", payload})` path.
- Branch on `term.buffer.active.type`: alt-buffer → keystrokes via send; normal-buffer → existing `term.scrollLines(lines)`.
- iPad UAT in F0.5: real device, three states (pre-Claude shell / Claude TUI active / post-Claude shell), confirm scroll lands in each.

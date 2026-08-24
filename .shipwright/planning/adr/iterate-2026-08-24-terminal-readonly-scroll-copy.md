# ADR: Reader-role WS connections may send SGR mouse reports to the shared pty

**Run:** iterate-2026-08-24-terminal-readonly-scroll-copy
**FR:** FR-01.28 (Embedded terminal)

## Context

Bug report (verbatim, translated from German): "When the terminal is currently
read-only — for example because the task is open elsewhere, in another
browser — it no longer allows scrolling and it no longer allows copying
either. Can you please fix that? It should be read-only, not frozen."

Root cause, established empirically rather than assumed: I probed 12 real
production scrollback snapshots at `~/.shipwright-webui/terminal-scrollback/*.snapshot`.
All 12 showed `?1049h` (alternate screen buffer) = 1 and `?1003h` (any-event
mouse tracking) = 1. Claude Code's live TUI therefore always runs the alt-screen
buffer with the most aggressive mouse-tracking mode. Two consequences follow:

1. xterm holds **no local scrollback at all** while alt-screen is active, so
   `term.scrollLines()` is structurally a no-op — there is nothing local to
   scroll.
2. xterm forwards `mousedown`/`mousemove` as SGR reports instead of starting a
   native DOM text selection, so **selection-for-copy is also implemented by
   Claude reading mouse reports from its own stdin**, not by the browser.

Both scroll and copy are therefore driven entirely by SGR mouse reports
reaching the pty's stdin. The server's writer gate dropped every
`{type:"data"}` message from a non-writer WS connection — including these
reports — so a genuine second viewer (a task open read-only in another
browser/tab) could neither scroll nor copy. It read as frozen, not merely
read-only, exactly matching the bug report's own framing.

## Decision

Classify an outbound SGR mouse report into its own wire envelope
(`{type:"mouse", payload}`, `client/src/components/terminal/terminal-mouse-report.ts`)
distinct from `{type:"data"}`. The server
(`server/src/terminal/ws-upgrade-handler.ts`) re-validates the payload shape
itself — it never trusts the client's own `"mouse"` tag — and forwards a
well-formed report to the shared pty (`PtyManager.writeMouseReport`) for
**both** writer and reader roles, ahead of the writer gate. A real keystroke
still classifies as `{type:"data"}` and stays writer-gated exactly as before;
this was proven with a real-browser E2E spec
(`client/e2e/flows/104-terminal-reader-scroll-copy.spec.ts`) that opens a
second, genuinely-reader WS connection and asserts the `mouse` frame is
honoured while a `data` frame on the same connection is still refused.

## Consequences

A reader can now scroll and trigger Claude's own OSC 52 clipboard-copy relay
while read-only — the user's own request ("read-only, not frozen"). Because
the TUI's scroll position is server-side pty state (there is no per-client
view), a reader's scroll gesture also moves the writer's live view. This is an
accepted, narrowly-scoped trade-off: it is the only mechanism that makes
reader scroll/copy possible at all inside an alt-screen TUI, and it stays
bounded to well-formed SGR button/coordinate frames (server-re-validated),
never to real keystrokes or paste. `writeMouseReport` deliberately does not
latch `hadDataWritten`, so a scroll/select gesture cannot fool the
reused-pty "had prior writer" heuristic that other code paths rely on.

## Rationale

Root-caused from real production snapshot evidence, not assumption. A
falsification harness (stash the fix, re-run the new/changed server tests)
proved the new guards are real fences rather than vacuously green: all 5
targeted tests failed on the reverted code
(`mgr.writeMouseReport is not a function`, a parse-table row expecting `true`
returning `false`, and two assertions expecting `0` calls that instead
recorded the call) before passing again once the stash was restored.

## Rejected alternatives

- **A client-only scrollback buffer.** Rejected — it cannot exist, because
  xterm carries no rows at all while the alt-screen buffer is active; there is
  nothing local to scroll back through.
- **Relaxing the writer gate for every `{type:"data"}` frame from a reader.**
  Rejected as far too broad — it would let a reader type into the shared
  shell, defeating the entire point of the read-only role, not just unblock
  scroll/copy.

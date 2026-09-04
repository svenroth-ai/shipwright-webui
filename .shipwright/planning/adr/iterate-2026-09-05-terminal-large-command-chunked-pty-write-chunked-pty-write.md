# ADR: Chunk pty.write() to stop the macOS large-command hang

## Amendment (post code-review)

The Stage-2 `code-reviewer` pass found two HIGH-severity issues in the first
draft, both fixed in the same commit before F0:

1. **Unclamped chunk size could hang.** `chunkUtf8ForPtyWrite` never
   validated `maxBytes`; a `ptyWriteChunkBytes` of 0 or negative would spin
   the chunking loop forever — the exact failure class this ADR exists to
   eliminate, just triggered by a config value instead of an oversized
   burst. Fixed by clamping to a 4-byte floor (a UTF-8 code point is at
   most 4 bytes) inside the helper itself, so every caller is protected
   regardless of what `ptyWriteChunkBytes` is configured to.
2. **Same-task writes could interleave mid-drain.** Before this fix, one
   `write()` call was one synchronous `pty.write()` — no gap for another
   call to land in. Chunking introduced a real multi-tick window (up to
   `chunks.length × ptyWriteChunkDelayMs`) during which a second `write()`
   for the *same* task (a keystroke, or the paste-image path) would execute
   immediately and splice its bytes into the middle of the still-draining
   first burst — corrupting exactly the kind of input this ADR protects.
   Fixed with a per-entry `chunkWriteBusy` flag + `pendingWrites` FIFO:
   a `write()` call that lands while a chunked write is in flight queues
   instead of executing, delivered in order once the burst fully drains.

A third, LOW-severity finding (the default scheduler's `setTimeout` wasn't
`.unref()`'d) was also fixed for consistency with the file's existing
convention.

### Amendment 2 (post doubt-review)

Stage-3 `doubt-reviewer` then found the code-review fix itself was
incomplete: `writeMouseReport()` (a sibling of `write()` used for SGR mouse
reports during a reader's scroll/select gesture) still wrote straight to
`entry.pty`, bypassing the new `chunkWriteBusy`/`pendingWrites` gate
entirely — so a scroll gesture landing mid-drain could still splice bytes
into a still-draining burst, reopening the exact class of corruption the
code-review fix closed for keystrokes and the paste-image path. Fixed by
routing `writeMouseReport()` through the same `writePossiblyChunked()` gate.
The doubt review also flagged that `pendingWrites` had no cap, unlike the
existing `wsBufferBytes` cap this file already enforces in the opposite
(pty→WS) direction — fixed with a `pendingWriteBytesCap` option (default
1 MiB) that drops a new write whole (never truncating an already-queued
one) once exceeded, and a one-line comment documenting that writes queued
behind a torn-down burst are intentionally dropped. Both fixes are covered
by new tests. A fourth, info-level doubt (the respawn-safety property held
structurally but had no dedicated test) was closed by adding one.

`pty-manager.ts` grew to 1478 lines (net +179 from the pre-iterate baseline,
across three review passes) and `pty-manager.test.ts` to 798 lines (+279,
11 new tests) — both bloat-baseline entries updated accordingly.

### Amendment 3 (post external Tier-3 PR review)

The PR's Tier-3 external review (sensitive-path track, `z-ai/glm-5.3`) found
a genuinely new, blocking correctness defect the three internal passes
missed: `drainPendingWrites` and `deliverOrChunk` were mutually recursive,
adding one call-stack frame per queued write. `pendingWriteBytesCap` bounds
queued *bytes*, not *count* — a client flooding thousands of tiny writes
during a burst's ~60ms drain window (e.g. 6KB / 512B chunks × 5ms) could
queue thousands of entries and, once the burst finished, recurse through the
whole queue on drain — exceeding the call stack and crashing the entire
process with an uncaught `RangeError`. That takes down every session on the
process: precisely the "frozen/dead server" failure this ADR exists to
eliminate, now reachable via the very flooding scenario the byte cap was
added to guard against. Fixed by converting `drainPendingWrites` into an
iterative loop — small queued writes are delivered directly in the loop (no
re-entry into `deliverOrChunk`), so stack depth stays O(1) regardless of
queue length; only an oversized queued write still hands off to
`deliverOrChunk`'s async chunked path, which schedules and returns rather
than recursing. Covered by a new regression test draining a 20,000-entry
queue of tiny writes. The same review also flagged two non-blocking issues,
both fixed: the byte-cap check recomputed the queue's total via `reduce` on
every push (O(n²) under a flooding client) — replaced with an O(1) running
total on the entry; and `Math.max(4, maxBytes)` did not guard `NaN` (a
non-finite `ptyWriteChunkBytes` would silently drop the whole write) — now
falls back to the default chunk size for any non-finite input.

`pty-manager.ts` grew to 1523 lines (net +224 from the pre-iterate baseline,
across four review passes) and `pty-manager.test.ts` to 837 lines (+318,
13 new tests) — both bloat-baseline entries updated accordingly.

## Context

Production incident (macOS): a task's first launch bakes the full task prompt
into the launch command as a `--session-id ... "<prompt>"` argument. For a
task with a 5,566-character description this produced a ~5.8KB command,
auto-typed into the embedded terminal in one shot after the ADR-068-A1
prompt-readiness handshake fired. `PtyManager.write()` forwarded the entire
burst to `entry.pty.write()` in a single call.

On macOS, a shell's canonical-mode tty input queue holds roughly 1KB. The
queue does not release any bytes to the reading shell until the line's
trailing newline arrives — and that newline was stuck at the very end of the
same oversized `write()` call. The write blocked waiting for queue room that
could only be freed by the shell reading, and the shell could not read until
the write finished: a deadlock on the Node.js server's single main thread,
which froze every other session hosted by the same process (observed twice in
production, ~3,769 bytes queued each time).

The already-shipped ADR-068-A1 prompt-readiness handshake (250ms quiesce /
1.5s no-data grace / 15s hard cap before injecting the command) only gates
*when* the command is sent — it waits for the shell to be ready to read. It
does not bound the *size* of a single write, so it could not and did not
prevent this: the deadlock is a burst-size problem, not a timing problem, and
recurs regardless of how long the handshake waits first.

## Decision

`PtyManager.write()` measures the UTF-8 byte length of the outgoing data. A
burst at or under `ptyWriteChunkBytes` (default 512 — safely under the ~1KB
queue) takes the original single-call path unchanged, so ordinary keystrokes
and short commands see zero behavioural or performance change.

A burst over the cap is split by the new `chunkUtf8ForPtyWrite()` pure helper
into UTF-8-safe sub-cap chunks (never splitting a multi-byte sequence across a
boundary) and written one chunk per `pty.write()` call, spaced by a real-timer
delay (default 5ms) via an injectable `scheduleChunkWrite` scheduler — real
`setTimeout` in production, a synchronous or fake-timer stub in tests. A task
killed mid-chunked-write (`entry.tornDown`) aborts the remaining chunks
instead of writing into a dead pty.

`PtyManager.write(taskId, data)` is the sole chokepoint for every pty input
source — interactive keystrokes, the ADR-068-A1 auto-launch command, and the
paste-image path insertion (`routes.ts`) — so fixing it there fixes all three
without touching the client or the WS transport, and without altering
DO-NOT #19 (auto-execute stays a client-side WS data-frame).

## Consequences

- `server/src/terminal/pty-manager.ts` grows from a pre-iterate baseline of
  1299 to 1523 lines (+224 net, across four review passes — see Amendment 3
  for the final pass). It is already an ADR-101 bloat-baseline "exception";
  the baseline's `current` + `note` were updated in the same commit, same
  responsibility bullet (the writer path), not a new concern.
- `server/src/terminal/pty-manager.test.ts` grows from a pre-iterate baseline
  of 519 to 837 lines (+318, 13 new tests + a `chunkUtf8ForPtyWrite`
  unit-test block); it is already a grandfathered bloat entry, `current`
  updated likewise.
- New `PtyManagerOpts` fields: `ptyWriteChunkBytes`, `ptyWriteChunkDelayMs`,
  `scheduleChunkWrite` — all optional, all defaulted, no call-site changes
  required at either of `write()`'s two production call sites
  (`ws-upgrade-handler.ts`, `routes.ts`).
- A long first-launch prompt now takes on the order of tens of milliseconds
  longer to finish typing into the pty (chunk-count × 5ms) — imperceptible
  against Claude Code's multi-second cold start, and nothing the user
  perceives as latency since the terminal is already mid-launch-animation.
- No change to `IPty`/node-pty itself, no new dependency, no change to the
  WS wire protocol.

## Rationale

Fixing the single existing write chokepoint (`PtyManager.write`) closes the
bug for every caller in one place, rather than special-casing the auto-launch
path client-side. Chunk size is chosen to stay safely under the queue size
that deadlocked in production; the real-timer gap between chunks (rather
than a same-tick `setImmediate` loop) actually yields the Node event loop,
so both the OS scheduler (letting the shell drain the queue) and other
in-process WS/HTTP work get a turn between chunks — closer to what "waiting
for each to drain" means in practice, since node-pty's public `IPty` surface
exposes no drain/backpressure signal to wait on directly.

## Rejected alternatives

1. **Only widen/relax the prompt-readiness handshake (wait longer for the
   shell).** Already shipped as ADR-068-A1 and empirically insufficient —
   readiness answers *when*, not *how much in one write*; the deadlock
   depends only on burst size once the shell is already reading.
2. **Chunk client-side before the WS `send`.** Would spread the frame-count
   growth across the WS transport and touch DO-NOT #19's "auto-execute is a
   single client-built WS data-frame" contract, for no benefit — the same
   atomic `pty.write()` chokepoint on the server still needed the fix, since
   the paste-image path (`routes.ts`) never goes through the client
   auto-launch code at all.
3. **A dedicated MAX_LENGTH validation on the task-description field**
   (reject/truncate long prompts at creation time). Rejected as treating the
   symptom, not the root cause named in the Iron Law investigation: a long,
   *legitimate* task description is not the bug — an unchunked pty write is.

## Verification note (repro test, not yet run on macOS)

`chunkUtf8ForPtyWrite` and the chunked-write path are covered by 5 new unit
tests in `pty-manager.test.ts`, including a 6KB-burst repro proving the write
is split into multiple sub-cap calls that concatenate back to the exact
original bytes, and a fake-timer test proving the default scheduler yields
real event-loop turns between chunks rather than delivering the whole burst
synchronously. This development machine runs Windows (node-pty → ConPTY),
which does not reproduce macOS's canonical-mode tty deadlock, so the fix's
*mechanism* is unit-verified but the original *failure mode* could not be
reproduced live in this environment — flagged for a macOS tester per the
operator's own plan (see run summary).

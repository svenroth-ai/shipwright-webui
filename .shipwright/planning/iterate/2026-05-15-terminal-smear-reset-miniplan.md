# Mini-Plan: terminal-smear-reset

- **Run ID:** iterate-20260515-terminal-smear-reset
- **Complexity:** medium · **Type:** bug

## Approach

Two independent, additive changes in the terminal subsystem. No touch to
the replay-snapshot machinery contracts (ADR-087/092/097), the Resume-CTA
gate, or `external/routes.ts` — keeps the diff conflict-free against the
in-flight `resume-cta-jsonl-signal` branch.

### Part 1 — Bug B (remount smear), codex:codex-rescue root cause

`client/src/components/terminal/EmbeddedTerminal.tsx`:
- Add `replaySnapshotInFlightRef = useRef(false)` (component-body ref).
- `onReplaySnapshot`: keep the guarded `term.reset()`, then call
  `term.write(data, completionCallback)`. Move `scrollToBottom()` +
  `safeAtlasMaintenanceRef.current?.()` into the completion callback
  (guarded by `disposedRef` + `termRef.current === term`). Drop the
  ADR-099-v10 `setTimeout(0)`. If `term.write` throws synchronously, clear
  the in-flight ref in the catch (AC-3).
- `onWriteParsed` handler: early-return when `replaySnapshotInFlightRef`
  is set — only bump `writesSinceLastClear` + `lastWriteTime`. The
  completion callback owns the single post-snapshot maintenance pass.

### Part 2 — reset banner

`server/src/terminal/routes.ts` (WS `upgradeWebSocket` handler, non-replay
branch): capture `ptyExistedBeforeAttach = ptyManager.get(taskId) !== undefined`
on the synchronous line *immediately before* `ptyManager.spawn(...)`
(race-free — no `await` between). Compute
`terminalReset = !ptyExistedBeforeAttach && Boolean(task.firstJsonlObservedAt)`.
Add `terminalReset` to the `ready` envelope JSON. (Replay-only branch:
omit / `false` — done tasks never spawn a pty.)

`client/src/hooks/useTerminalSocket.ts`: parse `env.terminalReset`
(boolean, default `false`) in the `ready` handler; add `terminalReset:
boolean | null` to `UseTerminalSocketResult`; reset to `null` on
disconnect like the sibling fields.

`client/src/components/terminal/EmbeddedTerminal.tsx`: new conditional
header-strip banner. `useState` dismiss flag. Render when
`socket.terminalReset === true && !coord.pendingLaunch && !dismissed`.
Amber/warning tokens, matches the read-only banner styling. `data-testid="embedded-terminal-reset"`.

## Files

| File | Change |
|---|---|
| `client/src/components/terminal/EmbeddedTerminal.tsx` | Bug B in-flight ref + write-callback + onWriteParsed guard; reset banner UI |
| `client/src/hooks/useTerminalSocket.ts` | parse + expose `terminalReset` |
| `server/src/terminal/routes.ts` | compute + emit `terminalReset` in `ready` envelope |
| `client/src/components/terminal/EmbeddedTerminal.test.tsx` | tests AC-1/2/3/6 |
| `client/src/hooks/useTerminalSocket.test.ts` | test AC-5 |
| terminal WS route test (`server/src/terminal/*.test.ts`) | test AC-4 |

## Test strategy (TDD)

- RED first. Component test (fake terminal stub) for the in-flight guard:
  during a simulated in-flight snapshot write, `onWriteParsed` firings do
  NOT trigger atlas maintenance; the write-completion callback triggers it
  exactly once. Banner test: `terminalReset` prop/socket-state → banner
  renders; `pendingLaunch` set → banner hidden.
- Server: route test asserts the `ready` envelope `terminalReset` value
  for (a) fresh pty + `firstJsonlObservedAt` set → true, (b) fresh pty +
  no JSONL → false, (c) re-attach to live pty → false.
- Hook: `useTerminalSocket` test feeds a `ready` envelope with/without
  `terminalReset` → exposed value correct + back-compat default.
- F0: `npx vitest run` + `npx tsc --noEmit` (both server + client).
- F0.5: Playwright web surface for the banner flow.

## Alternative considered

Make `PtyManager.spawn()` return `{ meta, created }`. Rejected — ripples
to every `spawn` caller + all pty-manager tests. The `get()`-before-
`spawn()` pre-check is zero-ripple and race-free (single-threaded, no
`await` between the two synchronous calls).

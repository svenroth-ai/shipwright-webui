# Mini-plan — terminal replay teardown + Reopen reconnect

- **Run ID:** `iterate-2026-08-27-terminal-replay-reset-reopen-reconnect`
- **Complexity:** medium

## Files and approach (chosen)

1. `server/src/terminal/replay-snapshot.ts` — add an
   `INTERACTION_MODE_TEARDOWN` constant + `BuildReplaySnapshotEnvelopeOptions`
   (`tearDownInteractionModes?: boolean`), applied after the existing
   `?1006h` fixup, never touching `?1049`.
2. `server/src/terminal/ws-upgrade-handler.ts` — thread the option through
   `sendReplaySnapshot`; pass `{ tearDownInteractionModes: true }` only from
   `buildReplayOnlyHandlers`.
3. `client/src/hooks/useTerminalSocket.ts` — new `sessionEnded?: boolean`
   option; a small dedicated effect force-reconnects on its `true → false`
   edge, gated on `sessionReplayOnlyRef.current` so a live socket is never
   disturbed.
4. `client/src/components/terminal/EmbeddedTerminal.tsx` — derive
   `sessionEnded` from `taskState` and pass it through.
5. Tests: extend `replay-snapshot.test.ts` (envelope option); new
   `EmbeddedTerminal.reopen-reconnect.test.tsx` (real WS `close()` lifecycle —
   not the reopen-rearm file's non-closing double); new E2E flow spec against
   the isolated stack.

## Alternative considered — `key`-remount EmbeddedTerminal on Reopen

`TaskDetailPage.tsx` could pass `key={`${taskId}:${sessionEnded}`}` to force a
full remount of `<EmbeddedTerminal>` on Reopen, which trivially opens a fresh
socket (mount = fresh `useTerminalSocket` effect run) with none of
`useTerminalSocket`'s internal changes.

**Rejected because:** a remount destroys and recreates the xterm instance —
losing the in-memory scrollback buffer, the touch-scroll/scroll-repaint/
settle-repaint DOM listeners, the OSC-52 handler registration, and (per
`useAutoLaunch`'s task-change reset effect, which is keyed on `taskId` alone
and would now fire spuriously on every Reopen even for the *same* task) the
one-shot auto-inject bookkeeping the iterate-2026-08-16 re-arm fix already
depends on running exactly once per real pty lifetime. It would also force a
visible terminal-canvas flash (dispose → recreate → refit) on every Reopen,
which the chosen approach avoids entirely — the user should see the terminal
reconnect quietly, the way a live-session network blip already does.

## Data and safety

No new I/O boundary, no new wire message type, no schema change. The server
change only appends bytes to an existing envelope under a new opt-in flag
that defaults to today's behavior; the client change only adds a narrowly-
gated effect that cannot fire unless a replay-only close already happened.

## Test strategy

Unit: extend `replay-snapshot.test.ts` (server) + new
`EmbeddedTerminal.reopen-reconnect.test.tsx` (client, real-closing WS double,
per explicit instruction — no mock socket that stays open). Full client +
server Vitest suites, `tsc --noEmit`, `oxlint` on both workspaces. E2E:
author + run a Playwright flow against the isolated dev stack exercising the
real server round-trip (close → Reopen → reconnect) that jsdom cannot cover.

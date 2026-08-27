# Architecture Brief: terminal replay teardown + Reopen reconnect

## The problem

A closed (`done`/`launch_failed`) task's embedded terminal replay can leave
mouse-tracking/alt-scroll modes latched ON with no live pty ever able to turn
them off, breaking native scroll and copy in the read-only view. Separately,
reopening a closed task never reconnects its terminal socket, so the user has
to manually reload the page (and sometimes re-Resume) to see it live again.

## What would newly, permanently exist

Nothing. This changes machinery that already exists: the one-shot
`replay_snapshot` wire envelope (`server/src/terminal/replay-snapshot.ts`)
gains an opt-in teardown of interaction modes it already conditionally
appends bytes to, and the existing WS reconnect/liveness logic
(`client/src/hooks/useTerminalSocket.ts`) gains one narrowly-gated internal
effect that reacts to a state edge already flowing into the component.

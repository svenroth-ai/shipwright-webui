# Mini-Plan: fix-terminal-flicker-on-closed-task

- **Run ID:** iterate-2026-05-21-fix-terminal-flicker-on-closed-task
- **Spec:** [.shipwright/planning/iterate/2026-05-21-fix-terminal-flicker-on-closed-task.md](./2026-05-21-fix-terminal-flicker-on-closed-task.md)

## Approach (chosen)

Client-only guard in the WebSocket close listener: track the most recent `ready.replayOnly` value in a ref, and skip `scheduleReconnect()` when the close was clean (code 1000) AND we know this attach was replay-only. The ref + close-code combo is the narrowest signal that "the server told us this is a one-shot attach AND it actually ended cleanly."

The cleanup path (`taskId` change / unmount) already sets a per-effect `cancelled` flag BEFORE calling `ws.close(1000, "unmount")`, and the close listener's `if (cancelled) return;` short-circuit runs before the new gate — so the new gate is invisible to that path.

## Alternative considered

**Server-side: hold the replay-only WS open instead of closing.** The WS would stay idle after the snapshot; the client never reconnects because the close event never fires. Rejected:

1. Larger blast radius — touches `server/src/terminal/routes.ts` replay-only branch; needs new test fixtures around the idle WS lifecycle.
2. Forces the server to manage idle replay-only sockets (when does it eventually close? what timeout? what if 10 tabs are open on closed tasks?). The current "send + close" pattern is simpler.
3. Client-only fix is two-file diff (hook + tests). Server fix is multi-file (routes.ts + tests + likely a TTL knob).

The client-side gate is the right size for the bug — the server contract ("replay-only attaches are one-shot") is already correct; the client just wasn't honoring it.

## Files to change

| File | Kind | Reason |
|---|---|---|
| `client/src/hooks/useTerminalSocket.ts` | implementation | Add `replayOnlyRef`; mirror `ready.replayOnly` into it; gate `scheduleReconnect()` in the `close` listener on `replayOnlyRef.current === true && closeCode === 1000`. Reset the ref in cleanup + disabled branch. |
| `client/src/hooks/useTerminalSocket.test.ts` | tests | Two new regression tests: (a) no reconnect after replay-only `close(1000)`; (b) reconnect still fires after live abnormal `close(1006)`. |

No server-side changes. No CSS/markup changes. No type-shape additions to the exported interface (the ref is internal).

## Work breakdown

1. **RED:** Author the two new tests against the existing `FakeWebSocket` fixture, RUN them against unmodified `useTerminalSocket.ts`, confirm the replay-only test fails (multiple WS instances created within the 350 ms reconnect window). The live-abnormal test passes both pre- and post-fix and is a defense-in-depth symmetric guard.
2. **GREEN:** Add `replayOnlyRef`, hook into the `ready` envelope branch, gate `scheduleReconnect()` in the close listener on `(replayOnlyRef.current === true && closeCode === 1000)`. Reset the ref in cleanup and on disabled/`taskId === null` early-return.
3. **Verify:** Run `useTerminalSocket.test.ts` (17 tests) and `EmbeddedTerminal.test.tsx` (39 tests) — both 100% green.
4. **Self-review** against the 7-point checklist (see iterate-reviews.md). Pay specific attention to:
   - Item 5 (Closures): the close listener is registered once per effect; the ref read happens at close-time, so the listener captures the ref object (not a value snapshot). Stale closure ruled out.
   - Item 7 (Affected Boundaries): no serialized format touched; document `n/a`.
5. **External Review:** run `external_review.py --mode iterate` over the diff. Pass `Branch A: act on findings` if any HIGH/MEDIUM landed; `Branch C: explicit dismissal in ADR` for LOW/style only.
6. **F0:** Full client vitest run + tsc --noEmit + oxlint.
7. **F0.5:** Author + execute a Playwright spec that drives `EmbeddedTerminal` on a task in `done` state, asserts no WS-reconnect storm via `page.on("websocket")`. Surface=web.
8. **Finalize:** F1 → F3 → F4 → F5/F5b/F5c → F6 → F7 → F11 → F12.

## Test strategy

- **Unit (already in scope):** 2 new tests in `useTerminalSocket.test.ts` covering the gate's positive and negative branches.
- **Integration (none):** the gate is internal to one hook; no integration boundary to drive.
- **E2E (mandatory at medium+):** Playwright spec that
  1. seeds a task in `state === "done"` via the external API (or picks an existing closed task in the dev DB),
  2. navigates to `/tasks/<uuid>` with `page.on("websocket")` registered,
  3. waits 2 s,
  4. asserts the count of `/api/terminal/.../ws` upgrade attempts is exactly 1 (was many pre-fix).

Per memory `feedback_playwright_request_fetch_no_101.md`: WS-upgrade-aware tests use `page.on("websocket")`, not `request.fetch`. Per memory `strictmode_aborts_first_ws_in_e2e.md`: if the React StrictMode dev double-mount makes the first WS unobservable through the component, fall back to a raw `new WebSocket()` probe in `page.evaluate`. Per memory `feedback_iterate_e2e_isolated_userprofile.md`: F0.5 runs against an isolated server (temp `USERPROFILE`, `SHIPWRIGHT_NETWORK_PROFILE=local`).

## Rollback plan

- The fix is two files, both client-side. Revert is `git revert <commit>` from main. No server-side state to clean up. No migration to roll back. No env-var change.
- Worst case if the gate over-suppresses (e.g. a replay-only attach unexpectedly becoming non-replay-only mid-WS-lifetime — a scenario the server contract does not produce): the user sees a stale terminal on a closed task and can navigate away + back, which resets the ref and re-attaches. No data loss; no security implication.

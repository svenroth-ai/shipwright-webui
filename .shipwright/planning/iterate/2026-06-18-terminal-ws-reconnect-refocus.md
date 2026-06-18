# Iterate Spec — terminal WS reconnect-on-refocus + client heartbeat

- **run_id:** iterate-2026-06-18-terminal-ws-reconnect-refocus
- **intent:** bug (prior FR-01.28 repaint fix was incomplete — fixed a sibling problem)
- **complexity:** medium (classifier: small/history; overridden ↑ — load-bearing terminal WS, new mechanism, concurrency edge cases)
- **spec impact:** MODIFY (terminal WS connection lifecycle)
- **base:** origin/main @ 896e4d5

## Problem

The embedded terminal shows a stale, frozen frame and never refreshes after the
user leaves the browser tab and returns — confirmed triggers: **laptop sleep /
screen lock + browser-tab switch, over the Tailscale IP**. The user believed the
earlier FR-01.28 fixes (#146/#147) covered this.

### Diagnosis (empirical)

- **Not a stale build.** Production (PID 36020, `node dist/index.js`) + the
  served `client/dist` are both from 2026-06-15 22:04 — *after* all four
  FR-01.28 terminal fixes (#146/#147/#150/#151). Everything merged since
  (#152–#158) is unrelated to terminal repaint.
- **The prior fix solved a sibling problem.** PR #146/#147 added a
  `focus`/`visibilitychange`/`pageshow` **repaint** (`useTerminalResize.ts`
  270–304) + WebGL context-loss recovery (`xtermAddons.ts` 239). That heals the
  *cosmetic* stale-GPU frame — it redraws the **existing buffer**.
- **The real gap is the WebSocket itself.** `useTerminalSocket.ts`:
  1. **No reconnect-on-refocus.** The only refocus handler (in
     `useTerminalResize`) repaints; nothing re-establishes a dead socket.
  2. **Permanent give-up.** `MAX_RECONNECT_ATTEMPTS = 5`, backoff 200→3200 ms
     (~6.2 s total) — once exhausted (network down across sleep), the socket is
     dead until a full component remount.
  3. **No client liveness check.** The server has a ping/pong heartbeat
     (`ws-heartbeat.ts`) that frees the *server* writer slot, but a returning
     client whose own socket silently died across a full sleep+Tailscale
     partition gets **no `close` event** → no reconnect is even attempted →
     repaint redraws a dead buffer = "lädt wie nicht neu."

## Root cause

Client WS liveness is purely passive (browser `close` event) and one-shot
(5-attempt budget). The strongest user signal that a live terminal is wanted —
returning to the tab — triggers no reconnect, and a silently-dead (half/full-open)
socket is never detected client-side.

## Fix (robust — user-chosen)

1. **New pure module** `client/src/hooks/wsHeartbeat.ts` — `createWsHeartbeatMonitor`
   (mirrors server `createHeartbeatMonitor`: `notePong` / `tick → ping|terminate`)
   + `startClientHeartbeat` thin wiring with scheduler seams. Constants:
   `WS_HEARTBEAT_INTERVAL_MS = 15000`, `WS_HEARTBEAT_MAX_MISSED = 2`,
   `WS_REFOCUS_PROBE_MS = 4000`.
2. **Wire into `useTerminalSocket.ts`** (inside the existing effect closure):
   - start heartbeat on `open`; **any inbound message → `notePong()`**;
   - heartbeat `terminate` → `socket.close()` (existing close→reconnect path);
   - on `visibilitychange`(visible)/`focus`/`pageshow`: **re-arm reconnect budget**
     (`attemptsRef=0`) + reconnect if socket not OPEN + **eager liveness probe**
     (ping + `WS_REFOCUS_PROBE_MS` deadline) if it looks OPEN;
   - **replay-only one-shot is preserved** — never reconnect/keepalive a
     replay-only (done/terminal) session.
3. **Server reply** in `ws-upgrade-handler.ts`: `{type:"ping"}` → `{type:"pong"}`,
   placed *before* the role gate (readers stay alive too). Unknown types are
   already safely dropped — additive, back-compatible.

### Alternative considered & rejected

Client-only liveness via `WebSocket.bufferedAmount` (no server change). Rejected:
flakier (tiny ping frames can drain into the OS buffer even on a dead link). User
asked for robust; ping/pong is reliable, deterministic, unit-testable. Server cost
is ~3 lines.

## Acceptance criteria

- **AC-1** Periodic heartbeat: an open socket emits `{type:"ping"}` every interval.
- **AC-2** Liveness reset: any inbound message (incl. `pong`) resets the missed-pong count.
- **AC-3** Dead-socket reap: an open socket that never answers is closed after
  `MAX_MISSED` intervals → a reconnect is attempted.
- **AC-4** Reconnect-on-refocus: after the reconnect budget is exhausted, a
  visibility/focus regain re-arms the budget and reconnects when the socket is closed.
- **AC-5** Eager refocus probe: a refocus with a socket that *looks* OPEN but is
  silently dead (no inbound within `WS_REFOCUS_PROBE_MS`) closes + reconnects.
- **AC-6** Replay-only preserved: a refocus/heartbeat must NOT reconnect a
  replay-only attach (regression: existing "does NOT reconnect after a clean close
  on a replay-only attach" test stays green; snapshot still replays exactly once).
- **AC-7** Server pong: a `{type:"ping"}` envelope (from writer OR reader) gets a
  `{type:"pong"}` reply and never a `read_only`/pty side-effect.

## Affected boundaries

- WS envelope contract (client ↔ server): new `ping`/`pong` envelopes (additive).
- Browser visibility/focus/pageshow events.
- Timer scheduling (heartbeat interval, refocus probe, reconnect backoff).

## Confidence Calibration
- **Boundaries touched:** WS envelope (additive `ping`/`pong`), browser
  visibility/focus/pageshow events, timer scheduling (heartbeat interval +
  refocus probe + reconnect backoff).
- **Empirical probes run:**
  1. Deployed-build check: prod (PID 36020) + served `client/dist` are from
     2026-06-15 22:04, AFTER all FR-01.28 fixes → NOT a stale build (the prior
     repaint fix is a sibling problem). Empirically confirmed via timestamps.
  2. Code-read: confirmed no reconnect-on-refocus + no client liveness existed;
     server `ws-heartbeat.ts` only frees the server slot.
  3. Unit (both ends): 18 client liveness/heartbeat assertions + 17 server
     parse assertions, all green. Full F0: client 1744 + server 1660.
  4. Real-browser E2E (F0.5): refocus → `ping`(tx) → `pong`(rx) on a live
     terminal WS in Chromium against the isolated stack; socket stays open.
- **Test Completeness Ledger:** recorded in `shipwright_test_results.json`
  `iterate_latest.test_completeness` — 10 testable behaviors all `tested`
  (AC-1..AC-7 + AC-4d/AC-5b/AC-5c + the E2E wire); 1 `untestable`
  (`requires-external-nondeterministic-service`: full sleep/Tailscale
  partition-recovery — no real partition in a unit/E2E harness). 0
  untested-testable.
- **Confidence-pattern check:** asymptote (depth) — the dead-socket /
  half-open / double-connect / stale-probe edge cases are each pinned by a
  dedicated test, and the two adversarial review findings (CONNECTING
  double-connect; stale-probe closing a reconnected socket) are fixed +
  regression-guarded. Coverage (breadth) — client controller, server handler,
  AND the real-browser wire are each covered. Integration composition: the
  client+server `ping`/`pong` envelope contract is exercised together by the
  E2E. Residual: the literal partition-recovery needs a manual post-deploy
  smoke (rebuild + restart prod, then sleep/return) — flagged to the user.

## Out of scope / guards

- Do NOT change replay precedence (rule 21) or the snapshot envelope (rule 22).
- Do NOT touch the server protocol heartbeat (`ws-heartbeat.ts`) — orthogonal.
- Files at bloat ceiling: pure logic → new module; new tests → new files;
  minimal ADR-justified baseline bump for the thin wiring in `useTerminalSocket.ts`
  + `ws-upgrade-handler.ts`.

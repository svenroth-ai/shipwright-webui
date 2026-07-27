# Iterate: Mac terminal still frozen after sleep — connection dies, detected too slowly

- **Run ID:** `iterate-2026-07-27-mac-terminal-fast-dead-socket`
- **Intent:** BUG (Path C) — 3rd follow-up on the Mac-sleep terminal freeze
  (after #310 never-give-up schedule, #324 clock-drift wake detector).
- **Complexity:** small (client-only; a new trigger + a constant change + tests)
- **Risk flags:** none — no I/O boundary, no server, no serialized format
- **Spec Impact:** **NONE** — restores FR-01.28 behavior; the machinery is right,
  the DETECTION of the dead socket was just too slow on macOS.
- **Affected FRs:** FR-01.28 (Embedded terminal)

## Why a THIRD fix — the diagnosis was wrong twice, now confirmed empirically

#310 and #324 shipped and the reporter confirmed the freeze **persisted, Mac-
only**. Deployment was verified this time (served bundle contained both fixes).
Fresh data captured from the Mac (2026-07-27):

| Observation | Reading |
|---|---|
| **Only the terminal hangs; the rest of the page works** | The page/JS does NOT freeze on this Mac's sleep |
| **Typing produces nothing, not delivered later; scroll dead too** | The connection is genuinely dead (not a stale-picture/render problem) |
| **Still ~30-60 s to self-heal; a click doesn't speed it up** | #324's wake detector never fires (no JS freeze → no clock gap) |

**Root cause:** on this Mac, a lock/sleep keeps the page's JS **running** (so the
clock-drift wake detector #324 has no gap to detect) while the WS to the host
(over Tailscale) dies **silently half-open** — no `close`, and macOS fires none
of the `focus`/`pageshow`/`visibilitychange`/`online` events the eager revive
hangs on. So recovery fell entirely to timers: the heartbeat reaps the dead
socket, and #310's reconnect **tail** then backs off to a 30 s cadence; when the
user returns, the *next* tail attempt (up to ~30 s away) is what recovers it.
That IS the "~30-60 s". Windows recovers instantly because it DOES fire a focus
event on unlock — same code, different OS event behavior, hence Mac-only.

## Fix — react to what macOS DOES give us

Two layers, both feeding the existing (well-tested) `reviveIfStale` path:

1. **Interaction-triggered revive** (primary) — a `keydown`/`pointerdown`
   listener (document, capture) fires `reviveIfStale` when the socket has been
   inbound-silent past `WS_INTERACTION_STALE_MS` (8 s). A returning user always
   types or clicks, and a DOM event fires regardless of OS-wake behavior. When
   the client is already in the reconnect tail (socket null), this short-circuits
   the ≤30 s wait and reconnects on the FIRST keystroke (~1 s). Gated on
   inbound-silence so normal typing on a healthy socket (which pongs every
   heartbeat) never churns the connection; throttled so continuous typing into a
   dead socket can't keep postponing the probe.
2. **Faster passive heartbeat** — `WS_HEARTBEAT_INTERVAL_MS` 15 s → 5 s (client
   and server heartbeats are independent, so the client may sample faster). A
   dead half-open socket is now reaped in ~10-15 s instead of ~30-45 s, for the
   "watching output, not interacting" case.

**Kept, not removed** (the user asked): #310's never-give-up schedule + watchdog
+ banner are the recovery MACHINERY every trigger feeds; #324's wake detector is
a harmless, tested layer for a *true* JS-freezing sleep (a case this Mac doesn't
hit but others might). They cover distinct failure modes and all funnel through
one safe `reviveIfStale`. Removing tested, harmless defense-in-depth to tidy up
would be a mistake.

## Acceptance Criteria

- **AC-1** — A keystroke/click on an inbound-silent OPEN socket probes it; with
  no socket (in the tail) it reconnects immediately.
- **AC-2** — On a healthy socket (recent inbound) an interaction is a no-op —
  normal typing never churns the connection.
- **AC-3** — Rapid typing into a dead socket does not re-arm the probe every
  keystroke (throttle); dispose unbinds the listeners.
- **AC-4** — The heartbeat reaps a dead socket in ~10-15 s (interval 5 s × 2).
- **AC-5** — No regression: the full WS-liveness suite stays green (the interval
  change and the new listeners break nothing).

## Confidence Calibration

- **Boundaries touched:** browser-side WS liveness only (a document listener + a
  constant). No server, no file/env/serialized boundary → no `touches_io_boundary`.
- **Empirical probes run:**
  - Deployment verified before diagnosing: the served `client/dist` (built after
    #324/#325) contained the prior fixes, so this is a real remaining defect, not
    a stale bundle (the round-1 trap).
  - The three Mac observations above triangulate to ONE mechanism and each rules
    out an alternative (page-alive → not a lifecycle bug; typing-dead-not-
    -delivered → not render; ~30-60 s + click-no-help → wake detector silent,
    tail-timed recovery).
  - Regression probe: the 15 s→5 s heartbeat change ran against the full 73-test
    WS suite → green (tests use the constant / explicit seams, no hardcoded 15 s).
- **Test Completeness Ledger:** in `iterate_latest.test_completeness`. 0
  untested-testable.
- **Confidence-pattern check:**
  - *Asymptote:* the interaction handler is unit-tested through the real
    `attachWsLiveness` wiring (real DOM events → real `reviveIfStale`), AND
    proven in a real Chromium (spec 97, load-bearing). The downstream
    probe/reconnect it calls is already covered by osresume/refocus/wake units.
  - *Coverage:* both interaction branches (OPEN→probe, null→reconnect), the
    healthy-socket no-op, the throttle, dispose, and the heartbeat-interval
    regression.
  - *Honest gap:* the real macOS lock/sleep on the reporter's hardware stays
    `untestable` (`requires-physical-device`); the mechanism it depends on is
    covered by the unit + real-browser layers above.

## File-budget note

`wsLiveness.ts` is now 305 LOC (was 271), just over the 300 guideline. In webui a
new >300 crossing with no `shipwright_bloat_baseline.json` entry is ADVISORY
(CLAUDE.md: caught by the shipwright-dev-repo audit, not webui) — no ratchet, no
block. Deliberately NOT split here: extracting the trigger-wiring mid-fix would
risk the exact revival path that has been finicky across three rounds. The clean
follow-up is a `wsReviveTriggers.ts` that owns all revive triggers (events +
interaction + wake detector), leaving `wsLiveness` the machinery — a dedicated
refactor iterate, not bundled into a user-critical fix.

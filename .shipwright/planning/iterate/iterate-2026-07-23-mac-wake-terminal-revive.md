# Iterate: embedded terminal still frozen after a Mac sleep — no wake event fires

- **Run ID:** `iterate-2026-07-23-mac-wake-terminal-revive`
- **Intent:** BUG (Path C) — follow-up to `iterate-2026-07-21-mac-sleep-terminal-frozen`
- **Complexity:** small (client-only; one new pure module + a wiring line + tests)
- **Risk flags:** none — no I/O boundary, no server, no serialized format
- **Spec Impact:** **NONE** — restores behavior FR-01.28 already describes; the
  prior fix's schedule is correct, its *trigger* just never fires on macOS.
- **Affected FRs:** FR-01.28 (Embedded terminal)

## Why a second fix

The prior fix (#310) made the reconnect schedule never go inert and added an
`online` listener. The reporter deployed it and confirmed the freeze **persists,
Mac-only**: after lid-close → unlock, the terminal is frozen until a manual
reload.

Empirical data captured from the Mac (2026-07-23), which pins the mechanism:

| Observation | Reading |
|---|---|
| **No "reconnecting" banner appears** during the freeze | No eager revive is triggered — nothing sets `reconnecting` |
| **Self-heals after ~30–60 s** if left alone | Exactly the missed-pong heartbeat (15 s × 2 ≈ 30–45 s) — the schedule works, but only that slow path runs |
| **Frozen shows the last screen, not blank** | The socket still reports `OPEN` (half-open) — it slept through with no `close` |

## Root cause

The eager revive (`wsLiveness` `onRefocus` / `onOnline`) is bound to
`focus` / `pageshow` / `visibilitychange` / `online`. On macOS a lid-close →
unlock fires **none** of them: the whole page freezes and thaws
**already-visible, window still focused, network nominally up**. So no eager
probe runs, and recovery falls entirely to the ~45 s heartbeat. Windows fires one
of those events on unlock, so it recovers in <1 s — same code, different OS event
behavior, which is exactly why it reproduces only on Mac.

## Fix

A **wake detector** that does not depend on any browser event
(`client/src/hooks/wsWakeDetector.ts`, pure + unit-tested): a short interval
(2 s) samples the wall clock; when the gap between ticks exceeds `WS_WAKE_GAP_MS`
(8 s), the tab was demonstrably frozen (sleep / deep throttle), so it runs the
existing `reviveIfStale()` — the same probe-or-reconnect path the event
listeners use. While the machine sleeps the interval is frozen; the first tick
after wake shows the large gap. This fires on **any** OS regardless of events,
cutting Mac recovery from ~45 s to a few seconds.

- False positives are benign: a backgrounded-but-alive tab (Chromium throttles
  to ~1 tick/min) also crosses the gap, but `reviveIfStale` on a live socket just
  pings and gets a pong — no teardown.
- The server side needs no change: across a real (long) sleep the server's own
  heartbeat has long since reaped the dead connection and freed the writer slot,
  so the fast client reconnect lands as **writer** immediately.

## Acceptance Criteria

- **AC-1** — A tick gap over the threshold fires the wake callback; a normal-gap
  tick does not.
- **AC-2** — On wake, an OPEN-but-stale socket is probed (ping); a null socket is
  reconnected immediately — driven by the detector alone, no browser event.
- **AC-3** — The detector re-arms (a second sleep fires again) and `stop()`
  (idempotent) clears the interval so no stray tick fires after dispose.
- **AC-4** — No spurious wake under the existing WS test suite (shared fake-timer
  seam): all prior liveness tests stay green.

## Confidence Calibration

- **Boundaries touched:** browser-side WS liveness only (a new timer + a call
  into the already-tested `reviveIfStale`). No file/env/serialized boundary → no
  `touches_io_boundary`. No server.
- **Empirical probes run:**
  - The Mac observations above (no banner + ~30–60 s heal + frozen-last-screen)
    triangulate to one mechanism; each rules out an alternative (no banner ⇒ not
    the reconnect-failing case; ~45 s ⇒ heartbeat path; frozen-content ⇒
    half-open, not a dead-and-closed socket).
  - Regression probe: the wake detector shares the `setIntervalFn` seam with the
    heartbeat tests — ran the full 59-test WS suite, all green, confirming
    vitest fake timers (which fire every interval in lockstep, gap ≈ interval)
    produce no spurious wake.
- **Test Completeness Ledger** — see `iterate_latest.test_completeness` in
  `shipwright_test_results.json`. 0 untested-testable.
- **Confidence-pattern check:**
  - *Asymptote:* the detector logic and its wiring to `reviveIfStale` are both
    unit-covered; the downstream `reviveIfStale → probe → close → reconnect`
    chain is already covered by the osresume/refocus units **and** the
    real-browser spec 77 (#310). So every link is proven.
  - *Coverage:* both wake branches (OPEN-stale → probe; null → reconnect),
    re-arm, idempotent stop, dispose, and the no-spurious-wake regression.
  - *Honest gap:* the ONE thing not reproduced in a real browser is the
    macOS half-open-socket-with-no-events state itself — Playwright cannot
    produce a half-open WebSocket (offline fires `close`; the isolated stack's
    pty spawn fails `code 5`, so a live-then-half-open socket is unreachable
    here). Recorded `untestable` with a reason_code, not hand-waved. Spec 77 is
    still run as the real-browser regression check on the shared reconnect code.

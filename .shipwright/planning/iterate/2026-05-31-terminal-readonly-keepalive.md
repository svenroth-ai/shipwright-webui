# Iterate Spec — Terminal WS liveness keepalive (read-only false-blocker)

- **run_id:** `iterate-2026-05-31-terminal-readonly-keepalive`
- **Intent:** CHANGE (modify embedded-terminal WS connection lifecycle)
- **Complexity:** medium (override of classifier `trivial`/0.6 — keyword-only;
  it cannot see that this touches concurrency/timing in load-bearing terminal
  WS infra: CLAUDE.md DO-NOT guards #17–21, ADR-101/103 protected deep modules)
- **Spec Impact:** MODIFY — extends the existing WS attach/detach lifecycle
  (ADR-067 / ADR-068-A1 / ADR-092) with a liveness signal. No FR text change
  (terminal connection management is infra, not an FR acceptance criterion).

## Problem

The embedded terminal shows **"Read-only — another tab is the active writer for
this task"** even when the user has nothing else open. Root cause (empirically
diagnosed against the live prod server, task `74facc15-…` / session
`82d423d1-…`):

- First WS to attach a task's pty becomes `writer`; later attaches become
  `reader` → read-only banner after a 1500 ms grace
  (`useTerminalShellEffects.ts`).
- The writer slot is released **only** on the WS `close`/`error` event
  (`detachAndCount` in `ws-upgrade-handler.ts`).
- There is **no WS-level liveness keepalive**. The eviction watchdog in
  `pty-manager.ts` only evicts on socket *backpressure* (`bufferedAmount`
  stuck) — and in production it is effectively inert anyway because the
  `conn` identity passed to the manager is a synthetic `connToken`
  (`{taskId,t}`) with no `bufferedAmount`, so `connCapability` stamps every
  conn "missing".
- Therefore a writer connection that dies **uncleanly** (OS sleep, browser/tab
  crash, Tailscale half-open TCP — the prod server binds the Tailscale IP)
  pins the slot. An idle pty emits ~0 bytes, so nothing reaps it. Every new
  tab lands as `reader` → false read-only. Only self-heal today is the 30-min
  idle ceiling (`touchIdle`→kill).

## Fix (chosen approach)

Add a **per-connection WS ping/pong liveness heartbeat**. On a missed pong the
server `terminate()`s the dead socket; the **existing** `onClose → detach →
reader-promotion → onPromoteToWriter("writer-promoted")` chain then frees the
slot and promotes the surviving tab to writer — clearing read-only **without a
manual reload**. Running the heartbeat on **every** connection (reader and
writer) is required so a dead *reader* can never be promoted into the writer
slot (promotion picks the oldest remaining `connSubs` entry).

### Why ping/pong (not readyState / TCP keepalive / backpressure watchdog)

- `readyState` stays `OPEN` on a half-open TCP until the OS TCP timeout
  (minutes–hours) — too slow, and it is the exact failure mode.
- TCP `SO_KEEPALIVE` defaults are hours; not portably tunable per-socket here.
- The backpressure watchdog measures saturation, not liveness; an idle dead
  socket has `bufferedAmount` 0.
- WS ping/pong (RFC 6455 control frames) is answered **automatically by the
  browser**; no client change. `ws@8.20.0` exposes `raw.ping()` /
  `raw.on('pong')` / `raw.terminate()` via `WSContext.raw` (@hono/node-ws
  1.3.1, verified `raw: ws`).

### Footprint (bloat-aware — all three terminal modules are at-ceiling ADR
exceptions; net lines into them ratchet and the pre-commit hook hard-blocks)

1. **NEW** `server/src/terminal/ws-heartbeat.ts` — a pure, timer-free liveness
   monitor (`createHeartbeatMonitor`: `notePong()` + `tick(): "ping"|"terminate"`,
   classic isAlive pattern) plus a thin self-cleaning `startWsHeartbeat(ws,opts)`
   that wires `setInterval` + `raw.ping/terminate` + `raw.on('pong')`, reads the
   interval from `SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS` (default 15 000 ms,
   floor 1 000), `.unref()`s the timer, and stops itself when
   `raw.readyState !== OPEN`. Capability-guarded: no-ops if `raw` lacks
   `ping/terminate/on` (degrades to today's close-driven release — no
   regression in tests/mocks).
2. **NEW** `server/src/terminal/ws-heartbeat.test.ts` — RED-first.
3. **EDIT** `ws-upgrade-handler.ts` — `import` + one `startWsHeartbeat(ws)` call
   at the top of the live-branch `onOpen` (+2 LOC). The self-clean keeps
   `onClose`/`onError` untouched.
4. **EDIT** `shipwright_bloat_baseline.json` — bump `ws-upgrade-handler.ts`
   `current` 527→529 (documented, this spec is the rationale).

No `routes.ts` / `pty-manager.ts` / `index.ts` / `config.ts` edits → zero
ratchet on those.

## Acceptance Criteria

- **AC-1** A fresh monitor that receives no pong terminates after a bounded
  number of ticks; a monitor that receives a pong each interval never
  terminates.
- **AC-2** `startWsHeartbeat` against a fake live raw socket: pings on each
  tick; on sustained missed pongs calls `terminate()` exactly once (then
  self-cleans on the next tick because `readyState` flips).
- **AC-3** `startWsHeartbeat` no-ops (returns a no-op stop) when `ws.raw` is
  absent or lacks `ping`/`terminate`/`on` — no throw.
- **AC-4** Interval resolves from `SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS`,
  clamped to the floor; invalid/absent → default 15 000.
- **AC-5 (no-regression, web)** A live embedded terminal with the heartbeat on
  (short test interval) still reaches `ready`, holds `role: writer`, and stays
  connected across several heartbeat intervals — pings do not break the
  terminal or spuriously flip it read-only.
- **AC-6 (end-to-end reap+promote)** Against a REAL in-process server with REAL
  `ws` sockets: a non-ponging writer (its TCP paused = faithful half-open) is
  reaped by the heartbeat, and the reader receives `writer-promoted` (read-only
  clears without a reload). This also proves `startWsHeartbeat` arms against the
  real `ws.raw` rather than no-op'ing via its capability guard.

## Affected Boundaries

- WS control-frame boundary (`raw.ping`/`raw.on('pong')`/`raw.terminate`).
- `process.env` read boundary (`SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS`).
- Indirect: the `detach → promote` writer-slot transition (unchanged code,
  newly *reachable* via terminate).

## Confidence Calibration

- **Boundaries touched:** WS control frames (ws@8.20.0 raw socket); env read
  (`SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS`); writer-slot promotion path (reached,
  not modified).
- **Empirical probes run:**
  - Verified `WSContext.raw === ws` socket in @hono/node-ws 1.3.1 dist
    (`raw: ws`, line 101) → `raw.ping/terminate/on/readyState` available.
  - Verified the prod conn-identity is a synthetic `connToken` → the existing
    `bufferedAmount` watchdog is inert (capability "missing") → confirms a
    new liveness signal is genuinely needed, not a duplicate.
  - Verified anti-ratchet hook rule is `measured > current` against the
    on-disk baseline → same-commit `current` bump passes without `--force`.
- **Test Completeness Ledger:** see below — every AC mapped to a test or a
  closed-vocab `untestable` reason.
- **Confidence-pattern check:** depth — the reap path is deterministic and
  unit-tested with injected timers + a fake raw socket (no real wall-clock
  wait). Breadth — monitor logic, wiring, env-resolution, capability-guard,
  and a live web no-regression smoke are each covered. The one genuinely
  un-unit-testable leg (a real half-open TCP from a browser) is covered by
  reasoning + the web smoke proving heartbeat doesn't break a healthy session.

### Test Completeness Ledger

| Behavior | Disposition | Evidence / reason_code |
|---|---|---|
| Monitor terminates on missed pong (AC-1) | tested | `ws-heartbeat.test.ts` monitor cases |
| Monitor never terminates while ponged (AC-1) | tested | `ws-heartbeat.test.ts` |
| Wiring pings each tick; terminates once on death (AC-2) | tested | `ws-heartbeat.test.ts` fake-raw + injected scheduler |
| Self-clean when readyState ≠ OPEN (AC-2) | tested | `ws-heartbeat.test.ts` |
| Capability-guard no-op on missing/partial raw (AC-3) | tested | `ws-heartbeat.test.ts` |
| Env interval resolve + clamp (AC-4) | tested | `ws-heartbeat.test.ts` |
| Live terminal not broken by heartbeat (AC-5) | tested | F0.5 web smoke (short interval, real Chromium) |
| Dead writer reaped → surviving tab auto-promoted (AC-6) — real in-process server + real `ws` sockets; writer made non-ponging by pausing its TCP (faithful half-open equivalent) | tested | `ws-heartbeat-reap-integration.test.ts` — PASSED in ~3 s; **falsified**: with the `startWsHeartbeat` wire removed the reader is never promoted (9 s timeout) |
| `startWsHeartbeat` actually ARMS against the real @hono/node-ws `ws.raw` (not a silent capability-guard no-op) | tested | same integration test — promotion only occurs if the heartbeat pinged + reaped a real socket |

## Review dispositions (external + internal, 2026-05-31)

External `--mode code` (OpenAI via OpenRouter) + internal full review:

- **[external · medium · FIXED]** one-shot terminate gap — if `raw.terminate()`
  threw while `readyState` stayed OPEN the loop would re-terminate every tick.
  Fixed: the terminate branch calls `stop()` unconditionally after a throw-safe
  `terminate()`. Pinned by `ws-heartbeat.test.ts` "terminates exactly once even
  if terminate() throws".
- **[internal · medium · FIXED]** zero-tolerance 2-tick reaper could spuriously
  reap a healthy tab on OS-sleep resume (server interval + peer wake on
  different ticks). Fixed: monitor now tolerates ONE transient miss
  (`DEFAULT_MAX_MISSED_PONGS = 2`); a truly dead socket still reaps in ~2-3
  intervals (~30-45 s at the 15 s default — within the ~30-60 s target).
- **[internal · low · FIXED]** no upper clamp on the interval — a misconfigured
  env could silently make the reaper inert. Fixed: `MAX_HEARTBEAT_MS = 300_000`
  ceiling in `resolveHeartbeatMs`.
- **[internal · medium · ACCEPTED]** `startWsHeartbeat`'s `stop()` is discarded;
  a cleanly-closed socket's interval + `pong` listener live until the next tick
  (≤ one interval) self-cleans on `readyState !== OPEN`. Bounded, `.unref()`'d,
  GC-eligible — wiring `onClose`/`onError` would add ~3 LOC into the at-ceiling
  ADR-103 module for no functional gain. Accepted trade-off.
- **[internal · low · ACCEPTED]** ping interval and pong timeout are coupled (one
  interval of RTT budget per the canonical `ws` isAlive pattern). Idiomatic;
  independent tuning is YAGNI here.
- **[internal · low · HONOURED at F0.5]** AC-5 smoke uses a ≥2 s interval so
  server-side scheduling jitter can't self-inflict a false termination.

## Alternative considered (rejected)

Extend the `pty-manager.ts` watchdog to track liveness centrally (register a
`ping` callback + `recordPong`). Rejected: (a) ratchets the at-ceiling
ADR-101 deep module; (b) couples the manager to WS control-frame mechanics it
otherwise never touches (it works on `connToken`s, not sockets); (c) the
heartbeat is cohesive to the WS body — a dedicated neutral module is the
ADR-103-sanctioned shape (cf. `terminal-reset.ts`). The new module keeps the
mechanics testable without the manager's pty fixtures.

## Out of scope

- HTTPS-over-Tailscale (separate tracked iterate).
- Fixing/retiring the inert `bufferedAmount` watchdog (orthogonal; left as-is —
  no behavior change).
- Any client-side change (browser auto-pongs).

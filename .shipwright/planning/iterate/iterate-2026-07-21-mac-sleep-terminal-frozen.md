# Iterate: embedded terminal stays frozen after a Mac sleep/resume

- **Run ID:** `iterate-2026-07-21-mac-sleep-terminal-frozen`
- **Intent:** BUG (Path C)
- **Complexity:** medium (history-calibrated, `prior_source: history`, n=20)
- **Risk flags:** none from the message; diff is client-only, no I/O boundary
- **Spec Impact:** **NONE** — the fix restores behavior FR-01.28 already
  describes ("Scrollback is saved and replayed when you reconnect"); the spec
  is not wrong, the implementation gives up too early.
- **Affected FRs:** FR-01.28 (Embedded terminal)

## Reported symptom

> "Wenn ich weg gehe vom Mac (er geht in den Sleep Modus) und zurück komme, ist
> das Terminal (embedded) wie eingefroren. Ich kann nicht scrollen und es ist
> anders als auf Windows. Ich muss dann das Browser Tab refreshen und dann
> gehts."

Reporter-supplied environment (2026-07-21):

| Fact | Value |
|---|---|
| Browser | Edge (Chromium) on macOS |
| Sleep shape | Lid closed → hibernate → **password lock screen** on wake |
| Reach | **Over Tailscale** to the Hono server on the Windows host |
| Self-heals? | **Yes — after ~30 s, without a refresh** |

That last row is the decisive one: the reconnect machinery is not missing, it is
**spent too early**, and the eventual recovery rides on a later incidental event.

## Root cause

After an OS resume the socket is *half-open*: the TCP connection died during
sleep but no `close` was ever delivered, so `readyState` still reports `OPEN`.

1. The lock screen clears → Edge regains focus → `focus` fires →
   `wsLiveness.onRefocus` (`client/src/hooks/wsLiveness.ts:135`) correctly
   re-arms the budget and eagerly probes with a ping.
2. `WS_REFOCUS_PROBE_MS` (4 s) elapses unanswered → the socket is closed → the
   reconnect cascade starts.
3. The cascade is a **fixed 5-attempt budget spanning ~6.2 s**
   (`useTerminalSocket.ts:153-154`, `BACKOFF_MS = [200,400,800,1600,3200]`).
   Tailscale needs appreciably longer than 6.2 s to re-establish after an OS
   resume, so **all five attempts are spent against a network that cannot
   answer yet**.
4. Once spent, `scheduleReconnect()` returns early forever
   (`useTerminalSocket.ts:454`) and the per-connection heartbeat was already
   stopped by `onDisconnected()` in the close handler.

**Measured consequence:** `vi.getTimerCount() === 0`. The client is left with
**zero armed timers** — no mechanism exists that could observe the network
coming back. Recovery waits on a *further* `focus` / `visibilitychange` /
`pageshow` event arriving by luck, which is exactly the observed "~30 s, then it
heals itself", and why a tab refresh (fresh mount, fresh budget, network by then
up) always works instantly.

`rearmBudget()` has exactly **one** caller — the refocus handler. There is no
`online`/`offline` handling anywhere in the client (0 matches).

### Why "I cannot scroll" is the same bug, not a second one

In Claude's TUI the terminal is on the **alt-screen**, which has no local
scrollback. `touch-scroll.ts routeScroll` (:215) forwards the scroll to the pty
**over this very socket**; `send()` no-ops when the socket is not `OPEN`
(`useTerminalSocket.ts:227`). A dead socket therefore eats scrolling silently.
A normal-buffer scroll would still work locally — which is why it reads as
"frozen" rather than "disconnected".

### Why Windows differs — corrected 2026-07-21

**A first draft of this spec claimed the Windows host reaches the WebUI over
localhost, so no Tailscale hop applies. The reporter refuted that: he also
drives a Windows laptop → Windows PC over Tailscale. That explanation is
withdrawn.**

The corrected reading is a **race** between two things that both happen on
resume:

- **(a)** the browser window regains focus (lock screen clears) → the eager
  probe runs → the ~6.2 s reconnect budget starts spending;
- **(b)** Tailscale finishes re-establishing → attempts can actually succeed.

If **(b)** wins, the first attempt reconnects in 200 ms and nothing is ever
noticed. If **(a)** wins by more than ~6.2 s, the whole budget is burned against
a network that cannot answer, and the client goes permanently inert.

The Mac apparently loses this race and the Windows laptop apparently wins it.
The most plausible mechanism — and the reporter's own hypothesis — is that
macOS takes longer from lid-open to a routable tailnet than Windows does, where
Modern Standby (S0 low-power idle) can keep the network adapter alive across
sleep so the tunnel is up at the moment of resume.

**This mechanism is UNVERIFIED and is deliberately not load-bearing.** It cannot
be measured from the Windows dev host, and no fix decision rests on it. What is
measured is the defect itself (zero armed timers after ~6.2 s), which holds
regardless of which side wins the race. The Windows laptop is therefore probably
not immune — it merely usually wins.

This is also the decisive argument for the "never give up" fix over "widen the
window": since the time-to-network-return cannot be measured or bounded, **any**
fixed budget is a guess, and the next slower resume (hotel Wi-Fi, VPN
renegotiation, a busier tailnet) reopens the same bug.

## Reproduction (failing tests)

`client/src/hooks/useTerminalSocket.osresume.test.ts` — 2 control probes (pass,
confirming the mechanism model) + 2 repro tests (fail, pinning the defect):

| Test | Before fix |
|---|---|
| PROBE control: refocus probe fires, budget spends to 6 sockets | pass |
| PROBE measurement: `vi.getTimerCount() === 0` after exhaustion | pass |
| REPRO: network returns after budget spent → reconnects | **FAIL** |
| REPRO: `online` event after budget spent → recovers | **FAIL** |

## Acceptance Criteria

- **AC-1** — After the reconnect budget's fast ramp is spent, the client MUST
  remain live: it keeps retrying on a slow, capped cadence for as long as the
  attach is neither cancelled nor replay-only. Never zero armed timers.
- **AC-2** — When the network returns at any later point (t ≫ budget), the
  terminal reconnects on its own within one slow-tail interval, with no focus
  event, no click, and no tab refresh.
- **AC-3** — A browser `online` event re-arms the fast ramp and reconnects
  immediately, so recovery is prompt when the browser does give us the signal.
- **AC-4** — A replay-only (done) attach is still NEVER resurrected — by the
  slow tail, by `online`, or by refocus (existing AC-6 must keep passing).
- **AC-5** — The user can tell the terminal is disconnected: the disconnected /
  reconnecting state is surfaced instead of silently looking frozen.
- **AC-6** — No reconnect storm: a genuinely dead server produces at most one
  attempt per slow-tail interval, not a 200 ms hot loop.

## Chesterton-Fence: why the 5-attempt cap may be changed

`MAX_RECONNECT_ATTEMPTS = 5` entered in the original ADR-067 phase-2 commit
(`6ec170fb`) as part of the first implementation — boilerplate reconnect
hygiene, not a scar from an incident. No ADR or decision-log entry defends it,
and no consumer reads `reconnectAttempts` (0 matches outside the hook). Its
legitimate intent — *do not hammer a dead server at 200 ms forever* — is
preserved by the capped slow tail (AC-6); only the "become permanently inert"
side effect is removed.

## Confidence Calibration

- **Boundaries touched:** browser↔server WebSocket liveness (client half only);
  no serialized-format / file / env boundary. No `touches_io_boundary`.
- **Empirical probes run:**
  - Baseline: 35 existing WS-liveness tests green before any edit.
  - Probe (control): the refocus probe does fire and the budget does spend to
    exactly 6 sockets → my model of the mechanism is correct, not assumed.
  - Probe (measurement): `vi.getTimerCount() === 0` after exhaustion → the
    "inert forever" claim is measured, not reasoned.
  - Fence probe: `git log -S MAX_RECONNECT_ATTEMPTS` → single original commit;
    `grep reconnectAttempts` → no consumers.
- **Test Completeness Ledger:** every behavior this diff introduces or changes.
  **0 untested-testable.**

  | # | Behavior | Status | Evidence |
  |---|---|---|---|
  | 1 | Scheduler settles into a capped tail instead of stopping | `tested` | osresume AC-1 — `getTimerCount() > 0` + exactly +1 attempt per tail interval |
  | 2 | Network returning after the ramp recovers the terminal unaided | `tested` | osresume REPRO (network-returns) |
  | 3 | `online` re-arms the ramp and reconnects immediately | `tested` | osresume REPRO (`online`) |
  | 4 | `online` leaves a live OPEN socket alone (no double attach) | `tested` | osresume AC-3 guard |
  | 5 | Tail never resurrects a replay-only attach on an ABNORMAL close | `tested` | osresume AC-4 |
  | 6 | `online` never resurrects a replay-only attach | `tested` | osresume AC-4 |
  | 7 | Refocus still reconnects immediately, not via the tail | `tested` | refocus AC-4 ×3 (focus / pageshow / visibilitychange) |
  | 8 | `reconnecting` true while a retry is armed, false on recovery | `tested` | osresume AC-5 |
  | 9 | A replay-only attach never claims to be reconnecting | `tested` | osresume AC-5 (replay-only) |
  | 10 | Banner renders while reconnecting, incl. the "no reload" advice | `tested` | TerminalBanners AC-5 |
  | 11 | Banner absent when the socket is healthy | `tested` | TerminalBanners AC-5 |
  | 12 | Banner renders ABOVE read-only | `tested` | TerminalBanners AC-5 (ordering) |
  | 13 | Grace: does not arm before the window elapses | `tested` | shellEffects grace |
  | 14 | Grace: arms once the outage outlives the window | `tested` | shellEffects grace |
  | 15 | Grace: disarms on recovery (self-dismissing) | `tested` | shellEffects grace |
  | 16 | Grace: a blip inside the window never arms (timer cleared) | `tested` | shellEffects grace |
  | 17 | Watchdog reaps an attempt stuck in `CONNECTING`, retry resumes | `tested` | osresume AC-1 (hung connect) — fails without the watchdog |
  | 18 | Out-of-band `online` recovery cancels the armed tail (no delayed 2nd attach) | `tested` | osresume AC-3 guard (tail-cancel) |
  | 19 | Delay policy: ramp → tail → slow tail, never non-positive, monotonic | `tested` | wsReconnectSchedule.test.ts (`nextReconnectDelay`, probed to attempt 1e6) |
  | 20 | `isSlowTail` boundary agrees with the delay policy | `tested` | wsReconnectSchedule.test.ts |
  | 21 | Watchdog: closes stuck CONNECTING; spares OPEN / superseded / cancelled; idempotent clear; re-arm replaces; swallows a close() throw | `tested` | wsReconnectSchedule.test.ts (7 cases) |
  | 22 | Banner softens copy on the slow tail (drops the "not needed" promise) | `tested` | TerminalBanners AC-5 (stalled) |
  | 23 | REAL BROWSER: client keeps retrying past the old 5-attempt budget | `tested` | E2E spec 77 — **verified to FAIL under the restored old cap** (`Expected: > 6, Received: 6`) |
  | 24 | REAL BROWSER: outage shows the reconnecting banner, calm cadence (<1/s) | `tested` | E2E spec 77 (AC-5 + AC-6) |
  | 25 | Real macOS lid-close → Tailscale re-establish → unaided recovery | `untestable` | `requires-physical-device` — needs a genuinely suspending Mac plus a real tailnet renegotiation; neither CI nor a local harness can produce an OS suspend and a tunnel coming back |

- **Confidence-pattern check:**
  - **Asymptote (depth):** the root cause was *measured*, not argued —
    `vi.getTimerCount() === 0` after the ramp. The fix inverts exactly that
    measurement, and the control probes confirmed the mechanism model
    (probe fires, 6 sockets, socket reaped) before any code changed. Digging
    further into the same seam yields no new information; the residual
    uncertainty is environmental (how long a given OS takes to restore a
    tunnel) and is deliberately **not load-bearing** — see the corrected
    Windows section.
  - **Coverage (breadth):** all four recovery triggers are covered (retry tail,
    `online`, `focus`, `pageshow`/`visibilitychange`), plus both negative
    directions that an unbounded retry could break — replay-only resurrection
    (×2 paths) and double-attach on a live socket — plus the entire new banner
    surface including its grace timer in both directions.
  - **Integration composition:** `cross_component` is NOT set. The diff is
    single-component client code; it touches no merge/churn resolver, no
    Claude-Code hook fan-out, no pipeline phase validator and no campaign
    drain, so no `category:"integration"` behavior is owed.

## External code review (openrouter: openai + gemini) — outcome

**One HIGH, raised independently by BOTH reviewers — REFUTED.** Both claimed the
new `online` handler starts a reconnect while the slow-tail timer stays armed,
so it would fire later and open a duplicate socket, stealing our own writer slot.
It does not: the `reconnect` dep passed to `attachWsLiveness`
(`useTerminalSocket.ts:506-512`) clears `reconnectTimerRef` before calling
`connect()`. Both models reviewed the diff in isolation, where that pre-existing
dep is not visible — a instructive failure mode of diff-only review, and the
reason the claim was verified against the source rather than actioned on
agreement. Their suggested *test* was adopted regardless (ledger #18), so the
property is now guaranteed by the suite instead of by a reading.

**One MEDIUM — VALID, fixed.** A connect attempt can sit in `CONNECTING`
indefinitely (a SYN into a blackholed route, exactly what a half-restored tunnel
produces on resume). The retry tail is driven by the `close` event, so no `close`
meant no scheduled retry — reintroducing precisely the inert state AC-1 forbids.
Fixed with a `WS_CONNECT_TIMEOUT_MS` (10 s) watchdog that closes a stuck attempt
and thereby re-enters the normal retry path (ledger #17).

**One MEDIUM (test) — VALID, adopted.** The `online` test did not advance past
the armed tail, so it would have passed even with the suspected double-attach
bug. Now it advances two tail intervals and asserts the socket count is
unchanged.

## File budget — a WRONG call, corrected

An earlier revision of this spec recorded: *"carries no
`shipwright_bloat_baseline.json` entry, so the anti-ratchet hook does not block"*
and deferred the split. **That was false, and the probe behind it was broken.**
The check iterated `baseline.entries` as an object keyed by path, but `entries`
is an ARRAY of `{path, current}` records — so every lookup silently missed and
the absence of output was read as "no entries". The internal code review caught
it. Both touched files were in fact AT their recorded ceiling and both ratcheted:

| file | baseline | after fix (pre-split) | after split |
|---|---|---|---|
| `client/src/hooks/useTerminalSocket.ts` | 532 | 595 ✗ | **516** ✓ |
| `client/src/components/terminal/EmbeddedTerminal.tsx` | 314 | 317 ✗ | **313** ✓ |

`scripts/hooks/anti_ratchet_check.py` would have BLOCKED the commit — and no
gate that was run could have caught it, because it is a git hook, not
vitest/tsc/oxlint. Raising the baseline is itself the contract violation (Group H
audit H3), so the remediation had to be a real extraction:

- `client/src/hooks/wsReconnectSchedule.ts` — the delay policy
  (`nextReconnectDelay` / `isSlowTail`) + the connect watchdog. Pure, no React,
  and now directly unit-tested instead of reachable only through the whole hook.
- `client/src/hooks/wsReadyEnvelope.ts` — the `ready`-envelope back-compat parse
  plus the `TerminalRole` / `TerminalReadyInfo` types that describe it (which
  also broke the import cycle the first extraction created).
- `client/src/components/terminal/useTerminalBannerState.ts` — the shell-owned
  banner state cluster + its per-task reset.

Plus one genuine de-duplication: the 12-setter session reset was copy-pasted in
both the disabled branch and the effect teardown; it is now one
`resetSessionState()`. Net result is the hook **16 lines BELOW** its
pre-existing ceiling, and `anti_ratchet_check.py` exits 0 against the staged
tree (verified, not assumed).

## Internal code review (subagent) — outcome

- **HIGH (anti-ratchet) — VALID, fixed.** See "File budget" above. This is the
  finding that mattered most: it would have hard-blocked the commit, and the
  spec had actively recorded the opposite as fact.
- **MEDIUM (`online` no-ops in its own justification case) — VALID, fixed.** The
  handler guarded on "no socket at all", but an OS resume with the window still
  frontmost leaves the STALE HALF-OPEN socket in place — precisely the case the
  docblock cited. `onOnline` now runs the same `reviveIfStale()` path as a
  refocus, probe included, so it actually covers that resume shape instead of
  falling back to the ~45 s heartbeat reap.
- **MEDIUM (infinite retry against a deterministically refused attach; banner
  asserting a falsehood) — VALID, fixed.** Added the slow-tail backoff
  (`WS_RECONNECT_TAIL_SLOW_MS`, after `WS_RECONNECT_TAIL_SLOW_AFTER` attempts)
  and a softened banner variant. AC-1 is preserved — a retry is still always
  armed; only the cadence and the promise change.
- **LOW ×3 — fixed.** Stale "max 5" contract docblock; unbounded re-render from
  publishing `reconnectAttempts` on every tail tick (now published only during
  the ramp); grace constant exported rather than duplicated.
- **LOW (`exhaustBudget` coupling) — accepted, documented.** The helper's `8000`
  advance requires `WS_RECONNECT_TAIL_MS > 1800`; the comment states the
  arithmetic explicitly.
- **LOW (constructor-throw retries forever) — accepted.** Same class as the
  refused-attach case and now bounded by the 30 s slow tail.
- Review confirmed clean: root-cause (not symptom) fix, replay-only guard
  airtight, no security surface, React lifecycle/StrictMode correct, no pty
  column desync, DO-NOT rules 17-22 untouched, and the AC-4 test modification
  judged **strictly stronger** rather than a weakening.

## Known adjacent risk (NOT addressed — pre-existing)

`attemptsRef` resets to 0 on every socket `open`. A server that accepts the WS
upgrade and then immediately closes would therefore loop at the 200 ms first
rung — with or without this change, since the old cap was likewise reset on each
open. The one real open-then-close case (replay-only) is explicitly guarded, now
on both the clean and the abnormal path. Left alone deliberately: no observed
trigger, and widening scope to a speculative one would dilute a root-cause fix.

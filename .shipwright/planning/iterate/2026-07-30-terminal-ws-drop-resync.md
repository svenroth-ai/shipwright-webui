# Iterate — Terminal smear: dropped WS bytes are never resent and never resynced

- **Run ID:** `iterate-2026-07-30-terminal-ws-drop-resync`
- **Type:** BUG (Path C → F-debug)
- **Complexity:** medium (history-calibrated, n=20)
- **FR:** FR-01.28 (embedded terminal)
- **Report:** 10th user report of the terminal "smear" class. Predecessors:
  CLAUDE.md rule 28 (WebGL glyph atlas, #325) and rule 29 (post-replay redraw
  nudge, #326). This is a **third, independent** mechanism.
- **Branch:** `iterate/terminal-ws-drop-resync` (NEW worktree — the older
  `iterate/terminal-table-smear` holds a WITHDRAWN fix and is reference only)

## Prior art — hypotheses already refuted, do NOT re-run

Recorded 2026-07-29 against the real recording via the production
`HeadlessMirror.serializeStable`:

1. Resize/reflow of the live grid — 0 diff vs a never-resized reference.
2. Snapshot fidelity — 0/2/1 differing lines at three cut points.
3. Post-restore refit reflow across a real width change — 0 diff at 20/60/200 KB.
4. **Blank-the-viewport remedy — built, then WITHDRAWN.** Claude repaints only
   what changes; after `ESC[2J` 41 of 52 lines stay empty through 5 KB of
   output. A session parked at a prompt would show a permanently blank screen —
   strictly worse than the smear.

**Nine repaint/refresh heals have shipped in this class. This iterate adds none.**

## F-debug Phase 1 — Symptom

Letter-level stale characters, worst after a table: `sie und habe` renders as
`sie.undthabe`; `markiert` as `markigrt`. User: *"es bleibt dann einfach"* — it
does not heal. No exception, no stack: the xterm **buffer** is wrong, so this is
renderer-independent (it survived the rule-28 WebGL→DOM default flip).

Mechanism (rule 29, established): Claude Code repaints **differentially** —
`CUP` to address a row, then `ESC[1C` (CUF) to *skip* cells it believes already
correct. **CUF does not erase.** A blank skipped cell stays blank and merely
*looks* like a space; a skipped cell holding **stale** text shows that stale
character through. The first bytes of the real recording show this in the wild:
`S`·CUF·`atus fil`·CUF·`ern` — the `t`s are never written.

The mechanism needs a *divergence* to feed on. Rules 28/29 closed two sources.

## F-debug Phase 2 — Reproduction (100%, first-hand this run)

Real captured pty recording `2f675b25…log` (618 KB, 110×52, main buffer — 0
alt-screen entries). Two terminals fed identical bytes except that one is missing
a byte window, modelling what `deliverWithBackpressure` does to the browser while
the server mirror keeps everything. Truth = the mirror.

| dropped | +10 KB tail | +50 KB | +200 KB |
|---|---|---|---|
| 2 KB | **4 rows wrong** | 0 | 0 |
| 8 KB | **6 rows wrong** | 0 | 0 |
| 32 KB | **28 rows wrong** | **4 rows wrong** | 0 |

Sample stale rows at drop=8 KB (clean vs holed) — note the **table fragment
leaking into a row that should be blank**, which is the reported "tables" case:

```
row  1  clean: ""                            (blank)
        holed: "  │     │        Kriterium"   <- stale table cells
row 35  clean: "oadc+ togglesebackttogall"),uundddasLÜberlebenessen — und die beiden"
        holed: "oad +ntogglesdback todall"),rundedasbÜberlebenring the monorepo one:"
```

A drop **does** produce the corruption, and it heals **only where Claude later
rewrites those cells** — which is why it reads as intermittent, and why it
persists forever when the drop lands at the END of a burst (a table) after which
nothing repaints.

## F-debug Phase 3 — Not a regression

The drop path is original to the ADR-067 backpressure design (AC-3b), not a
recent change. `git log` on `pty-manager.ts` shows the last six touches are
unrelated (redraw nudge #326, spawn-cwd #254, snapshot flush #246, …). Stated
explicitly per F-debug: **this is not a regression**, it is an original defect
that only became visible once rules 28 and 29 removed the louder mechanisms.

## F-debug Phase 4 — Root cause (boundary instrumentation)

**Root-cause statement:** when a WS connection is saturated,
`PtyManager.deliverWithBackpressure` **discards** the pty chunk and never resends
it, and no layer ever resynchronizes the client — so Claude's subsequent
differential (CUF-skipping) repaints are painted onto a permanently holed grid.

The byte loss crosses three boundaries and is discarded at **every** one:

| # | Boundary | `server/src/terminal/pty-manager.ts:1189` etc. | Today |
|---|---|---|---|
| 1 | `deliverWithBackpressure` | `bufferedAmount + incoming > wsBufferBytes` → `return` | chunk dropped, **zero logging** — the path is completely silent |
| 2 | server → client notice | `entry.backpressureRaised` gates `onBackpressure` to **once per episode** | losses are **not countable**; only the first chunk's size is ever reported |
| 3 | client | `useTerminalSocket.ts:352` → `EmbeddedTerminal` prop `onBackpressure` | **`TaskDetailPage` never supplies the prop** → the callback is a no-op. No banner, no counter, no resync |

Because of (1) it was **unproven that the drop fires in real sessions** — hence
telemetry is step 1, before any remedy. Secondary: `useReplayDrainGate.onDataChunk`
trims its 8 MiB queue by dropping the **oldest** chunks, which DO-NOT #18
("replay NEVER drops chunks") forbids.

### Secondary defect found in the remedy's own primitive (in scope, live today)

Building the resync surfaced a real, previously-unknown defect. The client's
`onReplaySnapshot` does `term.reset()` then `term.write(snapshot)`. Measured
against the real recording:

| restore strategy | rows wrong vs mirror |
|---|---|
| fresh terminal + `write(snap)` | **0 / 52** |
| `reset()` + `write(snap)` on a **used** terminal | **51 / 52** |
| `reset()` + `ESC[H` + `write(snap)` | **0 / 52** |

Bisection localizes the divergence to the payload's **very first character**: on a
fresh terminal a leading space advances the cursor to `(1,0)`; after `reset()` on a
used terminal the cursor stays at `(0,0)`. The whole restored grid therefore lands
one row off. Three mechanism hypotheses were **refuted** (deferred/pending wrap;
async ordering — an empty write, a microtask and a macrotask tick all still give
51; a surviving `DECSTBM` scroll region — every observable state is identical
before the write). Not further reduced into xterm.js internals; the remedy is
deterministic, minimal, and pinned by a test built from the real bytes.

**This is live in production today**, independently of this iterate: a WS
reconnect (network blip / OS sleep) delivers a *second* `replay_snapshot` into the
same, already-used xterm — exactly the 51/52 case.

## Acceptance criteria

**AC-1 — the drop path is no longer silent.** Every discarded chunk is counted
(count + cumulative bytes + episode count, per task/connection) and surfaced in
the server log, rate-limited so a saturation storm cannot flood it.

**AC-2 — losses are countable end to end.** The client is told the **cumulative**
bytes lost for an episode, not just the first chunk's size. The existing prompt
first-drop notice is preserved; a closing notice carries the episode total, emitted
when delivery resumes (i.e. when the socket can actually carry it).

**AC-3 — the client resynchronizes instead of painting onto a hole.** On
`droppedBytes > 0` the client requests a fresh full-grid snapshot
(`{type:"resync"}`); the server answers via the **existing** ADR-092 live-first /
disk-fallback resolver and the **existing** `replay_snapshot` envelope. Throttled
server-side; permitted for readers (it pokes no pty), unlike `redraw`.

**AC-4 — the resync restores the grid byte-exactly.** Restoring a snapshot into an
already-used terminal is grid-identical to the server mirror (0/52 rows), not one
row off. Fixes the reconnect-replay case too.

**AC-5 — no new repaint/refresh heal.** The full-grid snapshot *is* the heal; the
existing rule-29 nudge follows automatically because a resync flows through
`onReplaySnapshot → settleReplayGate → onReplaySettled`.

**AC-6 — the DO-NOT #18 violation in the drain queue is closed.** The 8 MiB queue
must not silently drop the oldest chunks; on overflow it requests a resync instead.

## Affected boundaries

- WS protocol (inbound `resync`; outbound `backpressure` gains cumulative fields)
  — **`touches_io_boundary`**: a serialized producer→consumer contract.
- pty→WS delivery path (`deliverWithBackpressure`).
- Client replay/restore path (`useReplayDrainGate`, `useTerminalSocket`).

## Bloat constraint (hard)

`pty-manager.ts` (1266, exception ADR-101) and `ws-upgrade-handler.ts` (565,
exception ADR-103) are baseline entries: the pre-commit gate blocks on
`measured > current`. New logic therefore lands in **new modules**; the touched
files take wiring only, and baseline `current` + `note` are updated for genuine
growth exactly as #326 did.

## Confidence Calibration

- **Boundaries touched:** WS envelope contract (serialized producer→consumer),
  pty→WS delivery path, client snapshot-restore. → `touches_io_boundary`.
- **Empirical probes run (all first-hand this run):**
  1. **Drop → smear, reproduced** from the real recording via the production
     `HeadlessMirror.serializeStable`: 4/6/28 rows wrong at 2/8/32 KB drops, with
     verbatim stale-row samples including a table fragment leaking into a row that
     should be blank. Heals only where Claude later rewrites those cells.
  2. **Snapshot roundtrip fidelity = 0 diff** at four cut points — independently
     re-confirms prior refutation #2, and told me the divergence was NOT in
     serialization.
  3. **`reset()`-restore off-by-one localized by bisection** to the payload's very
     first character (fresh terminal → cursor `(1,0)`; after `reset()` on a used
     terminal → `(0,0)`, i.e. the byte is swallowed).
  4. **Root cause identified and falsifiable:** `Terminal.reset()` does not reset
     the escape-sequence PARSER; all six truncation classes swallow, and `CAN`
     alone recovers all six. The real recording's reproducing cut ends with
     `ESC [ 3 8 ; 2` — a half-written truecolor CSI, as predicted.
  5. **Four hypotheses refuted** and recorded so they are not re-run: deferred/
     pending wrap; async write ordering (empty write, microtask AND macrotask tick
     all still swallow); a surviving `DECSTBM` scroll region; and (from the prior
     session) the withdrawn blank-viewport remedy.
  6. **E2E verified load-bearing**: disabling the server resync dispatch makes
     `97-terminal-drop-resync` FAIL (`snapshotsAfterResync: 0`); restored
     byte-identically afterwards.
  7. **Regression attributed, not assumed**: `v0-9-5` AC-4 fails identically with
     the preamble disabled ⇒ pre-existing/environmental, not caused by this change.

- **Test Completeness Ledger** — 6 ACs, 69 behaviours enumerated,
  **0 testable-but-untested**. Enumeration basis: every new/changed exported
  function, every new WS envelope field, every branch of the drop and resync paths,
  plus every defect raised by the two external review rounds.

### External review — findings and disposition

Two rounds against the real diff. **Five findings, all real, all fixed** (none
declined). Recorded because the pattern matters more than the count: every one sat
in a place my own tests structurally could not see.

| Round | Sev | Finding | Fix |
|---|---|---|---|
| 1 | HIGH | WS bridge destructured only `droppedBytes`, stripping every cumulative field — AC-2's countability never crossed the boundary, and the client's tolerant parsing masked it as zeroes | forward the whole notice; `ws-backpressure-envelope.test.ts` |
| 1 | HIGH | `performResync` could interleave with the ATTACH replay: `resyncGate` serialized resync-vs-resync only, while both shared `liveBuffer`/`replayDone`, so whichever finished first set `replayDone = true` and live output was then erased by the other's `term.reset()` | `replayBusy` flag, initialised `true`, cleared in the attach's `finally`; a resync mid-attach is dropped (the attach already emits the full grid) |
| 2 | MED | Only mid-episode logs were throttled, so a socket flapping across the threshold emitted two lines per flap forever — the flood AC-1 forbids | throttle transitions too; first line always emits; suppressed count disclosed |
| 2 | MED | `WeakMap` keyed by a connection would throw `TypeError` on the hot path, because `PtyManager` types a connection as `unknown` and permits a primitive | `Map<unknown, …>`, casts removed; test with a string key |
| 2 | MED | An overflow-triggered resync can only arrive WHILE a snapshot write is in flight; `term.reset()` is synchronous, so the earlier write's still-queued bytes would land on the newer grid | park the snapshot until the in-flight write settles; latest-wins |

**Why my own tests missed the first two** — a test-DESIGN gap, not a coverage count:
the client hook tests call the handler directly with a hand-built notice, and the
real-browser spec **injects** its own synthetic `backpressure` frames. Both ends of
the contract were covered; the server's actual emit between them was not. Each fix
is now fenced by a test I verified fails without it.

| # | Behaviour | Disposition | Evidence |
|---|---|---|---|
| 1 | Every discarded chunk counted (bytes/chunks/episodes) | tested | `backpressure-telemetry.test.ts` |
| 2 | Episode-open logged, naming task + unrecoverability | tested | same |
| 3 | Episode-close logged with episode + session totals | tested | same |
| 4 | Mid-episode logging throttled | tested | same |
| 5 | New episode always logs even inside throttle window | tested | same |
| 6 | Accounting is per-connection, not per-task | tested | same |
| 7 | `release()` forgets a connection | tested | same |
| 8 | Defaults to `console.warn` with no sink | tested | same |
| 9 | Open notice carries cumulative episode bytes | tested | same |
| 10 | Close notice carries accurate total | tested | same |
| 11 | `onDelivered` is a cheap no-op with no open episode | tested | same |
| 12 | PtyManager emits exactly 2 notices per episode (wiring) | tested | `pty-manager.backpressure-notice.test.ts` |
| 13 | Closing notice total correct end-to-end | tested | same |
| 14 | Second episode counted separately, lifetime accumulates | tested | same |
| 15 | No notice when the socket never saturates | tested | same |
| 16 | A healthy conn keeps receiving while another is saturated | tested | same |
| 17 | `isWSInbound` accepts `resync`; ignores stray fields | tested | `ws-resync.test.ts` |
| 18 | `resync` answered with a fresh `replay_snapshot` | tested | same |
| 19 | Resync pauses + resumes the connection | tested | same |
| 20 | Resync resolves live-mirror-first (ADR-092) | tested | same |
| 21 | **Buffered live output is flushed AFTER the snapshot** | tested | same (ordering invariant) |
| 22 | Resolver throw still resumes pty + reopens the gate | tested | same |
| 23 | No snapshot available → no strand, still resumes | tested | same |
| 24 | Resync spam throttled to one snapshot | tested | same |
| 25 | Resync served to a READER, never `read_only` | tested | same |
| 26 | `redraw`/`resize` stay writer-gated (no regression) | tested | same |
| 27 | Gate admits first request | tested | `resync-gate.test.ts` |
| 28 | Gate refuses while in flight | tested | same |
| 29 | Gate refuses inside the minimum interval | tested | same |
| 30 | Gate re-admits after the interval; never latches shut | tested | same |
| 31 | Envelope prepends `CAN`+CUP at the very start | tested | `snapshot-parser-resync.test.ts` |
| 32 | No double-prepend | tested | same |
| 33 | `?1006h` mouse augmentation preserved | tested | same |
| 34 | Safe-when-redundant on a ground-state terminal | tested | same |
| 35 | `reset()` swallows first byte after 6 truncation classes | tested | same (mechanism) |
| 36 | `CAN` recovers all 6 truncation classes | tested | same |
| 37 | Drop leaves stale characters a repaint never erases | tested | same (absolute, both sides) |
| 38 | Envelope restore is byte-exact vs the mirror | tested | same |
| 39 | Restore heals even with the parser stranded mid-CSI | tested | same |
| 40 | Without the preamble the same restore is NOT byte-exact | tested | same |
| 41 | Client requests resync on a notice reporting loss | tested | `useBackpressureResync.test.ts` |
| 42 | Burst of notices coalesced into ONE request | tested | same |
| 43 | A later episode gets its own request | tested | same |
| 44 | No resync when the notice reports no loss | tested | same |
| 45 | Legacy `droppedBytes`-only server still repairs | tested | same |
| 46 | Notice forwarded to the caller's handler | tested | same |
| 47 | No send after unmount | tested | same |
| 48 | Drain-queue overflow announces the loss | tested | `useReplayDrainGate.overflow.test.tsx` |
| 49 | No announcement under the cap | tested | same |
| 50 | Trim never force-drains mid-flight (Bug B fence) | tested | same |
| 51 | Overflow callback optional | tested | same |
| 52 | Real browser: server answers resync for a READER | tested | `97-terminal-drop-resync.spec.ts` (verified load-bearing) |
| 53 | Real browser: notice burst → exactly one outbound resync | tested | same |
| 54 | Whole `BackpressureNotice` crosses the WS boundary | tested | `ws-backpressure-envelope.test.ts` (external review round 1, HIGH) |
| 55 | `episodeEnded` + totals survive the bridge | tested | same |
| 56 | Notice survives a socket that throws mid-send | tested | same |
| 57 | A resync mid-attach-replay is dropped, not interleaved | tested | same (external review round 1, HIGH) |
| 58 | Live output during that window stays buffered | tested | same |
| 59 | Resync is served once the attach replay settles | tested | same |
| 60 | A failed attach replay does not strand the resync gate | tested | same |
| 61 | Episode TRANSITIONS are throttled (flap storm) | tested | `backpressure-telemetry.test.ts` (round 2, medium) |
| 62 | Throttle discloses suppressed-line count | tested | same |
| 63 | Byte volume still counted while lines suppressed | tested | same |
| 64 | First line for a connection always emits | tested | same |
| 65 | A PRIMITIVE connection key does not throw | tested | same (round 2, medium — WeakMap regression) |
| 66 | Snapshot arriving mid-write is parked, not applied | tested | `useReplayDrainGate.overflow.test.tsx` (round 2, medium) |
| 67 | Only the LATEST parked snapshot is applied | tested | same |
| 68 | `onReplaySettled` fires only after the last snapshot | tested | same |
| 69 | Visual confirmation on a live authenticated Claude TUI | **untestable** | `requires-manual-visual-judgment` — the isolated stack has no Claude auth; this is the user's confirmation, as for rules 28/29 |

- **Confidence-pattern check.**
  - *Asymptote (depth):* the causal chain is closed at both ends — the drop is
    proven to produce the reported corruption, and the repair is proven byte-exact
    against the server mirror. The remaining unknown is **frequency in the wild**,
    which is precisely what AC-1's telemetry exists to answer; it is deliberately
    NOT claimed here.
  - *Coverage (breadth):* both boundaries of the new contract are covered from both
    sides (server emit + client parse), the reader path is covered as well as the
    writer path, and the negative arms (no loss → no resync; no preamble → not
    byte-exact; disabled dispatch → E2E fails) prevent vacuous passes.
  - *Integration composition:* `cross_component` is **not** set — no merge/churn
    resolver, hook fan-out, phase validator or campaign-drain path is touched. The
    cross-module composition that does matter (pty→WS→client) is nevertheless
    covered by the wiring tests (#12–16) and the real-browser spec (#52–53).

## Honest limitations

1. **Not yet proven that the drop fires in the user's sessions.** Unproven by
   design — that is what step 1 was for. The resync is correct regardless: feeding a
   differential-repaint TUI a stream with holes is a correctness bug either way
   (cf. DO-NOT #18).
2. **`v0-9-5` AC-4 fails in the isolated stack**, with and without this change
   (attributed by disabling the preamble). Pre-existing/environmental.
3. **The `reset()` mechanism is localized, not reduced into xterm.js internals.**
   Which byte gets swallowed and that `CAN` recovers it are both pinned by tests
   over all six truncation classes; the internal parser state machine was not
   further archaeologised, and three plausible explanations were refuted.

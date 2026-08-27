# Iterate: A closed task's terminal is frozen for scroll/copy, and Reopen never reconnects it

- **Run ID:** `iterate-2026-08-27-terminal-replay-reset-reopen-reconnect`
- **Intent:** BUG (Path C) — two distinct defects reported together by Sven
  after the iterate-2026-08-24 scroll/copy fix (PR #386) shipped but did not
  hold in production.
- **Complexity:** medium (cross-cutting: server WS-attach envelope + client
  socket lifecycle; touches the FR-01.28 replay/reconnect contract three
  callers rely on — board drag-out-of-Done, TaskCard menu, task-detail menu)
- **Risk flags:** none of the canonical trigger paths match (no auth/RLS/
  middleware/migrations/billing/shared-infra/build/io-boundary/CI file
  touched) — classified medium on cross-cutting scope, not a risk flag.
- **Spec Impact:** **NONE** — restores the FR-01.28 replay-only / reconnect
  contract to what the AC already promises; no new capability.
- **Affected FRs:** FR-01.28 (Embedded terminal)

## Root cause — two independent defects, not one

Sven's report bundled three symptoms under "bei closed tasks ist die session
wie eingefroren". Investigation (deep dive, `general-purpose` agent) found
**two** root causes; the third symptom is a *correct* consequence of one of
them, not a separate bug.

### Bug A — a closed task's replay never turns mouse-tracking back off

`server/src/terminal/replay-snapshot.ts` builds the one-shot `replay_snapshot`
envelope sent to a `done`/`launch_failed` attach. If the serialized grid left
mouse tracking (`?1000h`/`?1002h`/`?1003h`/`?9h`) and/or VT200 alternate-scroll
mode (`?1007h`) turned ON — which Claude's TUI does for the whole session — no
teardown ever followed, because **no live pty exists to send one**: the WS
closes right after this one frame (`ws-upgrade-handler.ts`
`buildReplayOnlyHandlers`, code 1000).

Effect in the reader's xterm instance, permanently:
- Mouse tracking ON → xterm disables native DOM text selection
  (`_selectionService.disable()`) → click+drag **copy** silently selects
  nothing.
- Alt-scroll-mode ON → a wheel event becomes synthetic arrow-key bytes routed
  through `onData` → `socket.send`, which is a no-op once the WS has closed →
  **scroll** looks dead.

Matches Sven's exact words: `"Session ended…" aber nichts geht mehr` (neither
scroll nor copy).

### Bug B — Reopen never reconnects the WS (the true "no clean refresh")

`client/src/hooks/useTerminalSocket.ts` latches `sessionReplayOnlyRef.current
= true` on a replay-only `ready` and never reconnects on its own (by design —
otherwise the same snapshot replays forever, flickering). The connect-effect's
dependency array (`[enabled, taskId, urlOverride, resetSessionState]`) never
includes anything that changes on Reopen. All three Reopen entry points
(board drag-out-of-Done → `TaskBoardColumns.tsx`, TaskCard "…" menu →
`TaskCardMenu.tsx`, task-detail "…" menu → `HeaderMenuItems.tsx`) converge on
the same `useReopenExternalTask`/`useSetTaskBoardColumn` hooks → the same
`POST /reopen` route → `setQueryData`/`invalidateQueries` only. `taskState`
reaches `EmbeddedTerminal` reactively (`TaskDetailPage.tsx`:
`taskState={task.state}`), but nothing downstream of that prop ever tells
`useTerminalSocket` to act on it.

A prior fix (iterate-2026-08-16-task-lifecycle-ux-fixes) re-arms
`useAutoLaunch`'s one-shot auto-inject guard on a `done → non-done` edge —
correct, but **inert**, because its own gate (`if (!socket.ready ||
socket.role !== "writer") return;`) can never pass: `socket.ready` never
becomes `true` again once the WS is latched closed. Its own regression test
(`EmbeddedTerminal.reopen-rearm.test.tsx`) cannot see this: its `FakeWebSocket`
never actually closes, so the guard re-arm looked sufficient in isolation
while the socket layer beneath it stayed permanently stuck.

### Symptom C ("je nach Alter muss ich resumen") — correct-by-design, not a bug

Once B is fixed and the WS reconnects, the server re-evaluates
`ptyExistedBeforeAttach` fresh. An old-enough closed task has long since had
its pty reaped by `IdleReaper` (12 h default grace) — there genuinely is no
live process to re-attach to, so the server (correctly) reports
`terminalReset: true` and the UI (correctly) requires an explicit Resume. A
recently-closed task still has a live pty and reconnects straight back into
it. This is the intended ADR-104 behavior once B stops masking it; no change
needed here.

## Fix

1. **`replay-snapshot.ts`** — `buildReplaySnapshotEnvelope` takes a new
   optional `{ tearDownInteractionModes: boolean }`. When set, appends
   `\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?9l\x1b[?1006l\x1b[?1007l` to the
   envelope's tail (after the existing ADR-099 `?1006h` fixup). Deliberately
   does **not** touch `?1049` (alt-screen buffer) — exiting it would swap the
   replayed grid out for whatever the main buffer held before Claude's TUI
   entered the alt screen, trading the reported defect for a worse one (the
   content the user is trying to read/copy would vanish). Safe-when-redundant
   (disabling an already-off mode is a no-op). `ws-upgrade-handler.ts`'s
   replay-only branch is the only caller that passes the option; the live
   attach and the mid-session `resync` path are unchanged (a live pty is
   still there to react to further mouse input, so ADR-099's restoration must
   stay intact for them).
2. **`useTerminalSocket.ts`** — new `sessionEnded?: boolean` option (caller
   passes `taskState === "done" || taskState === "launch_failed"`). A
   dedicated effect (NOT added to the main connect-effect's dependency array)
   watches for a `true → false` edge on it; when seen **while
   `sessionReplayOnlyRef.current` is still latched**, it force-reconnects via
   a fresh ref-held `connect()` closure. Kept as a separate effect rather than
   widening the main effect's deps specifically so an ordinary state tick
   that happens to cross the done boundary on an *already-live* socket never
   gets torn down and reconnected for no reason (verified by a regression
   test — see below). No `key`-remount: the mounted xterm instance and its
   scrollback survive the reconnect.
3. **`EmbeddedTerminal.tsx`** — derives and passes the boolean.

## External LLM Review (Branch A, two calls)

**Iterate mode** (mini-plan vs spec) — deepseek `approve`; openai `revise`,
one real medium finding (edge-case): a Reopen that races the in-flight
replay-only attach (Reopen lands *before* the server's `ready` arrives, or
between `ready` and its follow-up close) could leave the socket stuck,
because the edge-detection effect only observes a transition strictly after
it happens. **Addressed**: the close handler now separately re-checks the
LATEST `sessionEnded` value (via an always-current ref, not the value
captured when the connect-effect last ran) whenever a replay-only close
lands, and reconnects immediately if the task has already been reopened by
then — covering the ordering the edge effect alone cannot. Proven with a
dedicated regression test that reorders the `ready`/close/Reopen sequence.
Two low-severity findings (openai #4, deepseek #3) were style/scoping notes,
already satisfied by the implementation as written (option kept private to
the replay-only boundary; the on/off `?1006h` sequencing already commented).
One low finding (deepseek #1, `enabled` toggling in sync with `sessionEnded`)
does not apply to the actual caller (`EmbeddedTerminal` never varies
`socketEnabled` with `taskState`) — noted, not coded around (YAGNI).

**Architecture mode** (brief vs spec) — both `approve`, no findings: no new
standing mechanism, proportionate to restoring the FR-01.28 contract that
already exists.

**Second finding, caught three ways independently (re-run after the E2E
spec was authored):** re-running the iterate-mode plan review, a fresh
`spec-reviewer` compliance pass, and the code-mode review (diff vs spec)
ALL independently converged on the same real gap: `forceReconnectRef`'s
`connect()` could install a brand-new socket while the in-flight
replay-only socket's own server-initiated close had not yet arrived
(Reopen racing BETWEEN `ready` and its close, not just before `ready`).
The stale socket's eventual close handler had no way to recognize it had
been superseded — it would null out `socketRef` (clobbering the reference
to the already-live replacement) and, because `forceReconnectRef` had
already cleared `replayOnlyRef`, fall through to `scheduleReconnect()`,
spawning a spurious third connection. `spec-reviewer` cited the exact
mechanism verbatim (down to line numbers) and REJECTed on this basis
before code-reviewer ran. **Fix:** a socket-identity guard
(`socketRef.current !== ws`) added to every listener
(`open`/`message`/`close`/`error`) inside `connect()`, mirroring the
`isCurrent(ws)` check `wsReconnectSchedule.ts`'s own reap-watchdog already
used for the identical "a newer socket may have superseded this attempt"
reason — so a stale socket's late event is a no-op once `connect()` has
already installed its replacement into `socketRef`. Deliberately does NOT
explicitly close the stale socket from `forceReconnectRef` (a first draft
did; reverted) — in the synchronous FakeWebSocket test double this let
the stale close's own reconnect branch race the same `connect()` call in
a different way, and in the server contract the stale socket's close is
already in flight from the server side regardless. New regression test
(`EmbeddedTerminal.reopen-reconnect.test.tsx`, 5th scenario) reorders
`ready` → Reopen → (late) `close` and asserts exactly one replacement
connection, that the stale close is a no-op, and that the replacement
stays usable. `useTerminalSocket.test.ts` + the pre-existing `reopen-rearm`
suite re-verified green (82/82 across the 5 targeted files); full client
suite re-verified green (373 files / 3497 tests) after the fix.

**Third finding (`code-reviewer`, MEDIUM, real): stale envelope state
survived into the reconnect window.** Neither reconnect call site
(`forceReconnectRef`, nor the close handler's inline reopen branch) reset
the finished attach's envelope-derived React state — `replayOnly`, `role`,
`terminalReset`, `ptyReused`, `scrollbackBytes`/`retentionDays`/
`scrollbackDir` — before calling `connect()`. `TerminalBanners` therefore
kept rendering "Session ended — viewing historical terminal scrollback
only." (and, if the reader-role read-only banner was armed, that one too)
until the *new* attach's own `ready` envelope eventually overwrote those
fields — visibly recreating an instance of the exact frozen-looking
symptom this iterate exists to fix, in the specific window right after
Reopen when the reconnect is supposed to read as quiet. **Fix:** both
call sites now invoke the pre-existing `resetSessionState()` helper
(already used elsewhere in the hook for a full-teardown reset) immediately
before their `connect()` call. New assertions in
`EmbeddedTerminal.reopen-reconnect.test.tsx` (both the normal
close-then-Reopen scenario and the HIGH #1 race scenario) prove the
`embedded-terminal-replay-only` `data-testid` node is present right before
Reopen and gone immediately after — not merely after the replacement
socket's own `ready` arrives. Re-verified: 82/82 across the 5 targeted
test files, full client suite green (373 files / 3497 tests), `tsc
--noEmit` clean, anti-ratchet gate clean (both touched files' bloat
baseline entries bumped with documented notes), E2E spec 105 re-passed.

**Fourth finding (`doubt-reviewer`, HIGH, real): the teardown's own stated
scope boundary was false for one of its own sub-cases.** AC-2's rationale
for restricting the teardown to the replay-only branch ("a live pty is
still there to react to further mouse input") does not hold for
`buildLiveHandlers`'s no-live-pty sub-case — the reaped-pty / server-restart
attach (`ptyExistedBeforeAttach === false`), the exact same synchronous
probe `terminalReset` is derived from, discussed elsewhere in this spec's
own Symptom-C section for an unrelated reason (the reset banner). That
attach replays the same kind of stale on-disk cell-state snapshot as the
replay-only branch (`ws-upgrade-handler.ts`'s pre-spawn `resolveReplaySnapshot`
call, resolved before a live pty exists) and hands it to a brand-new bare
shell — which never asked for whatever mouse-tracking/alt-scroll modes the
snapshot encodes and will never turn them off, reproducing Bug A's exact
dead-scroll/dead-copy defect through this other call site, right during the
reset banner's pre-Resume window (whose own copy — "your last terminal
screen is kept in this task's scrollback" — invites the user to look at
the very content that is now unscrollable/uncopyable). **Fix:** the same
`sendReplaySnapshot` call now also passes `{ tearDownInteractionModes: true
}`, gated on `!ptyExistedBeforeAttach` directly (not on `terminalReset`,
which additionally requires `firstJsonlObservedAt` and would wrongly skip
the teardown on a first-ever-launch edge case — though that case sends no
snapshot at all in practice, since none exists yet). The mid-session
`performResync` call site (always reached only while a live pty exists) is
untouched. Two new regression tests prove the teardown IS appended when no
live pty existed before the attach, and is NOT appended when one did
(re-affirming AC-2's narrower, now-correct scope) — landed in a new sibling
file, `ws-upgrade-handler.replay-teardown.test.ts` (a self-contained,
mechanical split off `ws-upgrade-handler.test.ts`, no logic change, done to
clear the Stop-hook bloat gate rather than growing an already-300-line file).
Re-verified: 2 new + 29 pre-existing server terminal tests green, full
server suite green (322/323 files / 3725 tests, 3 pre-existing skips), `tsc
--noEmit` clean (server), anti-ratchet gate clean (`ws-upgrade-handler.ts`'s
baseline bumped with a documented note), E2E spec 105 re-passed.

**Fifth finding (`doubt-reviewer`, HIGH, second pass, real): a previously-
inert client-side guard bug became live because of Bug B's own fix.**
`useAutoLaunch.ts`'s "Reused-pty arming" effect (the guard from
`fix-resume-guard-survives-reload`, 2026-05-17) latches
`ptyReusedGuardEvaluatedRef` **once** off the first `ready` it ever sees and
is reset only on a `taskId` change. For a `done` task, that first `ready` is
always the replay-only branch, which hardcodes `ptyReused: false` — a
fabricated value, since replay-only never inspects the real pty. Before
this iterate's Bug-B fix, that latch was harmless: the socket never
reconnected, so no second `ready` with the REAL `ptyReused` value ever
arrived to be (wrongly) ignored. Once Reopen genuinely reconnects, the
reconnect's live `ready` commonly carries `ptyReused: true` (the old pty
usually survives the close, per `IdleReaper`'s 12h grace — the same case
this spec's own Symptom-C section already discusses) — but the guard effect
early-returns because it considers itself already evaluated, so that
`true` is silently dropped. Meanwhile the pre-existing Reopen re-arm effect
(iterate-2026-08-16) unconditionally force-unarms the *other* one-shot
guard (`launchInjectedThisPtyLifetimeRef`) on every `done`→non-`done` edge.
Net effect: after Reopen, the auto-inject guard reads as unarmed even
though the reconnected pty is genuinely reused — a Resume click soon after
Reopen would auto-inject `claude --resume <uuid>` directly into what may
still be a live Claude TUI, exactly the hazard the reused-pty guard exists
to prevent. **First fix attempt (REJECTED by `spec-reviewer` re-verification):**
the Reopen re-arm effect resetting `ptyReusedGuardEvaluatedRef.current = false`
alone. `spec-reviewer` traced a residual race directly against
`EmbeddedTerminal.reopen-reconnect.test.tsx`'s existing AC-7 precondition
(Reopen firing before the original attach's `ready` ever arrives): the
one-shot reset can itself be consumed by that ORIGINAL, now-stale
replay-only `ready` landing AFTER the reset but BEFORE the genuine
reconnect's `ready` — re-latching the guard off the fabricated
`ptyReused: false` a second time, in a different timing window. Reviewed
in parallel, `code-reviewer` did not catch this (it reasoned only about
same-commit races). **Corrected fix:** rather than continuing to chase
timing windows, the "Reused-pty arming" effect now unconditionally skips
evaluation whenever `socket.replayOnly === true` — a replay-only ready's
`ptyReused` is definitionally fabricated regardless of arrival order, so
it can never latch or consume the one-shot slot. The `taskState`-triggered
reset is kept alongside this (not replaced), to re-open the slot for a
task whose guard had already latched `true` from a genuine live `ready`
long before it ever went `done`. New regression tests in
`useAutoLaunch.reopen-ptyreused.test.ts`: (1) drives the straightforward
sequence (replay-only `ready(ptyReused:false)` → Reopen → reconnect
`ready(ptyReused:true)` → pending launch) and asserts it parks behind
manual "Send to terminal"; (2) drives the AC-7 race spec-reviewer found —
Reopen fires before the original `ready` arrives, THEN the stale
replay-only `ready` lands, THEN the genuine reconnect `ready` arrives —
and asserts the same. Both verified to genuinely fail without the
replayOnly-skip fix (falsification check: temporarily removing just that
one line reproduces the auto-inject on test 2) and pass with it.
Re-verified: full client suite green (374 files / 3499 tests), `tsc
--noEmit` clean, anti-ratchet gate clean (`useAutoLaunch.ts` trimmed to
land exactly at the 300-line limit rather than crossing it), E2E spec 105
re-passed.

**Sixth finding (`doubt-reviewer`, MEDIUM + LOW/advisory, third pass, real):
two more consequences of Bug B's own fix newly making a second reconnect
reachable on an already-mounted `EmbeddedTerminal`.**

*(a, MEDIUM)* `client/src/components/terminal/useTerminalBannerState.ts`'s
`resetBannerDismissed` — the ADR-104 reset-banner dismissal flag — had the
exact same shape as the fifth finding's bug: a per-task latch reset only on
`taskId` change. Before this iterate, Reopen never reconnected the socket,
so a *second* `terminalReset: true` on the same mounted instance was
unreachable without a full page reload (which wipes the flag for free via
remount). Now that Reopen genuinely reconnects, a task can hit a mid-session
reset, have the user dismiss the banner, later go `done`, have its pty
reaped while closed (`IdleReaper`, the same Symptom-C case this spec already
discusses), and get Reopened — the reconnect correctly reports a NEW
`terminalReset: true` and the auto-inject guard correctly re-arms (safety
was never at risk), but the banner explaining *why* stayed silently
suppressed by the earlier dismissal. **Fix:** `useTerminalBannerState` now
takes `taskState` and resets `resetBannerDismissed` on the same
`done`→non-`done` edge `useAutoLaunch`'s Reopen re-arm already uses. New
tests in `useTerminalBannerState.test.ts` cover the re-arm, that an
unrelated `taskState` change (e.g. `draft`→`active`) does NOT clear an
active dismissal, and that a `taskId` change still clears it (pre-existing
behavior, unaffected) — verified to genuinely fail without the fix
(falsification check) and pass with it.

*(b, LOW/advisory)* `client/src/hooks/useTerminalSocket.ts`'s `sessionEnded`
edge-detection effect compares against `prevSessionEndedRef`, which was
never resynced on a `taskId` change. AC-4/AC-5's no-spurious-reconnect
guarantee held today only because `sessionReplayOnlyRef` (also read by that
same edge check) is already reset by the earlier-declared connect-effect in
the same commit — an implicit, untested cross-effect-declaration-order
dependency, not a currently-reachable bug. **Fix:** moved the ref's
declaration up and reset it in the connect-effect's setup alongside
`replayOnlyRef`/`sessionReplayOnlyRef`, so the invariant holds structurally
regardless of the two effects' relative order. No new test added — the
scenario isn't reproducibly *broken* today (that's the point: it's
defense-in-depth, not a fix for a live failure), and the existing full
client suite continues to exercise every taskId/sessionEnded-driven
reconnect path.

Re-verified: full client suite green (375 files / 3502 tests), `tsc
--noEmit` clean, anti-ratchet gate clean (`useTerminalSocket.ts` baseline
bumped with a documented note; `useTerminalBannerState.ts`/its new test
file are both well under the 300-line limit), oxlint clean.

**Seventh finding (`doubt-reviewer`, MEDIUM, fourth pass, real): a THIRD
per-task latch with the same shape as findings 5 and 6a — this time in the
prompt-readiness handshake itself.** `useReplayDrainGate`'s
`dataSeenInitiallyRef`/`lastPtyDataAtRef` (the bookkeeping
`useAutoLaunch.ts`'s auto-inject handshake reads to decide whether a fresh
pty has quiesced) are reset only on `taskId` change — never on the Reopen
`done`→non-`done` edge, which the pre-existing "Reopen re-arm" effect
already re-arms for the OTHER two latches (findings 5 and 6a) but never
touched this third one. Concrete failing scenario, newly reachable only
because of this iterate's own Bug-B fix: a task runs a real session (data
flows, `dataSeenInitiallyRef` → true, `lastPtyDataAtRef` → a real, later
stale timestamp), goes `done`, has its pty reaped while closed
(Symptom-C's own scenario), and is Reopened. The reconnect correctly
re-arms the auto-inject guard (`terminalReset: true`) and spawns a
genuinely fresh bare shell — but the handshake's very FIRST poll reads the
stale, ancient `lastPtyDataAtRef` as "already quiesced" and dispatches
`claude --resume` with ZERO wait, before the new shell has rendered a
single byte of its own prompt — defeating the handshake's entire purpose
(its own docblock: "250 ms quiesce after first data byte OR 1500 ms
silence grace") in exactly the window this iterate exists to make
reachable. **First fix attempt (REJECTED by `code-reviewer`):** added
`gate.resetGate()` + zeroing `gate.dataSeenInitiallyRef`/
`gate.lastPtyDataAtRef` to the existing `taskState`-keyed Reopen re-arm
effect, mirroring the `taskId`-change reset. New regression test
`useAutoLaunch.reopen-gate-reset.test.ts` drove: real (stale) data
bookkeeping set AFTER mount (so the pre-existing `taskId`-mount reset
doesn't mask the scenario) → Reopen → a fresh reconnect ready
(`terminalReset:true`, `ptyReused:false`, zero data yet) → a pending
launch — asserting the dispatch does NOT fire instantly. Falsification-
verified to genuinely fail without the fix (the first draft of this test
initially passed even without the fix, because the gate's initial values
were being silently wiped by the pre-existing `taskId`-mount effect before
the Reopen step ever ran; corrected by setting the stale values AFTER
mount).

**Eighth finding (`code-reviewer`, MEDIUM, real): the first fix attempt
reset unconditionally on every `taskState` tick, not only on a real
reconnect.** A `done`→non-`done` tick can fire with the socket/pty
completely undisturbed (the sibling `useTerminalSocket.ts` documents this
exact "transient flip" case for a different effect, which is why that
effect gates narrowly on a replay-only ref rather than the raw taskState
edge). Calling `gate.resetGate()` on such a tick could silently clobber a
`useBackpressureResync`-triggered snapshot mid-flight (queue cleared,
generation bumped, its settle callback orphaned) — a silent drop DO-NOT
#18 forbids. **Corrected fix:** moved the reset off the `taskState` edge
entirely and onto the pre-existing `socket.terminalReset === true`-keyed
effect — a server-derived "this pty is genuinely fresh" signal that
cannot fire on an undisturbed tick, and correctly stays `false` when
Reopen's pty survived (`ptyReused: true`). `useAutoLaunch.reopen-gate-
reset.test.ts` was restructured to assert the reset only after the
`terminalReset:true` transition (not the plain `taskState` transition).

**Ninth finding (`doubt-reviewer`, HIGH, fifth pass, real): even on the
corrected `terminalReset` edge, `gate.resetGate()` itself is unsafe here.**
Reopen never remounts the xterm `Terminal` instance, so an OLD socket's
`replay_snapshot` write can still be draining (asynchronously, rAF-
chunked — worse on a force-mounted hidden terminal) when the new,
reconnected socket's `terminalReset: true` arrives. `gate.resetGate()`
clears `replaySnapshotInFlightRef` unconditionally, which is scoped to the
replay-drain queue's own mid-write park protection, not the prompt-
readiness bookkeeping the fix was meant to touch — clobbering it lets the
new socket's own `replay_snapshot` apply immediately (`term.reset()` +
`term.write()`) instead of parking behind the still-draining old write,
reintroducing the interleaved-write buffer corruption
(`useReplayDrainGate.ts`'s own header doc) this whole mechanism exists to
prevent. **Fix:** dropped the `gate.resetGate()` call from the
`terminalReset` effect entirely — only the two named prompt-readiness refs
(`dataSeenInitiallyRef`, `lastPtyDataAtRef`) are reset there. The drain
gate's existing generation-check + mid-write park logic already handles a
new snapshot arriving while an old one drains, provided nothing external
clears `replaySnapshotInFlightRef` out from under it. `useAutoLaunch.ts`'s
`taskId`-change effect keeps its own `gate.resetGate()` call — a `taskId`
change mounts a brand-new `Terminal` instance, so no old write can be
in flight on it. `useAutoLaunch.reopen-gate-reset.test.ts` gained
assertions that `gate.resetGate` is never called on the Reopen/
`terminalReset` path (scoped past the mount's own legitimate call via
`mockClear()`). Falsification-verified: reintroducing `gate.resetGate()`
into the `terminalReset` effect makes the new assertion fail as expected;
removed and reconfirmed green.

Doubt-reviewer's fifth pass also raised a **tenth, advisory/maintainability
finding (MEDIUM, no live bug)**: `useAutoLaunch.ts`'s `taskId`-change reset
block and its `terminalReset` reset block duplicate several lines, and
findings 5/6a/7 were each an instance of "added to one block, not the
other." **Original rebuttal (SUPERSEDED by finding 11 below — kept for the
record):** claimed the two blocks were correctly DIVERGENT because `taskId`
change legitimately calls `gate.resetGate()` (fresh `Terminal` instance
assumed guaranteed) while `terminalReset` legitimately must not. Finding 11
found that premise false, so as of this iterate the two blocks are once
again IDENTICAL in what they reset (neither calls `gate.resetGate()`) —
the duplication concern stands, unaddressed, same as before finding 9.

**Eleventh finding (`code-reviewer`, HIGH, re-verifying finding 9's fix,
real): the surviving `gate.resetGate()` call — in the `taskId`-change
effect — rests on the same false premise finding 9 just disproved for the
`terminalReset` edge.** The fix and finding 9's own rebuttal both asserted
"a `taskId` change mounts a brand-new `Terminal` instance." Verified false
by reading the actual mount lifecycle: `EmbeddedTerminal.tsx`'s xterm
mount-effect has an **empty** dependency array (not `[taskId]`), and no
call site keys `<EmbeddedTerminal>` by `taskId` — not `TaskDetailPage.tsx`
(`<EmbeddedTerminal taskId={taskId} .../>`, no `key`), not the route
element, not the shared `<Outlet />`. React Router does not remount on a
param-only change, so ordinary task-to-task navigation (many
`navigate(`/tasks/${id}`)` call sites exist: `LogEntryList.tsx`,
`TaskCard.tsx`, `TerminalLaunchButton.tsx`, etc.) leaves the SAME `Terminal`
instance mounted. Task A's `replay_snapshot` write can still be draining
into it when the user navigates to task B; the `taskId`-change effect's
`gate.resetGate()` would clobber `replaySnapshotInFlightRef` under that
write exactly as finding 9 described for Reopen — just reachable via plain
navigation instead. **Fix:** dropped `gate.resetGate()` from the
`taskId`-change effect too; it now resets only the same two named refs as
the `terminalReset` effect. Verified self-healing without any external
reset: `useReplayDrainGate`'s own `settleReplayGate` unconditionally clears
`replaySnapshotInFlightRef` at the top of both its completion-callback and
5-second-watchdog paths regardless of `disposedRef`/`termRef` state, so a
stale in-flight flag from an abandoned task can never wedge permanently.
New test in `useAutoLaunch.reopen-gate-reset.test.ts`: drives a `taskId`
change with stale prompt-readiness bookkeeping and asserts the refs reset
while `gate.resetGate` is never called. Falsification-verified: reverting
the fix (`gate.resetGate()` restored) makes the new test genuinely fail;
restored and reconfirmed green.

Re-verified after finding 11: full client terminal-suite green (38 files /
471 tests), `tsc --noEmit` clean, anti-ratchet gate clean
(`useAutoLaunch.ts` at 295 lines, `useAutoLaunch.reopen-gate-reset.test.ts`
at 190 lines). `gate.resetGate()` is now called from NOWHERE in
`useAutoLaunch.ts` — the drain gate's own internal lifecycle (generation
counter + the two settle paths above) is sufficient, and no caller needs
to force it.

A sixth `doubt-reviewer` pass (spawned in parallel with the code-reviewer
call that surfaced finding 11, on the pre-finding-11 diff) independently
found the same gap as finding 11 — recorded here as confirmation, not a
new item — plus two genuinely new findings.

**Twelfth finding (`doubt-reviewer`, MEDIUM, sixth pass, real): the Reopen
re-arm edge checks `prev === "done"` only, missing `launch_failed`, which
this same iterate's own `sessionEnded` derivation
(`EmbeddedTerminal.tsx`: `taskState === "done" || taskState ===
"launch_failed"`) already treats identically.** Concrete scenario: a
mid-session reset banner is dismissed, the session later dies into
`launch_failed`, and the user clicks Retry
(`LaunchFailureRecovery.tsx`) — `taskState` flips `launch_failed →
active` (no `taskId` change, no remount) and the reconnect can genuinely
re-report a fresh `terminalReset: true`, but `useTerminalBannerState.ts`'s
`resetBannerDismissed` was never reset (`prev` was `"launch_failed"`, not
`"done"`), silently suppressing the new banner — finding 6a's exact
mechanism, reachable through the other terminal state. The parallel
`useAutoLaunch.ts` guard refs (`launchInjectedThisPtyLifetimeRef`,
`ptyReusedGuardEvaluatedRef`) have the same gap, but it is UX-only there
(an unnecessary manual-confirm park on a fresh pty), never a
double-inject safety hole — the "Reused-pty arming" effect derives
entirely from `socket.ptyReused`/`socket.replayOnly`, not `taskState`, so
the dangerous direction stays independently protected. **Fix:** both
effects now compare `wasEnded = prev === "done" || prev ===
"launch_failed"` against `isEnded` the same way, mirroring `sessionEnded`
exactly. New tests: `useTerminalBannerState.test.ts` drives
`launch_failed → active` and asserts the dismissal clears;
`useAutoLaunch.reopen-ptyreused.test.ts` drives a resumed pty
(`ptyReused:true`, latching both guard refs) → `launch_failed` → Retry
with a genuinely fresh pty (`ptyReused:false`) and asserts the launch
auto-injects instead of wrongly parking behind manual confirm (this is
the test that actually falsifies — an initial attempt using a
replay-only ready to seed the latch passed even without the fix, because
finding 5's own `replayOnly === true` skip means a replay-only ready
never latches `ptyReusedGuardEvaluatedRef` in the first place; corrected
to seed the latch via a genuine live ready). Falsification-verified both
ways.

**Thirteenth finding (`doubt-reviewer`, MEDIUM, sixth pass, advisory/test-
completeness): every regression test for findings 9 and 11 mocks
`useReplayDrainGate` entirely, so `expect(gate.resetGate).not.toHaveBeenCalled()`
only proves the literal function reference was never invoked — it proves
nothing about whether the REAL park-vs-apply-immediately mechanism those
findings' fixes protect still works.** A future refactor that reintroduces
the same clobber through a different shape (e.g. inlining
`replaySnapshotInFlightRef.current = false` directly instead of calling
the now-forbidden `gate.resetGate()`) would pass every existing test
while silently reintroducing the corruption. **Addressed:** new
`useReplayDrainGate.inflight-reset-race.test.tsx` exercises the REAL,
un-mocked `useReplayDrainGate` against a deferred-callback `Terminal`
double — proving (a) a new `replay_snapshot` arriving while an old write
is genuinely still draining PARKS rather than applies immediately, and
applies cleanly once the old write settles; and (b) as a regression
guard, calling `resetGate()` during that window (the pre-fix shape)
provably DOES make the new snapshot apply immediately instead of
parking, using the same real gate — confirming findings 9/11 closed a
real hole in the actual mechanism, not merely in mock call counts.

Re-verified after findings 12/13: full client terminal-suite green (39
files / 475 tests), `tsc --noEmit` clean, anti-ratchet gate clean
(`useAutoLaunch.ts` at 300 lines — at, not over, the ceiling;
`useTerminalBannerState.ts` at 64 lines).

**Fourteenth item (`code-reviewer` re-verifying finding 12 vs. `doubt-
reviewer`'s 7th pass — a direct disagreement between two reviewers,
resolved by investigation, NOT fixed): should `jsonl_missing` join
`done`/`launch_failed` in the same `wasEnded`/`isEnded` checks?**
`code-reviewer` (MEDIUM): `jsonl_missing` is grouped with `launch_failed`
everywhere the recovery UI decides what to show
(`LaunchFailureRecovery.tsx`, `TaskCard.tsx`, `MissionTopRow.tsx` all use
`launch_failed || jsonl_missing`), so the same staleness findings 12
fixed for `launch_failed` should apply to `jsonl_missing` too.
`doubt-reviewer`'s independent 7th pass, checking the exact same
question, found the OPPOSITE: all four "session-ended" derivations that
exist today (`EmbeddedTerminal.tsx`'s `sessionEnded`, this iterate's two
client latches, AND the server's `ws-upgrade-handler.ts` `isReplayOnly`)
already agree exactly on `{done, launch_failed}` with zero drift, calling
it deliberate rather than an oversight — a clean pass.

**Investigated directly (not merely re-argued) to resolve the
disagreement:** `server/src/external/transcript/routes.ts`'s own comment
states `jsonl_missing` arises when "Claude's 30-day cleanup deletes the
JSONL" on an `active`/`idle`/`awaiting_external_start` task, and
explicitly: "done / launch_failed never flip to jsonl_missing" — i.e.
`jsonl_missing` is reached from a *different* lifecycle edge than
`launch_failed` (a stale-but-possibly-still-fine session losing its
transcript file), not from a launch attempt dying. `server/src/index.ts:446`
groups `jsonl_missing` with `{active, idle, awaiting_external_start}`
for a liveness-adjacent check, not with `{done, launch_failed}`. So the
recovery-UI grouping (which banner/buttons to show a user) and the
WS/pty-bookkeeping grouping (which states this iterate's latches must
re-arm on) are two DIFFERENT concepts that happen to share `launch_failed`
without both needing to share `jsonl_missing` — `code-reviewer`'s citation
was real but answered a different question than the one it was applied to.
Also confirmed `LaunchFailureRecovery.tsx`'s `recover()` routes BOTH
states through the identical `useLaunchTask` + `dispatchAutoLaunch` call,
so the two states are not fully unrelated either — there IS a real,
unresolved question of whether `EmbeddedTerminal.tsx`'s `sessionEnded`
(the actual WS-reconnect TRIGGER, not just these two bookkeeping latches)
should also treat `jsonl_missing` as ended, given Retry uses the same
dispatch path.

**Rebuttal — not fixed in this iterate:** resolving that question
correctly requires changing the WS-reconnect trigger itself
(`EmbeddedTerminal.tsx`'s `sessionEnded`, consumed by
`useTerminalSocket.ts`) and confirming the SERVER's `isReplayOnly`
contract behaves sanely for a `jsonl_missing` attach — both squarely
outside this iterate's declared Bug A (mouse-tracking teardown) / Bug B
(Reopen reconnect) scope, and higher-risk than the client-only bookkeeping
fixes this cascade has made so far (a wrong WS-reconnect-trigger change
could affect every `jsonl_missing` task's terminal, not just a Retry
click). Fixing only the two client latches (as `code-reviewer` suggested)
without also fixing the trigger would be inert in production — the
socket layer would never even produce a fresh `terminalReset` on that
edge for the latches to protect against — so a partial fix was rejected
as worse than no fix (looks addressed, isn't). Left as a documented,
explicitly-deferred question for a follow-up bug/iterate, not silently
dropped.

## Acceptance Criteria

- **AC-1** — A `done`/`launch_failed` replay-only envelope carries a full
  mouse-tracking + alt-scroll teardown after the existing `?1006h` fixup;
  `?1049` is never touched.
- **AC-2** — The teardown is a no-op by default (opts omitted). It fires on
  exactly two call sites: the replay-only branch (AC-1), and the live-branch
  attach when no live pty existed before this attach (`!ptyExistedBeforeAttach`
  — reaped pty / server restart; fourth finding above). The mid-session
  `resync` path, and the live-branch attach when a pty DID already exist,
  are byte-for-byte unchanged from before this fix.
- **AC-3** — Once a replay-only WS has closed (code 1000), Reopen (task.state
  leaves `done`/`launch_failed`) opens a fresh WS connection without a page
  reload and without remounting the xterm instance.
- **AC-4** — While the task stays `done`, no unrelated re-render resurrects
  the finished attach (no reconnect loop / flicker regression).
- **AC-5** — An already-live, healthy socket is never torn down just because
  `taskState` ticks across the done/launch_failed boundary while it is
  connected — only a socket that actually latched a replay-only close reacts.
- **AC-6** — No regression: the full client + server unit suites, and the
  existing `EmbeddedTerminal.reopen-rearm.test.tsx` (re-arm-on-reopen guard),
  stay green.
- **AC-7** — A Reopen that races the in-flight replay-only attach (before
  `ready` arrives, or between `ready` and its close) still reconnects once
  the close lands, reading the task's current state rather than a stale
  snapshot. A caller that never wires task lifecycle at all (`sessionEnded`
  stays `undefined`) sees no behavior change — never mistaken for "confirmed
  live", never reconnect-loops.
- **AC-8** — After Reopen, the reused-pty auto-inject guard evaluates the
  RECONNECTED attach's real `ptyReused` value, not a replay-only attach's
  fabricated `ptyReused: false` — a Resume soon after Reopen onto a pty that
  survived the close (`ptyReused: true`) parks behind manual "Send to
  terminal" instead of auto-injecting `claude --resume` into a possibly-live
  Claude TUI. Holds regardless of ordering: a replay-only `ready` — whether
  from the pre-Reopen attach or a stale one arriving late — never latches
  or consumes the guard's one-shot evaluation slot, so it cannot shadow the
  genuine reconnect `ready` no matter which lands first.
- **AC-9** — After Reopen, a previously-dismissed reset banner re-arms on
  the same `done`→non-`done` edge as the auto-inject guard, so a genuinely
  NEW `terminalReset: true` from the reconnect is never silently suppressed
  by an earlier dismissal on the same mounted `EmbeddedTerminal` instance.
  An unrelated `taskState` change (not a done→non-done edge) leaves an
  active dismissal untouched.
- **AC-10** — After Reopen, the auto-inject handshake never dispatches onto
  a fresh reconnected pty using STALE prompt-readiness bookkeeping from
  before the close — a Resume that follows a reconnect waits for the new
  shell's own first data byte to quiesce (or the no-data grace), it never
  reads an old, pre-close timestamp as "already settled."

## Confidence Calibration

- **Boundaries touched:** one server wire-envelope builder (pure function,
  fully unit-tested) + one client WS-lifecycle hook (React effect timing,
  covered by a real-close-driven component test). No new I/O boundary, no
  new serialized format, no schema change → no `touches_io_boundary`.
- **Empirical probes run:**
  - Re-read every file:line the investigation cited directly against this
    worktree's checkout (not trusted from the investigation's own report) —
    line numbers had drifted slightly (later base commit) but the mechanism
    was confirmed exactly as described.
  - TDD proof, not just green-after-the-fact: `git stash` the three
    implementation files, re-ran the new
    `EmbeddedTerminal.reopen-reconnect.test.tsx` — the reconnect assertion
    failed (`expected [Array(1)] to have length 2`) exactly as predicted,
    while the no-loop and control cases still passed (they don't depend on
    the fix). `git stash pop` restored the fix; full suite re-verified green.
  - First implementation attempt (adding `sessionEnded` directly to the main
    effect's dependency array) was caught by the PRE-EXISTING
    `EmbeddedTerminal.reopen-rearm.test.tsx` regressing — it reconnected an
    already-live, healthy socket on every done-boundary tick. Redesigned as a
    separate, narrowly-gated effect (AC-5) before proceeding; this is exactly
    the kind of regression a mock WS that never closes could have hidden
    going the other way, which is why the reopen-rearm suite staying green
    throughout was treated as a real signal, not assumed.
- **Test Completeness Ledger:** in `iterate_latest.test_completeness`.
- **Confidence-pattern check:**
  - *Asymptote:* the reconnect fix is proven through the REAL component +
    hook wiring with a WS double whose `close()` fires a genuine `close`
    event — not a fake that never closes (explicit requirement from Sven,
    given the prior fix's test could not have caught this). A real-browser
    E2E spec additionally exercises the full server round-trip.
  - *Coverage:* both bugs have dedicated unit tests (envelope shape, with/
    without the option, alt-screen exclusion); the reconnect fix has three
    tests (fixes the bug, proves no reconnect-loop, proves no regression on
    an unrelated re-render) plus the untouched pre-existing re-arm suite.
  - *Honest gap:* real OS-level clipboard/OS-selection behavior and real
    mouse-wheel-vs-xterm-mode interaction are `untestable` in jsdom; covered
    by the real-browser E2E layer instead (Playwright/Chromium against the
    isolated stack).
  - **E2E authoring finding (Windows-only environment limitation, not a
    defect in this fix):** the first E2E draft drove a real live pty (a
    plain PowerShell/cmd shell echoing a file containing a raw
    `ESC[?1000h`) to reproduce the "session recorded with mouse-tracking
    on" precondition, mirroring `v0-9-6-disk-snapshot-replay.spec.ts`'s
    live-shell pattern. It consistently reproduced `mouseTrackingMode:
    'none'` where `'vt200'` was expected. A standalone `@lydell/node-pty`
    repro (bypassing the browser/webui stack entirely) isolated the cause:
    Windows ConPTY does not pass a child process's output through
    verbatim — it re-serializes it through its own internal screen-state
    model, and re-emitted an unrelated cursor-position escape
    (`ESC[10;1H`) in place of the DECSET our fixture wrote, because
    old-style mouse-tracking modes (1000/1002/1003) aren't part of what
    ConPTY tracks for redraw purposes. This is a platform limitation of
    the Windows dev/CI pty layer, not a claim about the fix or about real
    Claude TUI sessions on macOS/Linux (where the original bug was
    reported and where ConPTY is not in the loop). **Resolution:** Bug A's
    E2E precondition is instead seeded by writing a `<taskId>.snapshot`
    fixture file directly, in the exact on-disk format `snapshot-store.ts`
    documents (version read from the checkout's own pinned
    `@xterm/headless` package.json, never hardcoded). This is not a
    weaker proof — `ws-upgrade-handler.ts`'s replay-only branch still
    reads this exact file through the real `SnapshotStore`, still builds
    the envelope through the real `buildReplaySnapshotEnvelope`, and
    still sends it over a real WS to a real xterm.js instance in the
    browser; a live pty was never part of Bug A's own mechanism (a pure
    envelope-construction bug), only of the fixture setup this finding
    replaced.

## Internal Plan Review

`shipwright-plan:opus-plan-reviewer` reviewed the mini-plan against the final
diff/spec for an overall architecture verdict (not line-by-line), specifically
asked to assess whether the per-task/per-pty latch pattern and its 14-round
fix history reflects a sound approach or should have been architected
differently.

**Verdict: Approve**, one advisory (non-blocking) recommendation for a
follow-up iterate.

- Bug A (server-side envelope teardown) judged sound and low-risk: pure
  function, opt-in flag, no new wire format, correctly excludes `?1049`,
  correctly widened in finding 4 to the `!ptyExistedBeforeAttach` live-branch
  sub-case.
- Bug B (client reconnect) judged sound: the `forceReconnectRef` + narrowly-
  gated edge effect + `socketRef.current !== ws` identity guard reuses an
  existing idiom (`isCurrent(ws)` in `wsReconnectSchedule.ts`); the rejected
  `key`-remount alternative was correctly rejected (would destroy xterm
  scrollback/DOM listeners and reintroduce the one-shot-guard bug this fix
  depends on staying stable).
- **Architectural signal**: findings 5, 6a, 7 (and their re-verification
  churn in 8/9/10/11/12) are the same bug shape occurring independently in
  three files — a per-task/per-pty `useRef` latch
  (`ptyReusedGuardEvaluatedRef`, `launchInjectedThisPtyLifetimeRef` in
  `useAutoLaunch.ts`; `resetBannerDismissed` in `useTerminalBannerState.ts`;
  `dataSeenInitiallyRef`/`lastPtyDataAtRef` in `useReplayDrainGate`) reset
  only on `taskId` change, missing the Reopen/`terminalReset`/
  `launch_failed→active` edge that Bug B's own fix made newly reachable. A
  single shared primitive — e.g. an `attachEpoch`/`ptyGeneration` counter
  owned by `useTerminalSocket`, bumped once per genuine fresh-pty attach and
  compared by each consumer — would have collapsed findings 5, 6a, 7, 9, 11,
  12 into one shared, once-reviewed mechanism instead of four independent
  re-implementations of the same edge detection.
- Explicitly **not** requested as a retrofit onto this already-shipped,
  falsification-tested diff (scope creep on a bug-fix iterate, would reopen a
  mechanism that just passed 7 doubt-reviewer passes). Recommended as a
  scoped follow-up iterate: "extract the recurring per-task/per-pty
  latch-reset pattern into a shared `ptyEpoch` primitive in
  `useTerminalSocket`, migrate `useAutoLaunch`'s two guards +
  `useTerminalBannerState`'s dismissal + `useReplayDrainGate`'s two
  prompt-readiness refs onto it."
- Confirmed the Fourteenth item's (`jsonl_missing`) deferral is genuinely
  unresolved rather than silently dropped, and correctly left out of scope.
- No security or performance concerns; no new I/O boundary or auth surface.
- Noted `useAutoLaunch.ts` landed at exactly the 300-line bloat ceiling,
  leaving zero headroom for the follow-up refactor above without another
  extraction pass.

This follow-up refactor is **not filed as a new iterate in this run** — it is
recorded here as the reviewer's advisory recommendation for a future,
separately-scoped iterate; nothing above blocks this diff.

# Iterate Spec: fix-terminal-flicker-on-closed-task

- **Run ID:** iterate-2026-05-21-fix-terminal-flicker-on-closed-task
- **Type:** bug
- **Complexity:** medium
- **Status:** draft

## Goal

Stop the embedded terminal from flickering every ~200 ms when the user opens a task in a terminal state (`state === "done"` or `"launch_failed"`). The flicker is the visible side-effect of an infinite WS reconnect loop on a replay-only attach.

## Acceptance Criteria

- [ ] AC-1: On a replay-only attach (server sends `ready` with `replayOnly: true` then `replay_snapshot` then `close(1000)`), the client opens **exactly one** WebSocket per `taskId` change (no reconnect spam).
- [ ] AC-2: On a live attach (`replayOnly: false`), an abnormal close (code !== 1000, e.g. 1006) still triggers `scheduleReconnect()` — recovery from real network blips / server restarts is preserved.
- [ ] AC-3: Cleanup path (`taskId` change or unmount, where the client itself calls `ws.close(1000, "unmount")`) does not regress — no late reconnect after unmount.
- [ ] AC-4: The `replay_snapshot` `term.reset()` + `term.write(data)` cycle runs **once per visit** to a closed task, not per reconnect.
- [ ] AC-5: A unit-level regression test fails BEFORE the fix and passes AFTER. (RED-→GREEN evidence committed to the iterate.)

## Spec Impact

- **Classification:** none (bug fix restores intended behavior of an existing requirement: "embedded terminal renders persisted scrollback for closed tasks without churn").
- **ADD:** none
- **MODIFY:** none
- **REMOVE:** none
- **NONE justification:** The WebSocket reconnect contract is an internal implementation detail of `useTerminalSocket`. No FR describes the reconnect cadence; the FR-level requirement (terminal renders historical scrollback for closed tasks) was already satisfied — it was just being satisfied over and over. F11 spec-impact verifier is satisfied because the iterate touches no `spec.md` file AND records `spec_impact=none` with this justification at F7.

## Out of Scope

- Server-side change (e.g. holding the replay-only WS open instead of closing). Client fix is sufficient + smaller blast radius.
- Reworking `attemptsRef.current = 0`-on-open reset (the pre-existing reason the loop was infinite rather than capped at 5). The fix sidesteps it; tightening it further is a separate concern.
- Changing the `term.reset()` + write sequence on legitimate single-shot replay.
- Any change to the snapshot envelope, server replay path, or scrollback store.

## Design Notes

n/a — no UI markup change, no design fidelity work. The visual outcome is the *absence* of a flicker on a screen the user has already navigated to.

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| n/a | n/a | n/a |

No serialized format touched. The fix is purely an internal control-flow gate in `useTerminalSocket`'s WS `close` listener. No `touches_io_boundary` flag fires.

## Confidence Calibration

Mandatory at medium+. Real probes only — no "are you confident?" self-questioning.

- **Boundaries touched:** none (see Affected Boundaries above).
- **Empirical probes run:**
  1. Read `server/src/terminal/routes.ts` replay-only branch (lines 545–600): confirmed server calls `ws.close(1000)` after one `ready` + one `replay_snapshot` envelope. → Producer contract verified.
  2. Read `useTerminalSocket.ts` close listener pre-fix: confirmed unconditional `scheduleReconnect()`. → Bug surface verified.
  3. Read `attemptsRef.current = 0` in the `open` listener (line 257): confirmed the 5-attempt cap never bites because each reconnect opens successfully. → Loop is infinite, not 5-bounded.
  4. Searched `decision_log.md` for prior mentions: hit at line 2040 — *"Anomalous ~290 refresh/sec rate is pre-existing replay-only WS-reconnect-loop behaviour"*. → Independent confirmation the loop is real and observed.
  5. Wrote a RED unit test (`does NOT reconnect after a clean close on a replay-only attach`) against the FakeWebSocket fixture; ran it pre-fix and confirmed it fails (multiple `FakeWebSocket.instances` after `close(1000)`); then post-fix confirmed it passes. → RED→GREEN evidence.
  6. Wrote a symmetric test (`DOES reconnect after an abnormal close on a live attach`) and confirmed it passes — the fix does NOT over-suppress reconnects on real failures.
  7. Re-ran the full EmbeddedTerminal + terminal-clipboard + terminal-theme suites (102 tests) post-fix: all green. → No collateral regression in the surrounding terminal components.
  8. Inspected the cleanup path: `cancelled = true` is set BEFORE `ws.close(1000, "unmount")` in the effect cleanup, and the close handler's `if (cancelled) return;` short-circuit fires first — the unmount close never reaches the new gate. → AC-3 preserved by construction.

- **Edge cases NOT probed + why acceptable:**
  - Server-side abnormal close mid-snapshot (server crash between `send(ready)` and `close(1000)`): the close event has `code !== 1000`, the new gate's `code === 1000` clause is false, reconnect fires normally. No degradation vs. pre-fix.
  - Server closes a *live* (non-replay-only) session with `code === 1000` (e.g. graceful shutdown): pre-fix would reconnect immediately; post-fix the gate is gated on `replayOnlyRef.current === true`, which is `false` for a live attach, so reconnect still fires. No degradation.
  - Stale-server skew where the new `replayOnly` field is absent on the ready envelope: `replayOnlyRef` falls back to `false`, so the gate never fires — graceful degradation to pre-fix behavior (reconnect on every close). Acceptable bridge band.

- **Confidence-pattern check:** no "are you confident?"-pattern fired in this run. External review (gemini + openai cold-read via OpenRouter) DID surface one MEDIUM finding I missed: the original unit test asserted on WS instance count only and would have passed a hypothetical broken implementation that suppressed reconnects but still triggered double-replay (AC-4 not covered). One additional probe (extending the test to deliver `replay_snapshot` + spy on the snapshot callback for exactly-one assertion) was therefore added before F0, plus a defense-in-depth ref reset at the top of `connect()` (openai medium #1) and a "don't broaden the gate" comment (openai medium #5). All three changes re-tested and committed to the same iterate diff.

## External Review Findings (medium-iterate auto-review)

Ran `external_review.py --mode iterate` + `--mode code` over the mini-plan + diff via OpenRouter (gemini + openai cold-read). Triaged below. Branch A: act on actionable findings; Branch C: explicit dismissal for the unactionable ones.

| # | Finding | Severity | Source | Action |
|---|---|---|---|---|
| 1 | Reset `replayOnlyRef` at top of `connect()`, not only on cleanup | medium | openai-iterate | **Applied** (defense-in-depth — close handler already nulls the ref, but explicit reset on every new socket is belt-and-braces against future paths that bypass close). |
| 2 | Comment should clarify gate is narrow, NOT "any clean 1000 close" | medium | openai-iterate | **Applied** — comment expanded to spell out "do not broaden." |
| 3 | Unit test does not assert AC-4 (exactly-one snapshot per visit) | medium | openai-code | **Applied** — replay-only test now delivers a `replay_snapshot` envelope and spies on `onReplaySnapshot`. Asserts both `FakeWebSocket.instances.length === 1` AND `snapshots.length === 1`. |
| 4 | Spec wording "the new `replayOnly` field" suggests addition; field already exists | medium | gemini-iterate | **Applied** (doc-only) — spec wording adjusted; the field has shipped since v0.8.2 (see useTerminalSocket.ts:280 pre-diff). |
| 5 | E2E "exactly 1 WS" will be flaky under React.StrictMode double-mount | medium | gemini-iterate | **Applied** — E2E asserts `<= 2` (StrictMode-tolerant) AND that the winning capture has `snapshot count === 1`. Filters by `envelopes.length > 0` to exclude the StrictMode-aborted transient WS. |
| 6 | Premature clean close before snapshot leaves blank terminal | low | gemini-iterate | **Dismissed** — this is the intended ADR-087 behavior ("when no snapshot exists, blank terminal with live shell"). Adding a `receivedSnapshotRef` retry would re-introduce the flicker for snapshot-less closed tasks. Documented in iterate-spec edge-case table. |
| 7 | Mixed-version deploy: stale server without `replayOnly` flag still flickers | medium | openai-iterate | **Dismissed** — webui server + client deploy together (same Hono process serves the static client bundle). No mixed-version risk in this product's deploy model. Recorded as a known degraded mode for completeness. |
| 8 | State transition done→running while terminal is open | low | gemini-iterate | **Dismissed** — out of scope per spec; users can refresh after the rare out-of-band transition. |
| 9 | Other findings (server mark-state semantics, defensive parsing, multi-socket-transient) | low | openai-iterate items 3/6/7/8 | **Dismissed** — already satisfied: flag-driven (not state-driven) by construction; envelope parsing is already defensive (`typeof === "boolean" ? ... : false`); StrictMode handled via `cancelled` flag and the new `pickAuthoritativeWs` filter. |

## Verification (medium+)

- **Surface:** web (E2E Playwright spec against the running stack)
- **Runner command:** `cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts --grep "AC-6 \\(iterate-2026-05-21-fix-terminal-flicker-on-closed-task\\)"`
- **Evidence path:** `playwright-report/index.html` + per-test screenshot in `test-results/`
- **Justification (only if surface=none):** n/a — web stack runs and the bug is observable through the real `EmbeddedTerminal` + `useTerminalSocket` chain when the user opens a closed task. The regression test was added to the existing `v0-9-5-replay-snapshot-envelope.spec.ts` as `AC-6` so it reuses the snapshot-file pre-seeding fixture and the `attachWsCapture` / `pickAuthoritativeWs` helpers from ADR-089. Asserts `authoritative.length <= 2` (StrictMode-tolerant per Gemini #2) AND `snapshotCount === 1` per winning capture.

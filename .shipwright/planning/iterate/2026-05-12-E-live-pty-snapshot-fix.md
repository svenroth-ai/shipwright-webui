---
iterate_id: E
campaign: headless-terminal-refactor
parent_iterate: D-bis (audit artifact; live-pty empirical extension that confirmed the bug)
created: 2026-05-12
complexity: medium
risk_flags: [touches_io_boundary, touches_shared_infra]
surface: web
runner: playwright
network_profiles: [local, tailscale]
status: in-progress
---

# Sub-Iterate E: Live-pty replay fix (serialize-on-attach + snapshot-on-detach)

## Goal

Fix the LIVE-pty re-attach regression empirically confirmed by Iterate
D-bis (ADR-091, outcome B): a live pty loses terminal state on every
SPA navigate-away/navigate-back cycle because snapshots are only
written on `pty.kill` / `pty.onExit`. Re-attach calls `tryReadSnapshot`
from disk, finds nothing, and the client renders a blank terminal even
though the shell is still alive.

This iterate adds TWO complementary write surfaces — primary
(serialize-on-attach) and resilience backup (snapshot-on-detach) — so
re-attach restores state both for the same server lifetime AND across
server restarts.

## Background

ADR-091 (D-bis) recorded probe outcome B with these artifacts:

- `client/playwright-report/v0.9.6-live-pty-probe/probe-result.json`:
  `marker_seen_pre_navigate: true`, `marker_seen_post_navigate_back:
  false`, `replay_snapshot_envelope_emitted_on_reattach: false`,
  `cursor_before: {cursorX:19, cursorY:5}` → `cursor_after:
  {cursorX:0, cursorY:0}`.
- Code reading in `server/src/terminal/pty-manager.ts:780-825` +
  `server/src/terminal/routes.ts:683` confirmed: `snapshotStore.write()`
  is called only via `finalizeMirrorSnapshot` from `cleanup`, and
  `cleanup` only runs from `pty.onExit` / `kill`.

ADR-091's "Proposed fix path" section explicitly enumerated three
options; Iterate E implements options 1 + 3 as a pair (server-side
write on demand + persistence backup), explicitly rejecting option 2
(snapshot-on-interval) as wakeup-noisy without empirical justification.

## Affected Boundaries (ADR-024)

Per `references/round-trip-tests.md`:

- **Headless-mirror serialize path (in-memory boundary):**
  Producer = `HeadlessMirror.serializeStable()` (existing). Consumer
  was previously only `finalizeMirrorSnapshot` (cleanup-only). This
  iterate adds two new consumers in the same module:
  `PtyManager.serializeMirrorIfLive()` (read-only — produces a
  `{cols, rows, data}` shape that callers wrap in a SnapshotRecord) and
  `PtyManager.flushMirrorSnapshot()` (writes to disk via the existing
  `SnapshotStore.write()`).

- **WS replay envelope (server → client):** producer is
  `replay-snapshot.ts buildReplaySnapshotEnvelope`; consumer is
  `useTerminalSocket.onReplaySnapshot`. No envelope shape change —
  the new `serializeMirrorIfLive` path emits the SAME
  `replay_snapshot` envelope already pinned by ADR-089. The fix is
  about WHEN we emit it, not WHAT we emit.

- **Snapshot disk format (server-only round-trip):** unchanged.
  `SnapshotStore.write()` is called from a new trigger (last-WS-detach)
  but with the same `{cols, rows, data}` payload shape. The on-disk
  envelope (`# shipwright-snapshot v1 xterm@<v> <c>x<r>\n<data>`) is
  identical.

Round-trip probe: AC #1 (regression-guard test, promoted from D-bis
probe) IS the producer→file→consumer probe. The new serialize-on-attach
path bypasses disk; AC #6 (multi-tab) + AC #7 (server-restart) cover
the disk path.

## Acceptance Criteria

### AC #0 — RED → GREEN (TDD)

Run the cherry-picked D-bis probe spec BEFORE implementing either fix
path; it MUST fail (outcome B reproduction on the E branch which is
currently == main + probe file). Then implement Path 1; the probe MUST
flip to outcome A (marker visible AND `replay_snapshot` emitted).

Evidence captured to
`client/playwright-report/v0.9.6-live-pty-replay/probe-result.json`
(renamed from D-bis's underscore-prefixed probe dir).

### AC #1 — Probe regression guard (PASS on E, FAIL on main)

`client/e2e/flows/v0-9-6-live-pty-replay.spec.ts` (renamed from
`_v0-9-6-live-pty-probe.spec.ts`) MUST PASS on this iterate's branch.
The substantive assertions are unchanged from D-bis; only the test
description is reworded from "probe" to "regression-guard". The fact
that this test PASSES on E and FAILED on main is the proof of fix.

Outcome A required:
- `marker_seen_pre_navigate: true`
- `marker_seen_post_navigate_back: true`
- `replay_snapshot_envelope_emitted_on_reattach: true`

### AC #2 — `serializeMirrorIfLive` produces in-memory SnapshotRecord

`PtyManager.serializeMirrorIfLive(taskId)` returns a SnapshotRecord
shape (`{version: "v1", terminalVersion: <pinned>, cols, rows, data}`)
when a live mirror exists. Returns `null` when:
- no entry for taskId, OR
- entry exists but `mirror === null` (flag-disabled OR initialization
  refused), OR
- `serializeStable()` throws.

`expectedTerminalVersion` is plumbed through `PtyManagerOpts` so the
returned record's `terminalVersion` field stays coupled to the pinned
`@xterm/headless` runtime version. When unset (test config), the
record's `terminalVersion` is `"unknown"` matching the SnapshotStore's
last-resort sentinel.

Unit tests:
- A2.1: returns valid SnapshotRecord when mirror exists.
- A2.2: returns null when no entry.
- A2.3: returns null when entry has `mirror: null`.
- A2.4: returns null when `serializeStable()` throws; logs warn.
- A2.5: returned record's `cols/rows` match the mirror's current
  dimensions.

### AC #3 — `flushMirrorSnapshot` writes without disposing

`PtyManager.flushMirrorSnapshot(taskId)` writes the live mirror's
serialized state to disk via `SnapshotStore.write()`, but does NOT
dispose the mirror. The pty stays alive; subsequent `pty.onData`
chunks continue mirroring. Best-effort: never throws on disk error;
logs warn.

Unit tests:
- A3.1: writes to disk without disposing mirror (subsequent
  `serializeMirrorIfLive` still returns a valid record).
- A3.2: no-op when no entry / no mirror / no snapshotStore.
- A3.3: survives `SnapshotStore.write` failure without throwing.
- A3.4: after flush, the mirror is still alive (e.g. emit one more
  byte → next `serializeMirrorIfLive` includes it).

### AC #4 — Routes wires resolveReplaySnapshot (live-first, disk-fallback)

**Revised after external plan review HIGH (Gemini #1 + OpenAI #2):**
the original "disk-first" precedence was rejected as staleness-prone.
A stale disk snapshot is possible whenever the last WS detached and
wrote-on-detach, but the shell kept producing output afterwards.
Re-attach must serve the FRESHER source: the live mirror.

In the WS attach replay flow (`routes.ts` ~ line 683):

```
const live = await ptyManager.serializeMirrorIfLive(taskId);
if (live) sendReplaySnapshot(ws, live);
else {
  const disk = await tryReadSnapshot(taskId);   // server-restart only
  if (disk) sendReplaySnapshot(ws, disk);
}
```

Integration tests (server-side, FakePty):
- A4.1: WS attach, fresh task, no disk snapshot → mirror live →
  `replay_snapshot` envelope emitted with the live mirror's content.
- A4.2: WS attach, disk snapshot present AND live mirror exists →
  **live mirror wins** (disk would be stale; closes the external
  plan review HIGH).
- A4.2b: WS attach, disk snapshot present AND no live mirror
  (post-kill / post-restart) → disk fallback fires.
- A4.3: WS attach, no disk + no mirror → no replay envelope (existing
  behaviour preserved when flag is off / mirror unavailable).

### AC #5 — Routes wires snapshot-on-detach (last subscriber only)

WS close handler in routes.ts calls a single `detachAndCount(taskId,
conn)` that detaches + returns the post-detach attach count
atomically. When `remainingAttachCount === 0`, fire
`flushMirrorSnapshot(taskId)` (fire-and-forget — internally
try-catched, no rejection escapes). Multi-tab: only the LAST tab's
detach triggers the flush.

**Atomicity fix per external plan review HIGH (OpenAI #1):** the
original "check count → detach → check count" split-step design was
race-vulnerable (a concurrent attach could land between the two
reads). `detachAndCount` collapses the two observations into one
synchronous-detach + same-tick count read.

Server-side helpers required:
- `PtyManager.attachCount(taskId)` — non-mutating read of
  `entry.connSubs.size`.
- `PtyManager.detachAndCount(taskId, conn)` — atomic detach +
  post-count return.

Concurrency note: `SnapshotStore.write()` already serializes
per-task via PQueue (Iterate B MEDIUM-1 fix from ADR-089), so
overlapping flush calls cannot corrupt the file (closes external
plan review MEDIUM — Gemini #2 + OpenAI #9 — without new code).

Integration tests:
- A5.1: single tab → close → `flushMirrorSnapshot` called once.
- A5.2: two tabs → close one → no flush; close the second → flush.
- A5.3: pty.kill (not detach) does NOT double-flush (cleanup's
  `finalizeMirrorSnapshot` is still the kill-path persistence — but
  the iterate's flush path is detach-only, so the two never compete).

### AC #6 — Multi-tab race & idempotence

Empirical probe (Confidence Calibration § 3.8): open the same task in
two tabs. Type in tab A. Close tab A. Verify state preserved in tab B
via xterm-rows assertion. Closing tab B then re-opening from the
TaskBoard MUST show the same state from disk.

### AC #7 — Server-restart resilience

Empirical probe (Confidence Calibration § 3.8): create+launch task →
type MARKER → close ALL tabs (triggers flush-on-detach to disk) →
SIGTERM the Hono process → restart → navigate to the task → verify
MARKER visible (from disk snapshot since the pty is now gone).

### AC #8 — 4×4 live-pty matrix (real browser, both network profiles)

`client/e2e/flows/v0-9-6-live-pty-matrix.spec.ts` — 4 task types
(`new-plain`, `new-task` build, `new-iterate`, `new-pipeline`) × 4
axes (Lifecycle, Rendering, Cursor, Single-pty). Run on local; also
run on tailscale when `tailscale ip -4` resolves cleanly (soft-skip
when missing — matching D-bis policy).

Note: `new-iterate` and `new-pipeline` need shipwright slash-commands
to actually do work, but the matrix only needs the pty alive + the
launcher command typed. Verifying terminal-state preservation is shell
output, not Claude output.

### AC #9 — No regressions

- Server: full `npm.cmd run test` + `npm.cmd run build` green
  (currently 1666 tests).
- Client: full `npm.cmd run test` + `npm.cmd run build` green.
- Architecture: ADR-091's "no fix attempted" annotation gets a
  follow-up paragraph noting closure by ADR-092. ADR-087/088/089
  invariants intact.

## Verification

- F0 unit + typecheck (server + client) — full suites green
- F0.5 web surface — AC #1 regression guard PASS + AC #8 matrix on
  local + (best-effort) tailscale
- F3 decision log — ADR-092 "Live-pty replay fix: serialize-on-attach
  + snapshot-on-detach"
- F4 changelog — Fixed bullet under [Unreleased]
- F6 commit message — Conventional Commits: `fix(server): live-pty
  replay via serialize-on-attach + snapshot-on-detach (ADR-092)`

## Out of Scope

- Snapshot-on-interval (option 2 from ADR-091). Two write surfaces is
  enough; interval adds wakeup noise without empirical justification.
- xterm.js upgrade paths.
- ADR-089 version-gate refinement.
- Diagnostic endpoint for `pty.pid` exposure (the AC #8 single-pty
  axis can use scrollback-bytes monotonicity instead).
- Tailscale-specific bug investigation — the matrix only runs on
  tailscale, it does not chase regressions specific to it.

## Notes

- Real browser is non-negotiable; the bug is a real-browser bug,
  verifying the fix without a real browser is not acceptable
  (feedback_browser_fixes_need_real_browser_smoke).
- Conventional Commits, TypeScript strict, files under 300 lines
  (`pty-manager.ts` is already 992 lines from prior iterates — adding
  ~60 lines crosses no NEW threshold; `routes.ts` is at 795 — adding
  the detach-count check is ~15 lines, also acceptable).
- Use `npm.cmd` on Windows (subprocess gotcha —
  feedback_windows_subprocess_npm_cmd).
- No new envelope types in the WS protocol — reuse `replay_snapshot`.

---
iterate: H-snapshot-preservation-taskcard-gating
campaign: headless-terminal-refactor
type: fix
complexity: small
risk_flags: []
date: 2026-05-13
adr: ADR-096
---

# Iterate H — Snapshot preservation on pty death + TaskCard Resume gating

## Context

Two UAT-reported regressions after v0.10.1 (post-Iterate G merge).

### Issue 1 — Empty snapshot after overnight Claude task

User ran a Claude task overnight; returned next morning to TaskDetail and the
embedded terminal was empty. Task state = `idle`, `liveSession = false`.

Forensic data: the on-disk snapshot file for task
`5124b107-2649-4edb-b0a5-b45873ebae82` was 158 bytes total, containing only
the pre-Claude PowerShell prompt header + the cell-state of a freshly-opened
prompt (`# shipwright-snapshot v1 xterm@5.5.0 113x47\nPowerShell 7.6.1\nPS
C:\...>` + a couple of cursor-position escape sequences). The user's
multi-hour Claude conversation was gone.

Root-cause chain:

1. `pty.kill()` (or `pty.onExit` from idle-ceiling timeout, or `Ctrl+C` →
   shell exit) sends SIGTERM to Claude Code.
2. Claude TUI shuts down. With `CLAUDE_CODE_NO_FLICKER=1` (Iterate G default,
   ADR-095) Claude renders into the alt-screen buffer; on exit it emits
   `DECRST 1049` (leave alt-screen) — the main buffer state at that moment
   is whatever the shell wrote before Claude started, plus an empty
   PowerShell prompt.
3. Bytes flow through `pty.onData` → `entry.mirror.write(data)` → the
   `@xterm/headless` parser processes them. The mirror's visible buffer
   ends up as just the bare shell prompt — no Claude content present.
4. `pty.onExit` fires → `cleanup(taskId)` → `finalizeMirrorSnapshot(taskId,
   mirror)` runs.
5. `finalizeMirrorSnapshot` awaits `mirror.serializeStable()` (so it waits
   for the parser to finish the exit-sequence) → serializes the
   now-near-empty cell-state → calls `snapshotStore.write(...)`.
6. **`snapshotStore.write` is a `temp-file + rename` ATOMIC OVERWRITE.** Any
   previously-good snapshot — typically the one
   `flushMirrorSnapshot` wrote during the last `last-detach` of the WS
   subscriber (Iterate E ADR-092 path) — is replaced by the 158-byte stub.

The bug was latent in Iterate E's design from day one: any Claude task that
clears its terminal on exit would hit it. Iterate G's NO_FLICKER default
makes the alt-screen leave guarantee an empty main buffer at exit-time, so
it now fires on EVERY Claude task that's killed or whose pty idles out.

The proper root cause is xterm 5.5.0's lack of DECSET 2026 + the alt-screen
behavior xterm follows. That requires xterm 6.0 (deferred — breaking change,
parallel session). The pragmatic mitigation is to make
`finalizeMirrorSnapshot` refuse to overwrite a substantially-larger existing
snapshot.

### Issue 2 — TaskCard Resume button missed in Iterate G's gating

Iterate G gated the Resume CTA on the **TaskDetail header**; the equivalent
solid-color Resume button on the **TaskCard** in the TaskBoard kanban
(rendered by `<TerminalLaunchButton variant="solid" resume>`) was missed.
The user sees a Resume button on the card while the Claude session is live;
clicking it pastes `claude --resume <uuid>` into a shell that is already
running Claude — same incorrect behavior the header fix closed.

The TaskCard CTA renders unconditionally for `state === "idle"` (with
backlog/draft/done branches mapping to Launch/none respectively). It needs
the same `liveSession` gating: hide when pty is alive.

## Goal

1. In `finalizeMirrorSnapshot`, compare the new snapshot's payload size
   against any existing on-disk snapshot. If the new one is meaningfully
   smaller (<60 % of the existing payload byte-length), preserve the
   existing snapshot and skip the write. Log a `[pty-manager] preserving
   last-detach snapshot ...` warn line so observability picks it up.
2. Hide the TaskCard Resume button when `state === "idle" && liveSession
   === true`, matching the TaskDetailHeader gating from ADR-095.

## Scope

### Modify

#### Server

- `server/src/terminal/pty-manager.ts`
  - Extend `finalizeMirrorSnapshot(taskId, mirror)` with a pre-write
    size-comparison gate. Read the existing snapshot via
    `snapshotStore.read(taskId)`. Compute new-payload length
    (`stable.length`, byte length of cell-state payload AFTER the header)
    vs existing-payload length (`existing.data.length`). Skip the write
    when `existingDataLen > 0 && newDataLen < existingDataLen * 0.6`.
  - Edge cases:
    - No existing snapshot (`read` returns `null`) → write the new one
      (first writer wins).
    - `read` throws (malformed header, IO error) → log warn + write the
      new one (best-effort fallback; do not lose data on read failure).
    - New payload is empty (`stable.length === 0`) AND existing has
      content → preserve existing (subsumed by the 60 % rule but
      documented explicitly).
    - Mirror dispose still happens in the `finally` block whether or not
      the write was skipped — the pty is gone, the in-memory Terminal
      must be released regardless.
    - `releaseQueue` still fires in the `finally` block — same as today.

#### Client

- `client/src/components/external/TaskCard.tsx`
  - Add a `liveSession`-aware predicate around the `idle` Resume branch:
    `task.state === "idle" && task.liveSession !== true`. The block
    behavior on every other state (draft → green Launch; done → nothing;
    active/awaiting_external_start → nothing on TaskCard) is unchanged.
  - Logic lives directly in TaskCard (not pushed down into
    TerminalLaunchButton): keeps the gating-rule discoverable at the
    decision point + symmetric with how TaskDetailHeader does it (the
    button component stays a dumb renderer).

### Tests

- `server/src/terminal/pty-manager-live-snapshot.test.ts` — extend with
  a `describe("PtyManager — finalizeMirrorSnapshot (ADR-096) — snapshot
  preservation heuristic")` block. New cases (≥5):
  1. Existing snapshot 1000-byte payload + new 50-byte → existing
     preserved (write skipped).
  2. Existing 100-byte payload + new 80-byte → new snapshot wins (within
     60 % threshold, both substantial).
  3. No existing snapshot + new 50-byte → new snapshot is written (first
     writer; comparison never fires).
  4. Existing snapshot exists + new is 0-byte payload → existing
     preserved.
  5. Existing snapshot exists but `snapshotStore.read` throws → new
     snapshot is written (best-effort; don't lose data on read failure).
  - All cases use the existing FakePty + temp-dir SnapshotStore harness.

- `client/src/components/external/TaskCard.test.tsx` — extend with a
  `describe("TaskCard — Resume CTA liveSession gating (ADR-096)")` block:
  - `state: "idle" + liveSession: true` → `task-card-resume-*` testid NOT
    in the DOM.
  - `state: "idle" + liveSession: false` → `task-card-resume-*` testid IS
    in the DOM.
  - `state: "idle" + liveSession: undefined` (back-compat / pre-Iterate-G
    server response) → `task-card-resume-*` testid IS in the DOM
    (conservative — surface Resume when in doubt).
  - `state: "done" + liveSession: true` → no Resume rendered (outer
    `!isDone` gate; sanity check; state takes precedence).

### Out of scope

- xterm.js 6.0 upgrade (separate parallel session — Pfad B).
- Reverting Iterate G's `CLAUDE_CODE_NO_FLICKER=1` default (keep it; the
  heuristic handles the snapshot side independently).
- Any wider snapshot-store schema/version bump — the heuristic operates
  entirely above the SnapshotRecord layer and does not change file format.
- ADR-068-A1 scrollback-store behavior — unchanged.

## Affected Boundaries

None new. The snapshot file is a single-writer producer (pty-manager) →
single-reader consumer (WS replay path); the heuristic is a same-writer
self-check, no round-trip change. The TaskCard fix is render-time only —
no serialized format involved.

## Acceptance Criteria

- [ ] `finalizeMirrorSnapshot` skips its `snapshotStore.write` call when
      `existingDataLen > 0 && newDataLen < existingDataLen * 0.6`.
- [ ] When the write is skipped, a `console.warn` line is emitted noting
      the taskId + new/existing byte lengths so the decision is
      observable from the server logs.
- [ ] No-existing-snapshot path writes the new snapshot unconditionally.
- [ ] `snapshotStore.read` throwing is logged + treated as no-existing
      (write proceeds — never lose data on read failure).
- [ ] Empty new payload + existing-present → preserved.
- [ ] Mirror.dispose + releaseQueue still run in the `finally` block on
      every branch (skip or write).
- [ ] At least 5 server-side unit tests cover the heuristic + edge cases.
- [ ] `<TaskCard>` Resume button is NOT rendered when
      `task.state === "idle" && task.liveSession === true`.
- [ ] `<TaskCard>` Resume button IS rendered when `task.state === "idle"
      && task.liveSession !== true` (false or undefined).
- [ ] At least 3 client-side unit tests cover the TaskCard gating
      matrix.
- [ ] No new TypeScript errors (`server && npm run build`,
      `client && npm run build` exit 0).
- [ ] Existing server + client suites stay green.
- [ ] Iterate E regression-guard E2E spec
      (`client/e2e/flows/v0-9-6-live-pty-replay.spec.ts`) still passes.
- [ ] ADR-096 written: forensic context (158-byte snapshot from task
      `5124b107-...`), root-cause chain, NO_FLICKER amplifier, 60 %
      heuristic + rationale, xterm 6.0 deferral, TaskCard gating as the
      second sub-issue.
- [ ] Manual UAT post-merge: (a) user confirms a freshly-launched
      Claude task that gets killed still shows its content on return;
      (b) Resume button hidden on the TaskCard while Claude session
      is alive.

## Verification

- **server unit:** vitest covers the heuristic in
  `pty-manager-live-snapshot.test.ts`.
- **client unit:** vitest covers the TaskCard gating matrix in
  `TaskCard.test.tsx`.
- **build:** `server && npm run build`, `client && npm run build` both
  green.
- **F0.5 Surface:** `cli` — the snapshot heuristic is unit-testable; the
  TaskCard gating mirrors the Iterate G TaskDetailHeader fix that was
  itself unit-tested without F0.5=web. A Playwright spec would require
  driving a real Claude TUI through a real pty in CI, which exceeds
  the iterate's scope.
- **regression:** re-run `v0-9-6-live-pty-replay.spec.ts` (Iterate E
  regression guard) — heuristic must not interfere with the
  "navigate-back finds live mirror" path. (`serializeMirrorIfLive` does
  not call `finalizeMirrorSnapshot`; the path is orthogonal.)
- **manual UAT:** user launches Claude, types content, kills the shell,
  reopens TaskDetail — confirms terminal shows the pre-exit content
  (not the empty post-exit stub). Separately: open TaskBoard with a
  live Claude task — confirms Resume button is hidden on the card.

## Rejected Alternatives

1. **Persist a "good" snapshot via separate write-on-buffer-quiesce path**
   — would require a periodic snapshot timer + dirty-tracking on the
   mirror. Significantly more complex; the same outcome is achievable
   by combining (a) flushMirrorSnapshot on last-detach (existing,
   Iterate E) + (b) refusing to overwrite-shrink on finalize (this
   iterate). Rejected.
2. **Hard-gate finalize: always preserve any existing snapshot** —
   would prevent updates in legitimate cases where the live state
   genuinely shrank (e.g. user ran `clear` then exited — new snapshot
   IS the correct state). Rejected: the heuristic distinguishes
   "shrank to <60 %" (suspicious) from "shrank somewhat" (legitimate).
3. **Set the threshold at 50 % / 70 %** — 50 % is too permissive (a
   500-byte shrink from 1000 still hits empty-prompt territory), 70 %
   is too restrictive (a deliberate `clear` could yield a 70 % shrink
   that we should not preserve). 60 % is the documented compromise;
   the threshold is heuristic and observability-logged so it can be
   tuned without a code change if UAT shows misclassification.
4. **Sniff the post-exit ANSI for DECRST 1049 specifically** — would
   give a more semantically-precise gate ("Claude is leaving alt-
   screen, preserve") but couples our snapshot logic to a specific
   Claude-Code output convention. Rejected: the size-comparison
   heuristic is content-agnostic and survives any TUI that clears on
   exit, not just Claude.
5. **Push the TaskCard gating into TerminalLaunchButton** — moves the
   `liveSession`-aware visibility decision into a shared component.
   Rejected: the gating is policy (whose surface shows what), the
   button is mechanism (render a stylable solid CTA). Mixing them
   couples surface-policy to button mechanism. Mirrors the
   TaskDetailHeader pattern (gating at the call site).

## Risk

LOW. Two narrow, well-bounded fixes; no I/O boundary change, no schema
migration, no protocol change. Worst-case failure modes:

- Heuristic misclassifies a legitimate shrink → existing snapshot stays;
  user sees stale content on next reopen. Recoverable via Stop terminal
  session → relaunch (kills the pty, writes a new snapshot fresh from
  an empty mirror).
- TaskCard gating regresses for back-compat clients without the
  `liveSession` field → Resume button shows (default `!== true`),
  matching pre-Iterate-G behavior. Conservative trade-off.

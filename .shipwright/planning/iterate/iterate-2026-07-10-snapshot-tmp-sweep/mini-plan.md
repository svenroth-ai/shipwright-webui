# Mini-plan — iterate-2026-07-10-snapshot-tmp-sweep (D19)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D19 · Complexity: medium
(orchestrator override of a keyword-driven `large` false positive; risk flag
`touches_io_boundary`) · Type: bug (spec_impact: none). Findings: F26 (LOW).

## Problem statement
`SnapshotStore.write()` stages to `<taskId>.snapshot.tmp-<pid>-<ms>-<rand>` then
atomically renames to `<taskId>.snapshot`. If the process exits between
`writeFile(tmp)` and the rename — graceful shutdown fires a fire-and-forget
finalize then `process.exit` WITHOUT awaiting snapshot writes, or the Windows
EBUSY rename budget exhausts — the tmp staging file is stranded with FULL
terminal cell-state (possibly secrets). NO existing cleanup surface matches it:
the DELETE cascade unlinks the exact `.snapshot` path, `sweepExpired` matches
`.log(.N)?`, the iterate-C boot wipe matches `.log*`. Orphan leaks to disk
indefinitely (F26, LOW/privacy).

## Chosen approach
Add a NEW cohesive module `server/src/terminal/snapshot-tmp-sweep.ts` with two
pure-over-injectable-fs-deps functions (mirrors boot-wipe.ts's testable shape):

1. `sweepOrphanSnapshotTmp({ dir, maxAgeMs=1h, deps?, now?, logWarn?, logInfo? })`
   — age-gated sweep. Matches `^[0-9a-fA-F-]{36}\.snapshot\.tmp-` (bounded,
   ReDoS-safe), stats each, unlinks those with `mtimeMs < now-maxAgeMs`, counts
   `{deleted, errors, preserved}`. Best-effort: dir-read + per-file failures
   log a warn, never throw. Wired into index.ts boot sweep + 24h periodic timer
   alongside the scrollback sweep.
2. `clearTaskSnapshotTmp({ dir, taskId, deps?, logWarn? })` — immediate,
   NO age gate; unlinks every `<taskId>.snapshot.tmp-*` sibling for one task.
   Wired into the DELETE cascade via an index.ts `clearSnapshotArtifacts(t)`
   closure = `snapshotStore.clearBestEffort(t)` THEN `clearTaskSnapshotTmp(...)`,
   substituted at BOTH cascade wiring sites (project-delete + task-delete).

### Alternatives considered
- **Add a `sweepOrphanTmp()` method to `SnapshotStore`** (spec's literal "add to
  SnapshotStore"). REJECTED: snapshot-store.ts is AT its 513 bloat baseline; any
  method ratchets a grandfathered entry (HARD anti-ratchet gate).
- **Add the sweep to `boot-wipe.ts`** (spec footprint lists it). REJECTED: the
  additions push boot-wipe.ts past the 300-line source limit → a NEW crossing
  requiring a baseline allowlist entry (brief: "bloat ≤ baselines"). A new
  cohesive file keeps every file under/at its limit — the brief's sanctioned
  "new cohesive file or compress" path.
- **Extend `clearBestEffort` inside snapshot-store.ts** (spec's literal wording).
  REJECTED for the same 513-ceiling reason; the equivalent goal ("DELETE cascade
  removes strays") is achieved by wrapping at the two index.ts cascade sites,
  which covers 100% of `snapshotClearBestEffort` bindings (verified: only
  index.ts:395 + :558 bind it).
- **Active-task veto on the periodic sweep** (mirror `sweepExpired`). REJECTED as
  needless complexity: a live write renames its tmp within milliseconds, so the
  1h age gate already protects in-flight writes; any tmp older than 1h is
  provably orphaned regardless of task liveness (Simplicity-First).

## Invariants preserved
- D01 tombstone/clear fence: `SnapshotStore.clear()` still drains the write
  queue (`onIdle`) before unlink — UNTOUCHED (snapshot-store.ts not modified).
  The cascade runs `ptyKill → scrollbackClear → clearSnapshotArtifacts`, so tmp
  clear happens AFTER pty teardown + queue drain — no live-write race.
- Read-only-observer (CLAUDE.md rules 1/12): touches only the webui-owned
  `terminal-scrollback` dir; never `~/.claude/projects/**` or run_config.
- Live `.snapshot` / `.log` never match the tmp pattern → always preserved.

## Acceptance
- AC1: orphan-tmp scenarios no longer leak (boot + 24h + delete-cascade reclaim).
- AC2: NEW test RED on pre-fix main (module absent → import fails), green after;
  aged orphan reclaimed, fresh tmp + live `.snapshot` + live `.log` preserved.
- AC3: full server suite + build green.
- AC4: footprint = new module + new test + index.ts wiring; no baseline ratchet
  (index.ts 899≤899, snapshot-store.ts 513 untouched, boot-wipe.ts 167 untouched).

## Files
- `server/src/terminal/snapshot-tmp-sweep.ts` (NEW, 170 LOC)
- `server/src/terminal/snapshot-tmp-sweep.test.ts` (NEW, 155 LOC)
- `server/src/index.ts` (wiring: import + `clearSnapshotArtifacts` closure +
  boot sweep call + periodic sweep call + 2 cascade substitutions)

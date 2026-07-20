# Iterate — Mission-context resolver: async git + root-set / event-log caching

- **Run ID:** `iterate-2026-07-20-mission-context-async-git`
- **Intent:** CHANGE (behavior-preserving performance / architecture refactor)
- **Complexity:** medium (history-calibrated)
- **Spec Impact:** NONE — no observable Mission-context output changes; this is
  event-loop and per-poll cost, entirely internal.
- **Covers:** FR-01.66 (Mission-context resolver)
- **Origin:** internal code-review cascade on PR #292 (S1 of campaign
  2026-07-18-mission-artifacts). NOT blocking that PR. The cheap half was
  already taken in commit `fafb1a64` (findWorkCompleted reuses its probe bytes).

## Problem (three remaining review items)

The Mission tab polls `GET /tasks/:id/mission-context` once per second while a
task detail is open. The resolver call chain runs git **synchronously**
(`execFileSync`) and re-scans the event log on every poll:

1. **Root-set spawn on every poll, even a cache hit.** `readAllowedRoots()`
   spawns `git worktree list --porcelain` inside `resolveMissionContext`
   *before* the resolver cache-hit check — because `chosen.root` feeds the `rev`
   that keys that cache. So even a pure cache hit pays a process spawn each poll.
2. **Sync git blocks the single-threaded Hono event loop.** `checkSquashMerged`
   (`execFileSync`, 8 s timeout), `readOriginSlug`, `readAllowedRoots` and
   `readChangedTestFiles` are all synchronous. A slow git call freezes the whole
   server — it stalls the embedded-terminal WS frames and the 1 s transcript
   poll, not just the Mission tab.
3. **Full linear event-log scan per resolve.** `findWorkCompleted` re-reads and
   re-projects all of `shipwright_events.jsonl` (~350 KB / 470 rows today,
   bounded at 64 MB) on every poll, keyed by nothing. CONTRACT §5.2 asked for an
   **indexed** run_id lookup.

## Approach

- **Async git (item 2).** `GitRunner` becomes `(args, cwd) => string |
  Promise<string>`; the production `defaultGit` in both `worktree-roots.ts` and
  `merge-check.ts` switches to `promisify(execFile)`. Every caller awaits:
  `readAllowedRoots`, `readOriginSlug`, `checkSquashMerged`, `readChangedTestFiles`,
  `buildSlice2Artifacts`, `refreshMerge`, `resolveMissionContext`, and the two
  route handlers (already `async`). Sync test doubles still satisfy the widened
  `GitRunner` type, so injection sites are unchanged.
- **Root-set short-TTL cache (item 1).** New `readAllowedRootsCached` wraps
  `readAllowedRoots` in a per-projectRoot cache with a 5 s TTL. The resolver uses
  it; a cache hit is now a `Map` lookup, not a spawn. Worktrees change only at
  iterate start/finalize, so ≤5 s staleness self-corrects on the next poll — and
  never escapes a guard (every read still re-runs pathGuard + realPathGuard + the
  doc fingerprint). The **detail endpoint keeps the uncached** `readAllowedRoots`:
  its git re-validation of a minted capability must be point-in-time fresh.
- **mtime-keyed run_id index (item 3).** `findWorkCompleted` keeps a per-log
  index `Map<runId, RunProjection>` keyed by `(mtimeMs, sizeBytes)`. A new
  single-fd `readBoundedFileIfChanged` (in `fs-read.ts`) fstats once and only
  reads the bytes when the fingerprint moved — so an unchanged log is neither
  re-read nor re-projected; a changed log rebuilds the index in one scan. The
  `absent`/`unavailable`/`found` distinction is preserved exactly.

## Affected Boundaries

- `shipwright_events.jsonl` — READ boundary (unchanged shape; now fingerprint-cached).
- git subprocess — same argv, same `shell:false`, same timeouts; only sync→async.
- No file-format, schema, or response-shape change. `MissionContext` output is
  byte-identical for identical inputs.

## Non-goals

- No change to the merge-detection logic, the PR-number validation, the path
  guards, or the caching *semantics* of `checkSquashMerged` / the resolver
  response cache. This is plumbing + two read caches, nothing behavioral.

## Confidence Calibration
- **Boundaries touched:** git subprocess (sync→async), `shipwright_events.jsonl`
  read (now fingerprint-cached), the worktree root-set read (now TTL-cached). No
  write surfaces.
- **Empirical probes run:**
  - Baseline before any edit: `tsc --noEmit` exit 0; mission-context vitest
    31 files / 381 tests green (the behavior snapshot).
  - Event log measured at 348 879 bytes / 470 rows — the "64 MB bound" is
    theoretical; the real cost is the re-read + 470 `JSON.parse` per poll.
  - Confirmed the only non-test caller of `buildSlice2Artifacts`/
    `resolveMissionContext` is the resolver / router (grep) — async ripple is
    contained; no cross-package caller.
- **Test Completeness Ledger:** see table below.
- **Confidence-pattern check:** asymptote — the full mission-context suite is the
  behavior oracle and must stay green after only mechanical `await` edits.
  breadth — new call-count tests pin each cache (git spawned once/TTL; log scanned
  once/change) and an async git double proves the awaited path. No
  `cross_component` framework machinery is touched, so no integration-category
  behavior is required.

### Test Completeness Ledger

| Behavior | Disposition | Evidence |
|---|---|---|
| Async `GitRunner` is awaited (Promise-returning double resolves correctly) | tested | `merge-check.test.ts` async git double case |
| Sync git doubles still satisfy `GitRunner` (no injection churn) | tested | whole suite compiles + green under widened type |
| `readAllowedRootsCached` spawns git once within the TTL | tested | `worktree-roots.test.ts` call-count case |
| `readAllowedRootsCached` re-spawns after TTL expiry | tested | `worktree-roots.test.ts` clock-advance case |
| Detail endpoint still re-validates roots (uncached) | tested | `routes.documents.test.ts` (unchanged, green) |
| `findWorkCompleted` scans the log once while unchanged | tested | `iterate-record.test.ts` read-count case |
| `findWorkCompleted` rebuilds the index after the log changes | tested | `iterate-record.test.ts` mtime-change case |
| `found` / `absent` / `unavailable` distinction preserved | tested | `iterate-record.test.ts` + merge-freshness (unchanged, green) |
| Merge state stays live across resolver cache hits (no regression) | tested | `routes.merge-freshness.test.ts` (unchanged, green) |
| Mission-context response byte-identical for identical inputs | tested | full mission-context suite green post-refactor |

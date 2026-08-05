# Iterate ADR — iterate-2026-07-10-snapshot-tmp-sweep (D19)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D19 · Complexity: medium
(orchestrator override of a keyword-driven `large` false positive; risk flag
`touches_io_boundary`, enforcement `round_trip_test`) · Type: bug (spec_impact:
none). Findings: F26 (LOW).

## Change summary
Interrupted snapshot writes (shutdown fires a fire-and-forget finalize then
`process.exit` WITHOUT awaiting snapshot writes; or the EBUSY rename budget
exhausts) strand `<taskId>.snapshot.tmp-<pid>-<ms>-<rand>` staging files holding
full terminal cell-state (possibly secrets). NO existing cleanup surface matched
that pattern — not the DELETE cascade (exact `.snapshot` unlink), not
`sweepExpired` (`.log` regex), not the iterate-C boot wipe (`.log` regex). F26 =
indefinite disk leak of secret-bearing state.

- `server/src/terminal/snapshot-tmp-sweep.ts` — NEW cohesive module (184 LOC),
  the single source of truth for the `.snapshot.tmp-` naming + reclamation.
  Two pure-over-injectable-fs-deps functions (mirrors boot-wipe.ts's testable
  shape):
  - `sweepOrphanSnapshotTmp({dir, maxAgeMs=1h, deps?, now?, logWarn?, logInfo?})`
    — age-gated sweep. Matches `^[0-9a-fA-F-]{36}\.snapshot\.tmp-` (bounded,
    ReDoS-safe), stats each, unlinks those with `mtimeMs < now-maxAgeMs`, returns
    `{deleted, errors, preserved}`. Best-effort: benign ENOENT (dir not created
    yet) is silent, any other readdir/stat/unlink failure is logged (never
    throws). Age-gating is the correctness guard: a live write renames within ms,
    so any tmp older than the cutoff is provably orphaned — no active-task veto.
  - `clearTaskSnapshotTmp({dir, taskId, deps?, logWarn?})` — immediate, NO age
    gate; unlinks every `<taskId>.snapshot.tmp-*` sibling for one task. Called
    from `SnapshotStore.clear()`.
- `server/src/terminal/snapshot-store.ts` — `clear()` now (a) resolves the dir,
  (b) drops the ENOENT early-return so it FALLS THROUGH to the tmp sweep even
  when no final `.snapshot` exists (the exact interrupted-write case), and (c)
  calls `clearTaskSnapshotTmp({dir, taskId})` AFTER the D01 `onIdle` fence — so
  no live rename can race the wipe. Condensed the over-verbose `writeQueues`
  doc-comment (also updated for accuracy: clear() now touches the tmp path).
  Held at 511 LOC (baseline 513 — NOT ratcheted).
- `server/src/index.ts` — wire `sweepOrphanSnapshotTmp` into the boot sweep +
  the 24h periodic timer alongside the scrollback sweep. DELETE-cascade wiring
  unchanged (both paths call `snapshotStore.clearBestEffort` → `clear()`, which
  now sweeps tmp internally behind the fence). Held at 897 LOC (baseline 899 —
  NOT ratcheted).
- `server/src/terminal/snapshot-tmp-sweep.test.ts` — NEW regression file (270
  LOC, < 300): AC2 orphan-reclamation boundary probe (real tmpdir, real mtime),
  fresh/live-preservation, exact-cutoff boundary, non-ENOENT-visibility,
  per-file-error resilience, `clearTaskSnapshotTmp` per-task isolation, the
  characterization that pre-fix `runBootWipe` leaves `.snapshot.tmp-*`, and the
  `SnapshotStore.clear()` fence-integration (incl. the no-final stray case).

### Footprint deviation (AC4) — recorded
The spec footprint listed `boot-wipe.ts` + `boot-wipe.test.ts` + `snapshot-store
.test.ts`. Those are NOT touched; two NEW parallel-safe files replace them.
Rationale: `snapshot-store.ts` (513) + `snapshot-store.test.ts` (423) are AT
their grandfathered bloat baselines (HARD anti-ratchet gate); adding the sweep
+ its tests + DI to `boot-wipe.ts`/`.test.ts` crosses the 300-line source limit
(a NEW baseline crossing the brief forbids: "bloat ≤ baselines"). The brief
explicitly sanctions "put new logic in a new cohesive file". Same disposition as
sibling D16 (accepted-with-reason: anti-ratchet HARD gate outranks the advisory
footprint). New files are parallel-safe (D19 serial; D01 merged; D23 runs after)
and discovered by the vitest `**/*.test.ts` glob (verified: 12 tests ran).

## Self-Review (7-item)
1. Spec Compliance — PASS. Age-gated boot+periodic sweep + per-task
   delete-cascade clear match the Fix direction; F26 no longer reproduces (AC1);
   AC2 RED-first proven behaviorally + by symbol-absence; AC3 full suite (1951)
   + build green; AC4 footprint deviation recorded above (baseline-forced).
2. Error Handling — PASS. Every fs op is try/caught; benign ENOENT silent, real
   failures logged, functions never throw (best-effort). clear() keeps the D01
   fence + idempotent ENOENT tolerance.
3. Security Basics — PASS. Touches only the webui-owned `terminal-scrollback`
   dir (read-only-observer rules 1/12: never `~/.claude/projects/**` or
   run_config). UUID-anchored matcher; `path.join(resolvedDir, readdirName)` —
   names are existing dir entries, no traversal. Reduces secret-on-disk exposure
   (the finding's intent).
4. Test Quality — PASS. Behavioral RED-first proven twice (module-absent import
   failure + pre-fix `clear()` leaving the stray, `2 failed` via git-stash);
   real-disk boundary probe (real mtime); exact-cutoff + error-visibility pinned.
5. Performance Basics — PASS. One `stat` per tmp match; runs on boot + once/24h,
   unref'd timer, fire-and-forget alongside the existing scrollback sweep. No
   new hot-path cost.
6. Naming & Structure — PASS. `sweepOrphanSnapshotTmp` / `clearTaskSnapshotTmp`
   / `preserved` descriptive; control flow < 3 levels; no dead code; no baseline
   ratchet (511≤513, 897≤899, new files < 300).
7. Affected Boundaries (ADR-024) — PASS. Producer = `SnapshotStore.writeLocked`
   staging `<taskId>.snapshot.tmp-*`; consumer = the sweep + clear (readdir →
   stat → unlink). Real round-trip probe run through the production `fs`
   (Calibration below).

## External Plan Review (Step 3.5, openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| G-a/O-2 | HIGH | Per-task tmp clear outside the store's fence can race an in-flight write → ENOENT on the store's `rename` / lost leak | accepted-and-fixed. Moved `clearTaskSnapshotTmp` INTO `SnapshotStore.clear()` AFTER the D01 `onIdle` fence; verified BOTH delete paths (`cascade-delete-project-tasks.ts`, `external/tasks/lifecycle.ts`) kill the pty FIRST, so no live write exists. Reverted the index.ts wrapper. |
| O-1/G-a | HIGH/MED | New module splits snapshot-artifact lifecycle / breaks encapsulation / over-production vs the footprint | accepted-with-reason. `clear()` now owns the tmp clear (discoverable from the store API); the module is the single source of truth for tmp naming, imported by store + index. New-file choice is baseline-forced (see Footprint deviation). |
| O-4/G-3 | MED/LOW | UUID-shaped matcher may miss non-UUID task IDs | rejected-with-reason. Task IDs are `crypto.randomUUID()` (CLAUDE.md rule 2) and UUID-validated at every store method; tmp files are produced only by `write()` (UUID-gated), so the anchored matcher is exactly the ID contract. |
| O-5 | MED | mtime age-gate: exact-threshold off-by-one / invalid mtime | accepted-and-fixed. Added an exact-cutoff test (`mtime == now-maxAgeMs` → preserved via `>=`). Invalid mtime is not producible by the local fs (best-effort). |
| O-6 | MED | Periodic sweeps could stack/overlap | accepted-verified. 24h interval ≫ a dir scan; identical fire-and-forget pattern to the existing scrollback periodic sweep in the same timer. |
| O-7 | MED | Best-effort swallow weakens privacy intent if logs are low-signal | accepted-and-fixed (see code-review #2). |
| O-3 | MED | Other delete call-sites may bypass cleanup | accepted-verified. Repo-wide grep: `snapshotClearBestEffort` binds `snapshotStore.clearBestEffort` at ONLY index.ts:395 + :558; both → `clear()` → internal sweep. |
| O-8 | LOW | RED-proof "module absent" is weak | accepted-and-fixed. Added the `SnapshotStore.clear()` behavioral regression + characterization; proven `2 failed` on pre-fix `clear()`. |
| O-9 | LOW | Non-file entry matching the prefix → repeated unlink error | accepted-verified. `unlink` is in try/catch (counts `errors`, non-fatal); EISDIR is tolerated, not crashing. |
| O-10/G-c | LOW | Prefer `.includes('.snapshot.tmp-')` over regex / share the sweep util | rejected-with-reason. Anchored UUID regex is safer + consistent with the store's own UUID gate; the module already is the shared util. |

## External Code Review (Step 3.7, openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | HIGH | New module violates the 5-file spec footprint / AC4 | accepted-with-reason (same as plan O-1; baseline-forced, D16 precedent, parallel-safe, glob-discovered). |
| 2 | MED | `sweepOrphanSnapshotTmp` treats ANY readdir failure as no-op → real EACCES/EPERM hides the leak indefinitely | accepted-and-fixed. Now: ENOENT silent (benign), any other error `logWarn`ed distinctly (both sweep + clear); added tests asserting EACCES surfaces + ENOENT stays silent. |
| 3 | MED | AC2 RED not behaviorally demonstrated (symbol-absence only) | accepted-and-fixed (same as plan O-8). |

Gemini's code-review output was truncated (streaming artifact); the readable
portion traced the fs error handling and concluded the sweep "won't throw
unhandled exceptions" — no additional HIGH surfaced.

Internal code-reviewer cascade: `reviews.code = delegated_to_orchestrator`
(the campaign orchestrator runs the `spec-reviewer → code-reviewer` cascade over
the pushed diff before merge).

## Confidence Calibration (Step 3.8, touches_io_boundary)
Boundary: snapshot-dir filesystem — producer = `SnapshotStore.writeLocked`
staging `<taskId>.snapshot.tmp-<pid>-<ms>-<rand>`; consumer = the age-gated
sweep + per-task clear (readdir → stat → unlink).
Probes run:
1. RED-first behavioral probe (git-stash pre-fix `snapshot-store.ts`): the two
   `SnapshotStore.clear()` integration tests FAIL (`2 failed` — tmp stray
   survives clear()), proving the committed tests reproduce F26. Restored → green.
2. RED-first symbol probe (module moved aside): the sweep tests error with
   "Cannot find module './snapshot-tmp-sweep.js'" → RED; module present → green.
3. Real-disk round-trip probe (committed): aged orphan tmp (mtime backdated 2h
   via `fs.utimes`) reclaimed while a fresh tmp + live `.snapshot` + live `.log`
   ALL survive — through real `fs.readdir/stat/unlink`.
4. Real-disk clear() probe (committed): interrupted-write stray (NO final
   `.snapshot`) reclaimed by `clear()`; sibling task's tmp untouched.
5. Edge probes (committed): exact-cutoff preserved; EACCES readdir surfaced;
   ENOENT silent; per-file unlink error counted + kept going.
Findings: probe 1 found the pre-fix ENOENT-early-return + no-sweep bug (RED),
fixed. Probes 3-5 found NO further issues → two consecutive clean probe rounds →
asymptote reached, boundary calibrated.
Edge cases not probed + why acceptable: cross-process concurrent sweep vs write
(single webui process owns the dir; per-task PQueue + pty-kill-first ordering);
persistent unlink EPERM on a specific stray (counted as `errors`, non-fatal,
retried next sweep); clock skew moving a real mtime forward (best-effort cleanup
— next boot/sweep reclaims once aged; documented tradeoff).

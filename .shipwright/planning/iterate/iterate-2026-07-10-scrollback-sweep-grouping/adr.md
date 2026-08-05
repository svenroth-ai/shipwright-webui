# Iterate ADR — iterate-2026-07-10-scrollback-sweep-grouping (D16)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D16 · Complexity: medium
(orchestrator override of a keyword-driven `large` false positive; risk flag
`touches_io_boundary`) · Type: bug (spec_impact: none). Findings: F25 (LOW).

## Change summary
- `server/src/terminal/scrollback-store.ts` — `sweepExpired` is now TWO-PASS.
  Pass 1 buckets every matching file by taskId and OR-accumulates a `hasFresh`
  flag (`mtimeMs >= cutoffMs`) over the whole group, independent of readdir
  order. Pass 2 filters out any group with `hasFresh`, then unlinks only the
  fully-expired groups (the bounded oldest-first delete loop is unchanged —
  still sorts by `newestMtime`, still counts one deletion UNIT per task against
  `maxFilesPerPass`). The pre-fix single-pass form mutated the group map in
  readdir order: a fresh `<id>.log` visited before an expired `<id>.log.1` ran a
  no-op `groupsById.delete(taskId)` + `continue`, then the expired sibling
  re-created the group and was unlinked — so the "any fresh file vetoes the
  whole task" rule failed for the common alphabetical (fresh-first) order.
  Removed the dead `oldestMtime` field (computed, never read) from the private
  `TaskGroup` shape as part of the same restructure. Added a `readdirFn` opts
  hook (optional, defaults to `fsAsync.readdir`) mirroring the existing
  `renameFn` / `now` test hooks — fs/promises module namespaces are not spyable
  under ESM (vitest: "Module namespace is not configurable").
- `server/src/terminal/scrollback-store-sweep-grouping.test.ts` — NEW cohesive
  regression file (the existing `scrollback-store.test.ts` is at its 636 bloat
  baseline; appending would ratchet the grandfathered entry, a HARD anti-ratchet
  gate). Four tests: fresh-first veto (AC2 RED-first), expired-first veto
  (order-independence), fully-expired one-unit delete, and a fresh-veto-under-cap
  test (plan-review HIGH). The `readdirFn` hook reorders the REAL on-disk
  listing (not a hardcoded list) so the tests still exercise actual dir contents.

Source file held at 687 LOC (baseline 688 — NOT ratcheted); new test file 145
LOC (< 300, not baselined).

## Self-Review (7-item)
1. Spec Compliance — PASS. Two-pass bucket-then-veto exactly matches the spec
   Fix direction; the fresh-`.log` + expired-`.log.1` fresh-first scenario no
   longer reproduces (AC1); AC2 RED-first proven; AC3 full suite green; AC4
   footprint = the two named modules' subject (new test file is the sanctioned
   at-baseline exception).
2. Error Handling — PASS. Pass-1 `stat` stays in try/catch (errors++, file
   excluded); pass-2 `unlink` stays in try/catch (errors++, `groupFailed`
   guards `states.delete`). ENOENT/torn-read tolerance during the sweep window
   is unchanged from pre-fix.
3. Security Basics — PASS. No new inputs/auth/secrets. `readdirFn` is an
   internal constructor option only — not wired to env, request, or user input.
   UUID regex gate on filenames unchanged.
4. Test Quality — PASS. RED-first proven twice (initial + final test code)
   against the restored single-pass logic; both readdir orders asserted;
   maxFilesPerPass one-unit + cap-independence pinned; hook reorders real dir
   contents.
5. Performance Basics — PASS. Same one `stat` per file; adds one boolean per
   file + one `.filter()` over the group set. No extra syscalls; removes nothing
   that was load-bearing.
6. Naming & Structure — PASS. `hasFresh`, `readdirFn`, `fresh` descriptive;
   control flow < 3 levels; dead `oldestMtime` removed; no baseline ratchet.
7. Affected Boundaries (ADR-024) — PASS. Producer = rotation writing `.log` /
   `.log.1`; consumer = `sweepExpired` (readdir → stat → unlink). Real
   round-trip probe run through the production `fs.readdir` path (see
   Calibration).

## External Plan Review (Step 3.5, openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| G1 | HIGH | If `maxFilesPerPass` limited pass 1, a mixed group read after the cap would look expired and lose its archive | accepted-verified-already-correct. Pass 1 iterates ALL `entries` with NO cap; the `result.deleted >= maxFiles` gate lives ONLY in the pass-2 delete loop and counts by GROUP. Added a dedicated regression (2 expired tasks + 1 mixed, fresh `.log` dead-last, `maxFilesPerPass:1`) proving the veto survives the cap. |
| O1/G2 | MED/HIGH | New test file violates the spec footprint / AC4 | accepted-with-reason. The existing `scrollback-store.test.ts` is grandfathered at its 636 bloat baseline; appending ratchets it — a HARD anti-ratchet gate (blocked by the pre-commit hook + Group-H audit). The orchestrator brief explicitly sanctions "a new cohesive `*.test.ts` when the test file is at baseline". The new file is parallel-safe (no other sub-iterate touches it) and IS discovered by the `**/*.test.ts` vitest glob (verified: it ran). The anti-ratchet HARD gate outranks the advisory footprint contract. |
| O3 | MED | Removing `oldestMtime` might change deletion ordering | accepted-verified. `oldestMtime` was computed but never read (grep: zero references pre-fix); bounded oldest-first ordering is driven by `newestMtime` sort, preserved verbatim. |
| O4 | MED | Edge cases: inverse order + multi-file groups beyond `.log`/`.log.1` | partially-accepted. Inverse order covered by the expired-first test (fresh `.log` visited last). Rotation keeps exactly ONE archive (`rotate()` renames live→`.log.1`); `.log.2+` do not exist by design, so no >2-file group is reachable. |
| O2 | LOW | `readdirFn` hook may exceed what's needed | rejected-with-reason. Empirically necessary: `vi.spyOn(fs,'readdir')` throws "Module namespace is not configurable in ESM"; real readdir order is non-deterministic across filesystems (would make AC2 a false-GREEN on hash-ordered FSes). Hook mirrors the file's existing `renameFn`/`now` DI convention, optional + defaulted. |
| O5 | LOW | Two-pass widens the TOCTOU window between grouping and unlink | accepted-noted. `unlink` stays in try/catch (ENOENT-tolerant, non-fatal); window existed pre-fix (stat-then-unlink). Not worsened materially. |
| O6 | MED | `readdirFn` changes the options shape → could break callers | accepted-verified. Optional with `?? fsAsync.readdir` default; full server suite (1927) + typecheck green → no caller changed. |
| O7 | LOW | Boundary at `mtime === cutoff` | rejected-with-reason. Comparison operator (`>= cutoffMs`) + cutoff computation reused verbatim — no semantic shift. |
| O8 | LOW | `readdirFn` adds an fs-affecting seam | accepted-verified. Internal constructor/test option only, never externally controllable. |
| G3 | LOW | Prefer top-level `vi.mock('node:fs/promises', …)` over a production hook | rejected-with-reason. Diverges from the file's established DI-hook idiom (`renameFn`, `now`); a module-wide hoisted mock of a builtin is harder to vary per-test and riskier than a narrow optional option. |

## External Code Review (Step 3.7, openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | MED/HIGH | New test file violates spec footprint / AC4; verify runner discovers it | accepted-with-reason (same as plan O1/G2). Verified discovered by the `**/*.test.ts` glob. Anti-ratchet HARD gate forces the new-file choice. |
| 2 | MED | `readdirFn` returned a hardcoded list, never the real dir contents → a broken impl depending on omitted entries could pass | accepted-and-fixed. The hook now reads the REAL `fs.readdir(dir)` and only reorders it (named entries first, extras appended), so the tests exercise `sweepExpired` against actual on-disk files while still forcing order. |

Internal code-reviewer cascade: `reviews.code = delegated_to_orchestrator`
(the campaign orchestrator runs a code-reviewer subagent over the pushed diff
before merge).

## Confidence Calibration (Step 3.8, touches_io_boundary)
Boundary: scrollback filesystem sweep — producer = rotation writing
`<id>.log` / `<id>.log.1`; consumer = `sweepExpired` (readdir → stat → unlink).
Probes run:
1. RED-first probe (run twice — initial + final test code): restored the
   single-pass logic → fresh-first test fails (`deleted=1`, archive unlinked),
   other 3 pass. Proves the committed tests reproduce F25.
2. Committed unit probes (4): fresh-first veto; expired-first veto
   (order-independence); fully-expired one-unit delete; fresh-veto-under-cap
   (`maxFilesPerPass:1`, fresh `.log` dead-last) — all green post-fix.
3. THROWAWAY real-fs probe (run, then deleted): fresh `.log` + expired `.log.1`
   in a real temp dir, NO `readdirFn` → exercised the production `fs.readdir`.
   Real Windows/NTFS order = `[<id>.log, <id>.log.1]` (fresh-first — the exact
   bug-triggering order); result `{deleted:0, remaining:0, errors:0}`, both
   files survive.
Findings: probe 1 found the pre-fix bug (RED), fixed. Probes 2 + 3 found NO
further issues → two consecutive clean probe rounds → asymptote reached,
boundary calibrated.
Edge cases not probed + why acceptable: `.log.2+` multi-archive groups (rotation
keeps exactly one `.log.1` — unreachable); persistent unlink EPERM (covered by
the existing tolerant try/catch → counted as `errors`, non-fatal); `mtime ===
cutoff` exact boundary (operator preserved verbatim from pre-fix).

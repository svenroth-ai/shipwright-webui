# Iterate ADR — iterate-2026-07-10-master-shadow-scoping (D07)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D07 · Complexity: medium
(orchestrator override of a keyword-driven `large` false positive; classifier
returned `medium` + risk flags touches_auth, touches_io_boundary) · Type: bug
(spec_impact: none). Findings: F06 (MEDIUM), F34 (LOW).

## Change summary
- `client/src/hooks/useLaunchMasterRun.ts` (F06) — master-shadow reuse is now
  project-scoped. Added `projectId?` to `MasterShadowCandidate`; `findMasterShadow`
  takes the launching `projectId` and requires `t.projectId === projectId` in the
  predicate, with an entry guard (`if (!projectId) return undefined`) so an absent
  scope can never cross-match `undefined === undefined`. A duplicated project dir
  copies `runId` verbatim into its `shipwright_run_config.json`; before this,
  launching project B's single-session master reused/resumed project A's master.
- `server/src/external/launch/master-run-branch.ts` (F34) — `applyMasterRunBranch`
  now stamps `parentRunMaster: true` + `runId: cfg.config.runId` (from the re-read
  run_config — never a client-supplied value, CLAUDE.md rule 12) into `taskUpdate`.
  A direct-API `{ masterRun: true }` launch on a plain task (no parentRunMaster/
  runId) was invisible to the double-master guard scan
  (`parentRunMaster === true && runId === cfg.runId`); the stamp makes every
  attached master guard-visible regardless of launch path. Stamp lands only on a
  real launch (dryRun returns before `store.patch`).
- New `server/src/external/launch/__tests__/master-run-branch.stamp.test.ts` — the
  F34 regression, split into a cohesive sibling to keep `master-run-branch.test.ts`
  at 295 LOC (no new 300-LOC crossing; no baseline ratchet — AC4).

## Self-Review (7-item)
1. Spec Compliance — PASS. projectId threaded into findMasterShadow (F06);
   parentRunMaster+runId stamped in taskUpdate from the re-read config (F34).
   Matches the spec Fix direction exactly; footprint honored (4 spec files + 1
   sanctioned bloat-split sibling test).
2. Error Handling — PASS. No new failure modes; stamp reuses the already-validated
   `cfg.config.runId` (an "ok" config guarantees a RUN_ID_PATTERN-valid runId,
   reader line 228). The absent-scope guard fails safe (creates its own master).
3. Security Basics — PASS. `runId` is server-derived from the re-read config; a
   direct-API caller cannot smuggle a runId via the request body. No new inputs,
   auth, secrets, or path handling (read-only observer rules 1/12 untouched).
4. Test Quality — PASS. AC2 proven RED on pre-fix (client: reused A's
   `t-projectA-master`; server: parentRunMaster undefined + guard returned 200)
   then green. dryRun-no-stamp + absent-scope guard covered; existing same-project
   reuse retained (candidates now carry projectId:"p1").
5. Performance Basics — PASS. Two extra equality checks in a `.find`; two extra
   string fields on an already-persisted row. No new I/O, no loops added.
6. Naming & Structure — PASS. `findMasterShadow(tasks, runId, projectId)` reads
   true; control flow < 3 levels; no dead code. All 5 files < 300 LOC; no ratchet.
7. Affected Boundaries (ADR-024) — PASS. Producer = applyMasterRunBranch taskUpdate
   → store.patch stamp; file = sdk-sessions.json; consumer = a fresh store load +
   the double-master guard scan + the client findMasterShadow. Real round-trip
   probes run (see Calibration).

## External Plan Review (Step 3.5, openrouter: openai + gemini) — findings merged
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| A | HIGH/MED | New sibling test file breaches the 4-file footprint / parallel-safety contract | rejected-with-reason. The new cohesive `*.test.ts` is the campaign's SANCTIONED bloat remedy: inlining the F34 block pushes master-run-branch.test.ts 295→~345 LOC, a NEW 300-LOC crossing (Group H audit H1, HIGH) that AC4 forbids ratcheting into the baseline. Zero parallel-safety cost: a NEW file cannot merge-conflict with launch-resume-on-jsonl's edits to the EXISTING file, and D07 is serial-BEFORE it. Reviewers lacked the 300-LOC-crossing context (only saw the spec's file list). |
| B | MED | `projectId` undefined → `undefined === undefined` could cross-match | accepted-and-fixed. Added `if (!projectId) return undefined` entry guard + a regression test. Codifies exactly the under-keying invariant this iterate closes. |
| C | MED | Verify `projectId` present on every task in the searched list | accepted-verified. `ExternalTask.projectId` is required (ADR-037, always present on v2 responses); the button feeds the real list. The candidate view type keeps it optional for structural tolerance, but the guard + test cover the missing case. |
| D | MED | Stamping parentRunMaster/runId changes persisted identity — audit consumers | accepted-audited. Grepped all parentRunMaster consumers: create.ts/_phase-helpers set it at creation, phase-task-branch/useContinuePipeline set FALSE for phase shadows, MasterTaskCard/MasterRunLaunchButton/useLaunchMasterRun read it to identify the master. None treat it as immutable-at-create; "this task is the run's master" is coherent for a launched master. |
| E | MED | runId absent/malformed on stamp | rejected-with-reason. An "ok" run-config guarantees a RUN_ID_PATTERN-valid runId (reader line 228 → else `invalid`); the stamp reuses the exact value the double-master guard already compares against (line 138, unchanged). No new invariant. |
| F | MED | idempotent re-stamp of an already-attached master | rejected-with-reason. Object.assign with identical values is a no-op; the normal client-reused master already carries these exact values. |
| G | LOW | positive same-project reuse coverage | accepted-already-covered. The two existing reuse tests now carry projectId:"p1" and stay green, proving same-project reuse survives the tighter predicate. |
| H | LOW | client cannot smuggle runId | accepted-already-satisfied. runId is server-derived; the F34 test proves it comes from config (the plain task never had "run-a1b2c3d4"). |

## External Code Review (Step 3.7, openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | HIGH/MED | AC4 footprint violation — new sibling test file | rejected-with-reason (same as plan-review A: sanctioned bloat-split; zero parallel-safety cost; inlining would create a HIGH new bloat crossing). |
| 2 | MED | absent-project-id test targets an unreachable path (YAGNI/noise) | partially-accepted. The realistic two-project regression is the PRIMARY F06 test (load-bearing, RED-proven). The absent-scope test is real branch coverage of the guard the PLAN review (2 providers) explicitly requested; it is not brittle (covers a code branch I introduced). The two external reviews conflict here; resolved in favor of the guard because it is one line, falsifiable, and thematically core to the under-keying fix. |

Internal code-reviewer cascade: `reviews.code = delegated_to_orchestrator`
(orchestrator runs a code-reviewer subagent over the pushed diff before merge).

## Confidence Calibration (Step 3.8, touches_io_boundary)
Boundary: the sdk-sessions.json persist round-trip for the newly-stamped
parentRunMaster+runId (producer = applyMasterRunBranch taskUpdate → store.patch;
file = sdk-sessions.json JSON; consumer = a fresh store load + the double-master
guard scan).
Probes run:
1. Committed in-memory round-trips (master-run-branch.stamp.test.ts): plain
   masterRun launch stamps parentRunMaster+runId+awaiting_external_start; a second
   masterRun on the same run then 409s (guard sees the stamp); dryRun does NOT
   stamp. Client: two projects sharing runId → B never reuses A's shadow.
2. THROWAWAY real-fs disk round-trip (run, then deleted): plain task → stamp →
   persist → on-disk JSON carries parentRunMaster+runId → a FRESH store instance
   reloads them (state awaiting_external_start). producer→file→consumer verified.
3. THROWAWAY malformed-persisted-field probe (run, then deleted): a hand-written
   on-disk row with parentRunMaster:"yes" (non-boolean) + a valid runId → loader
   soft-drops the malformed boolean (→ undefined) and keeps the valid runId; the
   row still loads. Consumer stays robust now that the stamp writes these fields
   more widely.
Findings: probe set 1 found the pre-fix bugs (RED), all fixed. Probes 2 + 3 found
NO issues in the D07 change (two probe-harness typos — `version` vs `schemaVersion`,
array vs object-map sessions — were bugs in the PROBE, corrected, then both
passed). Two consecutive clean probe rounds → asymptote reached, boundary
calibrated.
Edge cases not probed + why acceptable: concurrent multi-process persist merge
(covered by the existing F08 merge-under-lock tests — the stamp is an ordinary
field patch that rides the same path); the display-only MasterTaskCard /
MasterRunLaunchButton unscoped label lookups (out of the F06 footprint — cosmetic
label only, never a wrong-project launch; noted as a follow-up candidate).

# Mini-plan — D10 run-config-transient-resilience (F15, MEDIUM bug)

## Problem
`readRunConfig`'s existence stat probe (run-config-reader.ts) had no retry and
no last-good-cache fallback for a non-ENOENT fault. On Windows the orchestrator
rewrites `shipwright_run_config.json` atomically (rename) on every phase_task
transition; one poll can hit the rename window and make `stat` throw
EPERM/EBUSY/EACCES. The stat catch returned `{status:"invalid"}` immediately —
escaping the torn-read mitigations the read/parse path already has.

Compounding it: `LAST_GOOD_TTL_MS` (5000) equalled the client poll cadence
(5000), so even the read/parse cache fallback was always expired at fallback
time. Client-side, `runConfigPollIntervalMs` returned `false` for `invalid`,
latching polling OFF — so one torn poll made the Pipelines lane silently vanish
mid-run and never recover without a manual refocus.

## Fix direction
1. Server: route the stat probe through the SAME retry envelope + last-good
   cache the read path uses. Extract a shared `retryTornRead()` +
   `isRetryableTornRead()` helper into the RunConfig types module (the reader
   is at its 439-LOC bloat ceiling; parseRunMode precedent). Add a local
   `serveLastGood()` to DRY the three cache-fallback sites.
2. Server: raise `LAST_GOOD_TTL_MS` 5000 → 30000 (comfortably above the 5s
   poll cadence) so a single torn poll never expires the cache at fallback.
3. Client: stop latching — `runConfigPollIntervalMs` keeps polling on `invalid`
   at a mild 10s backoff so a transient flap self-heals. `missing`/`v1_legacy`
   stay OFF (stable no-pipeline states).

## Tests (TDD, AC2 RED-first on pre-fix main)
- Server (new cohesive file run-config-reader.transient.test.ts): stat throws
  EPERM once with a fresh last-good entry → cached ok result (RED pre-fix:
  invalid); last-good survives a full 5s poll gap (RED pre-fix: TTL==5000
  expired); non-retryable EIO with no cache still invalid.
- Client (new useRunConfig.test.ts): `invalid` → truthy 10s interval (RED
  pre-fix: false); plus the pre-existing poll-cadence cases moved here from
  useContinuePipeline.test.ts.

## Footprint
run-config-reader.ts, run-config-reader.test.ts (+ new .transient.test.ts to
respect the 300-LOC test ceiling), types/run-config-v2.ts (helper home),
useRunConfig.ts, useRunConfig.test.ts (new), useContinuePipeline.test.ts
(remove the moved poll-interval block — required for a green suite).

## Invariants
Read-only-observer rules 1/12 preserved — no writes to run_config or Claude
JSONL. Bloat baseline not ratcheted (reader 438→431 LOC).

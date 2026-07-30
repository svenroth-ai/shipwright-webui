# Mini-plan — A02 per-run data join (iterate-2026-07-10-per-run-data-join)

## Problem
A01 landed a tolerant event-log projection (`core/event-log-reader.ts`), but the
WOW UI (Mission Control instruments/Record, Ship's-Log runs + sub-scores + grade
sparkline, board per-run facts) consumes a PER-RUN join, not the raw projection:
`runId` (== `task.runId` == `adr_id`) → its affected FRs, test counts, gate
lamps, phase durations, plus a grade-trend series. None of that is exposed. The
run↔task join key is the single biggest integration risk in the campaign
(backend audit §4.3); durations + gate verdicts do not exist as first-class
emitter data and MUST degrade honestly, never be fabricated.

## Approach
1. `core/run-data-types.ts` — shape contract (keeps the join < 300 LOC).
2. `core/run-data-join.ts` — pure joins over A01's `projectEventLog`:
   - `joinRunData(run)` — one `RunProjection` → `RunDataJoin` (FRs, tests,
     derived gates, phaseDurations, normalized spec_impact).
   - `deriveGates(run)` — DERIVED lamps flagged `derived: true`; only `test`
     carries a real per-run signal (from the run's own suite); review/security
     stay `"unknown"` (no per-run signal in the log). Never an authoritative
     verdict. `null` when nothing derivable.
   - `projectPhaseDurations(phase_timings)` — the iterate flat mark-list, or
     `null` (render n/a). NEVER synthesized/interpolated/back-filled.
   - `aggregatePhaseTransitions(transitions)` — PROJECT-level pipeline durations
     deduped/aggregated by `(phase, splitId)`. Transitions carry NO run key, so
     NEVER attributed to a single run (the whole array to one run would
     mis-attribute/drop durations — spec upstream note; a phase can have N
     split-ends per monorepo #369).
   - `projectGradeTrend(lines)` — folds `grade_snapshot` events (which A01 skips)
     into an ascending `[{ts,grade,score}]`; `[]` when absent. Current grade is
     NOT re-derived — that stays with `compliance-reader.ts`.
   - `readRunData` / `readRunDetail` — `pathGuard`-resolved, single file read,
     graceful empty bundle / `null` on absent/unknown. Never throws.
3. `external/runs/routes.ts` — read-only `GET .../runs`, `.../runs/:runId`
   (unknown runId → 200 `{run:null}`, never 404/500), `.../grade-trend`.
   Injected reader (testable). Mounted in the registration shell.
4. Client: `lib/runDataApi.ts` (own file — externalApi.ts at bloat ceiling) +
   `hooks/useRunData.ts` (React Query, 30 s poll, disabled without ids,
   `retry:false`). Verbatim-mirrored types (ADR-080, no cross-package import).

## Join key (highest risk — pinned + tested)
`task.runId == adr_id` is the documented contract. Miss-cases covered: a task
with no runId (`readRunDetail(root, "")` → null), a runId with no matching
`work_completed` (→ null). Degrades cleanly, never guesses.

## Honesty invariants (spec AC3/AC5)
- `phaseDurations` per-run comes ONLY from that run's own `phase_timings`;
  absent → `null`. Pipeline transitions are aggregated at project level, never
  pinned to a run. No duration is ever synthesized.
- Gate lamps flagged `derived: true`; review/security honestly `"unknown"`.
- Grade trend folds real `grade_snapshot` events; current grade reuses
  `compliance-reader.ts` (not re-derived).

## Tests (RED on pre-A02 main → green)
Server: gates/phaseDurations/join/aggregate/gradeTrend/bundle + file wrappers
(present/partial/absent/unknown-runId/no-phase_timings). Routes: 404/400/200,
runId threading, unknown-runId graceful null, default-reader disk integration.
Client: API wrapper URLs + shapes, hook enable-gating + poll cadence. HEX
runId/adr_id fixtures (a non-hex id is rejected upstream).

## Out of scope / degraded
- No rendered UI (hooks/lib only) → no visual-regression baseline move; F2
  browser-verify N/A (nothing new renders).
- Durations arrive only after a real run seeds `phase_timings`/`phase_*`
  (monorepo cross-repo dep) — reader stays graceful, does not block, does not fake.

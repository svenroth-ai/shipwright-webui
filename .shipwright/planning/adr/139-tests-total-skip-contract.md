# ADR — Epoch-gated resolution of `tests.total` (collected vs executed)

**Run-ID:** iterate-2026-08-08-tests-total-skip-contract
**Spec:** `.shipwright/planning/iterate/iterate-2026-08-08-tests-total-skip-contract.md`

## Context

The shared `shipwright_events.jsonl` format's `work_completed.tests` block
is written by the monorepo's `record_event.py` / `tests_block.py` (P2.05),
the sole producer for every Shipwright-managed project. That producer
already treats `tests.total` as the **collected** count (passed + failed +
skipped), not the executed count. This webui's own D4 ratchet
(`event-test-counts-executed.test.ts`) and every reader
(`server/src/core/mission-context/artifacts-tests.ts`,
`server/src/core/run-data-join.ts`, and their client mirrors) still assumed
the older **executed** convention (`total` excludes skips, so
`passed === total` on a clean green run). A host-gated skip
(`skipped > 0`) under the old assumption reads as `passed !== total` —
indistinguishable from a real failure — and the mismatch is a genuine
cross-repo contract conflict, not a webui-only bug: pre-reversal events on
disk were written and already interpreted under the old rule, and must
keep reading correctly forever (JSONL events are immutable).

## Decision

Adopt the toolchain's (monorepo's) convention going forward: `total` =
collected count. Resolve the ambiguity with a single epoch gate,
`REVERSAL_EPOCH_MS` (2026-08-08T00:00:00Z), in one function —
`deriveTestsGate(tests, ts)` in `server/src/core/tests-gate.ts`. An event's
own `ts` decides which SINGLE rule applies: before the epoch,
`passed === total` (old); at/after it, `passed + skipped === total` (new).
Both branches are permanent — this is not a migration shim, since a
pre-reversal event's own semantics never change. The gate resolves to one
`GateState` ("pass" | "fail" | "unknown") exactly once, server-side, at the
two join points (`run-data-join.ts` and the shared `toMissionTests()` in
`artifacts-tests.ts`, also used by `resolver.ts`) and is threaded
pre-resolved to every client consumer — no consumer re-derives from raw
`passed`/`total`. An offset-less/unparseable `ts` degrades to the stricter
pre-reversal rule rather than guessing. A genuine `unknown`-gate all-skip
record only earns "All N collected tests were skipped — none ran" wording
when the raw counts actually license that claim
(`passed===0 && total>0 && skipped===total`); any malformed record (e.g.
`skipped` exceeding `total`, or a negative `passed`) falls back to the
honest "No test result recorded."

## Consequences

A post-reversal host-gated skip now reads as a genuine pass with the skip
disclosed ("9 of 10 tests passing (1 skipped)") instead of looking like a
failure. Pre-reversal historical events keep rendering exactly as they
always did — no re-interpretation, no backfill. Every gate-consuming call
site was reduced to reading a pre-resolved field rather than re-deriving
the rule, closing the class of bug where a future consumer could apply the
wrong-era rule by accident. New drift guard
`run-tests-mirror-sync.test.ts` keeps the client `RunTests` mirror honest
(previously unguarded). This run's own `work_completed` event (written at
F5b, post-epoch) must be recorded in the collected shape with an explicit
`tests.skipped`, or the D4 ratchet would see the first-ever post-epoch
event violate the new rule.

## Rationale

The monorepo's `tests_block.py` is the sole writer across every
Shipwright-managed project; a webui-only convention that disagrees with
its one producer is a standing footgun, not a stable equilibrium. An epoch
gate (rather than a heuristic like "does `skipped` look plausible") keeps
both conventions exactly and permanently correct for the events that were
actually written under them, since an event's own timestamp is the one
fact that never needs interpretation.

## Rejected alternatives

(1) Reinterpret all historical events under the new rule — rejected: it
silently changes the meaning of past runs' recorded pass/fail state.
(2) Add a schema-version field to the event instead of an epoch gate —
rejected: the producer (monorepo) does not emit one and changing its
shape is out of this run's scope. (3) A naive "accept either convention"
predicate (`passed===total OR passed+skipped===total`, unconditionally) —
rejected as UNSOUND, not merely imprecise: an old-convention genuine
failure (`passed:99,total:100,skipped:1` — one real failure) and a
new-convention genuine pass with the identical numbers (100 collected, 0
failed) are numerically indistinguishable without knowing which
convention wrote the record. Caught independently by both external
reviewers on the plan AND the reason-blind architecture pass. The epoch
gate removes the ambiguity structurally — an event is judged by exactly
ONE rule, never both — reusing the already-battle-tested
`CONVENTION_EPOCH_MS` pattern from the ratchet this run reverses.

## Architecture impact

`convention` — see `conventions.md` → `## Convention Updates`,
run_id `iterate-2026-08-08-tests-total-skip-contract`.

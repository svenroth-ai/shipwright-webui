# Mini-Plan: tests-total-skip-contract

- **Run ID:** iterate-2026-08-08-tests-total-skip-contract

> **Revised after an internal Opus plan review (REVISE verdict).** The first
> draft's central claim ("no historical event carries `skipped`") was
> empirically false — verified by hand against the real
> `shipwright_events.jsonl`: 42 records already carry it, all under the OLD
> convention. The design below (a dual-predicate accepting EITHER
> convention) resolves that without any data amendment, and centralizes the
> predicate into one new file per workspace instead of hand-rolling it at
> 8+ call sites — which also fixes two bloat-ceiling near-misses the review
> flagged (`missionArtifacts.ts` at exactly 300 lines, `event-log-reader.test.ts`
> already a grandfathered 321-line baseline entry). See the iterate spec's
> `## Internal Plan Review` section for the full finding list.

## Design Revision 2 (post external LLM plan review)

External review (Branch A, deepseek=approve, openai=revise) caught a real
gap in Revision 1's pure OR-predicate: it cannot distinguish an **old**-style
run that has a genuine failure whose count coincidentally equals its
`skipped` value (e.g. `passed:99, total:100, skipped:1` — under the OLD
convention this means 1 real failure — 100 executed, 99 passed — plus 1
separately-tracked skip) from a **new**-style genuinely green run
(`passed:99, total:100, skipped:1` meaning 100 collected, 99 passed, 1
skipped, 0 failures). The two are numerically identical; a pure OR cannot
tell them apart, so it would falsely accept the old-style failure as green.
(This exact shape has never actually been recorded here — this project's own
Iron Law means a real failure is never finalized — but the ratchet's job is
to hold even for events this project did not itself write, e.g. a corrupted
or foreign one, so the ambiguity is a real soundness gap, not a cosmetic one.)

**Fix: reuse the epoch pattern the D4 ratchet already has**, rather than
blending both conventions for every event. `event-test-counts-executed.test.ts`
already switches interpretation at `CONVENTION_EPOCH_MS` (2026-07-21) for the
FIRST reversal (collected→executed). This run adds a SECOND epoch
(`REVERSAL_EPOCH_MS`, this run's landing instant) for the second reversal:
events before it keep the OLD rule (`passed === total`, `skipped` ignored for
the gate — byte-identical to today); events at/after it use the NEW rule
(`passed + skipped === total`). No ambiguity, no coincidental collision
possible, no data amendment, and it is the SAME mechanism this file already
uses successfully — not a new pattern.

**This also simplifies the consumer wiring, and removes the client-side
predicate entirely.** **CORRECTION (post-spec-review): this was written as
"two places" and is actually THREE** — all server-side, all with an event's
`ts` in scope: `run-data-join.ts` (`RunProjection.ts` is already on hand),
`mission-context/artifacts-tests.ts` (`events.run.ts`, confirmed by reading
its caller — `buildTestsArtifact` already destructures `events.run`), and
`mission-context/resolver.ts` (found via `tsc --noEmit` during Build, not
anticipated by this plan — it independently constructs the `MissionTests`
shape for its own caller and needed the same `deriveTestsGate(run.tests,
run.ts)` wiring). Behavior is correct at all three — each resolves the gate
from the SAME `tests-gate.ts` predicate — but "one change covers both
consumers" below undercounts the actual resolution sites; read it as three.
So the epoch-aware judgment is computed EXACTLY ONCE per run, server-side, in
each of those three places, and exposed as an already-resolved verdict:

- `RunDataJoin.gates.test: GateState` — already exists (`run-data-join.ts`
  `deriveTestGate`/`deriveGates`); just make it epoch-aware and pass `run.ts`.
- `MissionTests` gains a `gate: GateState` field (alongside the new raw
  `skipped`), computed once in `normalizeResults()`/`buildTestsArtifact()`
  using `events.run.ts` — this single shape already backs BOTH
  `MissionContext.tests` and `TestsArtifact.detail.results`, so one change
  covers both consumers.

Every CLIENT consumer that needs a green/fail judgment (not just raw
numbers) now reads the pre-resolved field instead of re-deriving it:
- `proofLines.ts testsGreen()`/`suiteFailLine()` → `facts.gates?.test`
  (the `ProofFacts.gates.test` field ALREADY EXISTS in the type — it was
  simply unused; this switches it to load-bearing).
- `recordNodes.ts completionFlags().tests` → `facts.gates?.test === "pass"`
  (`RunFactsLike.gates` gains `test?: GateState`, mirroring the existing
  `review` field).
- `narrator-record.ts testsCaption()` → takes the resolved gate as a second
  argument from its caller (`narrateRecord` already has `facts.gates` in
  scope).
- `missionArtifacts.ts testsResultText()` → takes `MissionTests` (now
  carrying `gate`) instead of a bare `{passed,total}`, so both call sites
  (the chip and `MissionSlice2Details.tsx`'s panel headline) get it for free.
- `client/src/lib/narrator.ts narrateVerdict` — **no change needed,
  confirmed by reading it**: it only renders `${passed}/${total}` text when
  its caller (`proofLines.deriveVerdict`) has ALREADY decided `outcome ===
  "clear"` (which itself now depends on the corrected `testsGreen()`) — it
  never independently judges green/fail.

**Net effect: no `client/src/lib/testsGate.ts` file is needed at all.** The
only client-side numeric helper that remains is `projectLogStats.ts`'s
sparkline ratio, which stays a small INLINE, non-epoch-aware clamp (a
cosmetic trend point, not a correctness gate — a rare malformed/ambiguous
input producing a slightly-off percentage is a materially different risk
than a genuine failure rendering as "ALL CLEAR").

**Findings folded in from both external reviewers:**
- (deepseek, risk/medium) The rewritten D4 ratchet keeps an integrity
  assertion independent of the pass/fail derivation: `total >= passed`
  always, and `total >= passed + skipped` whenever `skipped` is present —
  catching a malformed event regardless of which epoch it falls in.
- (openai, medium) `deriveTestsGate` validates ALL THREE inputs, not just
  `skipped`: `passed`/`total` must be finite non-negative integers or the
  result is `unknown` (mirrors the existing `normalizedSkip` guard).
- (deepseek, low) A code comment on `normalizedSkip` notes it expects a
  numeric `skipped` (a JSON string is treated as absent, by design).
- (deepseek, low / openai, medium — now moot) The "drift between two
  independently-maintained predicate implementations" risk is eliminated
  structurally by Revision 2: there is only ONE predicate (server-side); no
  mirror-drift test is needed for logic that no longer has a second copy.
  The `RunTests`/`MissionTests` TYPE mirrors still need their own drift
  guards (the type sync work below), which is a different, already-precedented
  concern (`mission-context-types-sync.test.ts`).
- (openai, medium) The D4 ratchet's "zero offenders among the 42 real
  records" is retained as a corpus regression (real-world evidence), but is
  now supplemented by synthetic fixtures that exercise the epoch boundary
  itself and the old-convention-failure-with-a-skip shape the review flagged
  — with the epoch fix, that shape now correctly reads `fail` (not `pass`)
  when dated before `REVERSAL_EPOCH_MS`.

## 1. Files to create/modify

**New (server-only — see Design Revision 2, no client predicate file):**

| File | Purpose |
|---|---|
| `server/src/core/tests-gate.ts` | `deriveTestsGate(tests, ts)` — the ONE predicate, epoch-gated at `REVERSAL_EPOCH_MS`, used by both `run-data-join.ts` and `mission-context/artifacts-tests.ts` |
| `server/src/core/tests-gate.test.ts` | unit tests for the predicate (the real load-bearing coverage — old-epoch parity, new-epoch collected, the old-failure-with-a-skip collision case, malformed-input floors) |
| `server/src/test/run-tests-mirror-sync.test.ts` | new drift guard for the `RunTests` server/client mirror pair (raw `skipped` field only — no guard exists today, unlike `MissionTests`), text-scan pattern per `mission-context-types-sync.test.ts` |

**Edited — types:**

| File | Change |
|---|---|
| `server/src/core/event-log-types.ts` | `RunTests` +`skipped: number \| null` |
| `client/src/lib/runDataApi.ts` | `RunTests` mirror +`skipped` |
| `server/src/core/mission-context/types.ts` | `MissionTests` +`skipped: number \| null` +`gate: GateState` (pre-resolved) |
| `client/src/lib/missionContextApi.ts` | `MissionTests` mirror +`skipped` +`gate` |

**Edited — readers (parse `skipped` through):**

| File | Change |
|---|---|
| `server/src/core/event-log-reader.ts` | `projectTests()` reads `o.skipped` (raw, threaded to `run-data-join.ts` for the gate calc) |
| `server/src/core/mission-context/artifacts-tests.ts` | `normalizeResults(t, ts)` reads `t.skipped` + calls `deriveTestsGate(t, ts)` to fill `MissionTests.gate`; `resultsSentence()`/`resultsReceipt()` switch from `r.passed === r.total` to `r.gate === "pass"` / `=== "fail"` |

**Edited — consumers (read the pre-resolved server verdict; NO client-side re-derivation):**

| File | Change |
|---|---|
| `server/src/core/run-data-join.ts` | `deriveTestGate(tests, ts)` delegates to `tests-gate.ts`, epoch-gated; `deriveGates(run)` passes `run.ts` |
| `client/src/lib/recordNodes.ts` | `completionFlags().tests` → `facts.gates?.test === "pass"`; `RunFactsLike.gates` gains `test?: GateState` |
| `client/src/lib/proofLines.ts` | `testsGreen()` → `facts.gates?.test === "pass"` (the `ProofFacts.gates.test` field already exists, was simply unused); `suiteFailLine()` → `facts.gates?.test === "fail"` |
| `client/src/lib/narrator-record.ts` | `testsCaption(tests, gate)` takes the resolved gate from its caller (`narrateRecord` already has `facts.gates` in scope); `RunFactsLike.gates` gains `test?: GateState` |
| `client/src/lib/narrator.ts` | **verified, no change** — `narrateVerdict` only renders `${passed}/${total}` once its caller already decided `outcome==="clear"`; it never independently judges green/fail |
| `client/src/lib/missionArtifacts.ts` | `testsResultText(results: MissionTests)` reads `results.gate` instead of comparing `passed===total`; `testsChipValue`/`Instruments.tsx` need NO change (plain `${passed}/${total}` formatters, not gates — confirmed by reading both) |
| ~~`client/src/lib/projectLogStats.ts`~~ | **STRUCK (post-spec-review): never implemented, and correctly so.** The prescribed clamp was unnecessary — `passed <= total` holds under EITHER convention (old or collected), so the existing plain `passed/total` ratio stays valid without a `skipped`-aware formula. Verified by reading the file during Build; do not "fix" this row back in on a future re-read. |

**Not edited (verified, no change needed):**
- `client/src/components/external/mission/Instruments.tsx` and
  `missionArtifacts.testsChipValue()` — plain `${passed}/${total}` text
  formatters, not gates; the type they read carries `skipped` automatically
  once `RunTests`/`MissionTests` are updated, but they render no judgment.
- `run-data-types.ts` — re-exports `RunTests`; only its doc comment
  (mentioning the old invariant) needs a one-line edit, not logic.

**Doc cleanup:**

| File | Change |
|---|---|
| `.shipwright/agent_docs/known_issues.md` | remove the closed "Open upstream gap" section (confirm first: its `apply_amendments` shallow-merge fact is independently documented at `conventions.md:225` — verified yes, so safe to remove) |
| `.shipwright/agent_docs/conventions.md` | append a new dated convention entry recording the reversal + the dual-predicate rationale |

**Explicitly out of scope** (see iterate spec `## Out of Scope`): the
campaign flat `tests_passed`/`tests_total` channel
(`facts-slice3.ts`/`missionWording.ts`/`MissionSlice3Details.tsx`); any
`event_amended` rewrite of the 42 historical records; the monorepo repo.

## 2. Work breakdown

1. **`tests-gate.ts` (server) + its own unit tests first — this is the real
   TDD unit and the whole run's correctness hinges on it.** Signature:
   ```ts
   export interface TestsLike {
     passed: number | null;
     total: number | null;
     skipped?: number | null;
   }
   export type GateState = "pass" | "fail" | "unknown";

   // Landing instant of this run — the second reversal, mirroring D4's own
   // CONVENTION_EPOCH_MS pattern for the first one. Filled in with the real
   // merge/landing timestamp before F6 commit.
   const REVERSAL_EPOCH_MS = Date.parse("2026-08-08T00:00:00Z"); // placeholder, see step 5

   function normalizedCount(v: unknown): number | null {
     return Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null;
   }

   export function deriveTestsGate(tests: TestsLike | null, ts: string | null): GateState {
     const passed = normalizedCount(tests?.passed);
     const total = normalizedCount(tests?.total);
     if (tests == null || passed == null || total == null || total <= 0) return "unknown";
     const skip = normalizedCount(tests?.skipped) ?? 0;
     const tsMs = ts ? Date.parse(ts) : NaN;
     const accounted = Number.isFinite(tsMs) && tsMs >= REVERSAL_EPOCH_MS
       ? passed + skip === total   // new epoch: total = collected
       : passed === total;         // old epoch (or unparseable ts): total = executed only
     return accounted ? "pass" : "fail";
   }
   ```
   Test cases (write RED first): no-skip parity pre-epoch (green + fail),
   old-epoch green with skip extra (`4390/4390/skipped:1`, the real
   historical shape, dated before the epoch), **the collision case the
   external review caught** — `passed:99,total:100,skipped:1` dated
   pre-epoch must read `fail` (1 real failure under old semantics), the SAME
   numbers dated post-epoch must read `pass` (0 real failures under new
   semantics) — proving the epoch, not the raw numbers, is what disambiguates
   it; new-epoch genuine failure (`98/100/skipped:1`, post-epoch → fail);
   negative/non-integer `passed`/`total`/`skipped` each individually cannot
   forge a `pass` (→ `unknown` or `fail`, never a false `pass`); `total<=0` →
   unknown; unparseable/missing `ts` → treated as pre-epoch (the conservative,
   already-battle-tested old rule).
2. **Type + reader plumbing**: `RunTests`/`MissionTests` server+client pairs
   gain `skipped`; `MissionTests` also gains `gate: GateState` (computed by
   `normalizeResults`/`buildTestsArtifact` calling `deriveTestsGate`). Re-run
   the existing `mission-context-types-sync.test.ts` guard (should auto-cover
   the new fields structurally) + add `run-tests-mirror-sync.test.ts` for the
   previously-unguarded `RunTests` pair (text-scan pattern, no cross-package
   import — copy the established approach).
3. **Wire every consumer to the pre-resolved verdict** (the table above), one
   file at a time, each with new red→green test cases (adapted to that
   function's actual output shape — e.g. `proofLines.testsGreen()` returns
   boolean, `narrator-record.testsCaption()` returns a string with
   "green"/"passing").
4. **D4 ratchet rewrite**, run against the REAL `shipwright_events.jsonl` —
   this is the acceptance test for the whole dual-predicate design: assert
   zero offenders for all 42 `skipped`-carrying records plus every
   `skipped`-free record, under the new dual invariant. Rewrite the header
   comment to document the reversal + why both branches are permanent
   (point at the run_id + ADR).
6. **Boundary Probe** (`touches_io_boundary`): round-trip — write a synthetic
   `work_completed` line with `tests.skipped` into a temp event log, read it
   through `event-log-reader` → `run-data-join` → each client consumer
   called directly, assert agreement across skipped-absent /
   skipped-zero / skipped-positive-green / skipped-positive-fail.
7. **Doc cleanup** (known_issues.md removal, conventions.md entry).
8. **Self-review, Confidence Calibration, Full Code Review cascade**
   (spec-reviewer → code-reviewer → doubt-reviewer, `model=opus` per operator
   instruction), Review Record.
9. **E2E** (author + execute, medium mandatory): Playwright spec against a
   FIXTURE event log (not the live `shipwright_events.jsonl` — keeps the
   spec's pass/fail independent of whether the amendment question is ever
   revisited) seeded with a `work_completed` event carrying `skipped>0` under
   the new convention; asserts the Mission tab's Record rail / Ship's-Log
   card render it as green, not stuck/failed.
10. **F5b: this run's own `tests` block** is written under the NEW
    convention (`total` = collected, explicit `skipped`) — the first record
    to do so.
11. **Finalization** (F0…F12) per SKILL.md.

## 3. Component hierarchy

n/a — no new component.

## 4. Data model changes

None beyond the additive, already-optional `skipped` field on four
already-versioned TS interfaces (two mirror pairs), all `| null`-typed so no
breaking change for any caller not yet updated in this same commit. No DB
migration. No new persisted file.

## 5. Test strategy

Unit (vitest, both workspaces): the predicate's own matrix (step 1/2 above)
is the primary evidence, plus each consumer's adapted cases, plus the two
mirror-sync guards. Integration/round-trip via the Boundary Probe (step 6).
E2E (Playwright, fixture-seeded) for the one real user-facing scenario. No
pgTAP/DB layer.

## 6. Alternative approaches (rejected)

1. **Migrate the monorepo instead (Option A)** — rejected per the iterate
   spec's `## Decision` section: reverts already-shipped code and
   retroactively reinterprets events already on disk for every
   Shipwright-managed project, not just this one.
2. **(Considered during the internal plan review) Amend the 42 historical
   records + add a convention-epoch gate threaded through every consumer** —
   rejected in favor of the dual-predicate: an epoch mechanism requires every
   consumer to carry the event's `ts` and a shared epoch constant (a strictly
   bigger blast radius than the six files this touches today), and an
   amendment pass repeats the exact `apply_amendments` shallow-merge hazard
   that has already corrupted a record once in this log
   (`evt-2d0b9be9` dropped `e2e_run` this way). The dual-predicate is fewer
   moving parts, needs no event timestamps, and was verified by hand against
   every real record that would have been at risk.

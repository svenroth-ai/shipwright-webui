# Iterate Spec: tests-total-skip-contract

- **Run ID:** iterate-2026-08-08-tests-total-skip-contract
- **Type:** change
- **Complexity:** medium
- **Status:** implemented (one AC pending: the run's own `work_completed` event, written at F5b)
- **Supersedes:** triage `trg-0a5466c5` (W2.02, cross-repo contract decision), which superseded `trg-817b7ff3`.

## Decision (operator contract, recorded before build)

Two Shipwright repos encode opposite meanings for `shipwright_events.jsonl`'s
`work_completed.tests.total`:

- **webui's D4 ratchet** (`server/src/test/event-test-counts-executed.test.ts`,
  iterate-2026-07-21-compliance-audit-reconcile): `total` = tests that
  EXECUTED (passed + failed) only; a green run always has `passed === total`.
- **monorepo's `tests_block.py`** (already shipped, P2.05,
  iterate-2026-07-23-tests-skipped-tracking): `total` = tests COLLECTED
  (passed + failed + skipped); invariant `passed + skipped <= total`.

**Chosen: the monorepo's convention wins (`total` = collected).** Consulted
Opus for a fast second opinion before deciding; its reasoning, adopted here:
`record_event.py` in the monorepo is the sole writer of these events — every
consumer (compliance reports, dashboards, this webui) already reads under its
meaning, and events already on disk were written under it. Reverting the
already-shipped monorepo side (the alternative, "Option A") would
retroactively change what historical events mean; migrating webui's own
(narrower, self-contained) ratchet does not. Strengthened per Opus's
suggestion: "green" is redefined as `passed + skipped === total` (not bare
`passed === total`) — a strict superset of the old rule when `skipped` is
absent/zero (byte-identical behavior for every historical event, which never
carried `skipped`), and it still catches a genuine failure (`total - passed -
skipped > 0`), which is the entire reason the old rule existed. Confirmed with
the operator (Sven) via an explicit approval gate before any code changed.

**Monorepo needs no further code change** — P2.05 already satisfies this
contract on the producer side. This iterate migrates the webui (reader) side
only. Decision recorded on `trg-0a5466c5` (dismissed, reason cites this
run_id).

## Internal Plan Review (Opus) — findings and how they changed the plan

Per operator instruction, an internal `shipwright-plan:opus-plan-reviewer`
pass (model=opus) ran against the first drafts of this spec + the mini-plan,
**before** external review. Verdict: **REVISE**. Full findings archived in
the run transcript; the load-bearing ones and their resolution:

1. **The "byte-identical historical behavior" premise was FALSE, verified.**
   `shipwright_events.jsonl` already carries `tests.skipped` on 42 records
   (all `event_amended` rows, all written under the OLD executed-only
   convention: e.g. `{"passed":4390,"total":4390,"skipped":1}` — `skipped`
   recorded as *extra* info, never folded into `total`). Under a naive
   `passed + skipped === total` rewrite every one of these flips to reading
   as a FAILED run. **Resolution — a dual-predicate, not a data migration.**
   Rather than the reviewer's suggested amendment pass (rewriting 42 records
   in place — itself the exact shallow-merge hazard this log has already hit
   once, per `apply_amendments`), the shared `deriveTestsGate()` accepts
   *either* convention: `passed === total` (old: skip tracked apart) OR
   `passed + skipped === total` (new: skip folded into total). Verified by
   hand against all 42 records plus the two disputed amendments
   (`evt-c4e54fde`, `evt-2d0b9be9`) — every one still reads `pass` under the
   OR, with **zero amendments needed**. Both branches are permanent (old
   events are immutable and must keep reading correctly forever), not a
   transitional shim.
2. **The consumer inventory was roughly half the real set**, verified by
   direct search rather than trusting the reviewer's list: also touches
   `server/src/core/mission-context/{types.ts,artifacts-tests.ts}` (a SECOND,
   independent reader of a run's tests — feeds the Mission top-row Tests
   chip, guarded both-ways by `mission-context-types-sync.test.ts`),
   `client/src/lib/narrator.ts` (`narrateVerdict`). **Resolution:** rather
   than hand-writing the OR-predicate at 8+ call sites (which is also what
   was pushing `missionArtifacts.ts`/`event-log-reader.test.ts` over their
   bloat-baseline ceilings), extract ONE pure predicate per workspace —
   `server/src/core/tests-gate.ts` / `client/src/lib/testsGate.ts` (mirrored,
   ADR-080: no cross-package import) — and have every consumer call it. This
   removes duplication instead of adding it and returns the headroom the
   ceiling findings flagged.
3. **A negative/non-integer `skipped` could manufacture a false green**
   (`passed=99, skipped=-1, total=98` satisfies the naive OR). **Resolution:**
   `tests-gate.ts` normalizes `skipped` to `0` unless it is a non-negative
   integer, in the predicate itself (defense at the one place every consumer
   now shares, rather than needing every reader to remember it).
4. **A genuinely separate, campaign-runner tests channel** (flat
   `tests_passed`/`tests_total` in campaign `status.json`, no skip concept at
   all — `facts-slice3.ts`, `missionWording.ts testCountLabel`,
   `MissionSlice3Details.tsx`) **is untouched by this run** — see Out of
   Scope; it is a different producer's wire contract, not something this
   webui-side decision governs.
5. **Spec Impact reconsidered and kept `none`** (the reviewer flagged this
   as the weaker call) — see the `## Spec Impact` section below for the
   updated reasoning: with the dual-predicate (no amendment pass), no
   historical record's rendered state actually changes; only forward-written
   runs with `skipped>0` newly read correctly.
6b. **Superseded by the external plan review (below): the dual-predicate is
   now epoch-gated**, not a permanent unconditional OR. The external plan
   review caught a real ambiguity the internal pass missed — see
   `## Architecture Review` for the reconciliation. The mini-plan's
   "Design Revision 2" section is the current, final design; this list
   documents the internal pass's own findings and is otherwise unchanged.
6. Two low-severity doc/naming findings folded in directly: the
   `apply_amendments` shallow-merge sharp edge stays documented (it already
   lives in `conventions.md:225` independent of the section being removed
   from `known_issues.md`, confirmed before deletion) and `tests-gate.ts`'s
   `skipped` gets a one-line comment disambiguating it from
   `event-log-reader.ts`'s unrelated `skippedLines` (torn-line count).

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-08-08-tests-total-skip-contract/architecture_brief.md`
- **Verdicts:** deepseek=approve · openai=revise
- **Smallest thing that would do (per reviewers):** disagreement between the
  two — deepseek: keep the permanent unconditional OR predicate exactly as
  it stood in Internal Plan Review's resolution (no cutover date: "both
  disjuncts stay permanently, driven by the event's own fields"). openai:
  normalize once at the reader using a fixed producer cutover, then expose
  one unambiguous meaning downstream — i.e., an epoch, not a permanent OR.
- **Findings:**
  - openai (medium, `simpler-alternative`): the permanent OR-only predicate
    "leaves old executed-count records and new collected-count records
    semantically indistinguishable ... makes ratios permanently ambiguous
    for failed records carrying an old-style extra `skipped`" — **the same
    ambiguity the plan review already caught** (this reviewer flagged it
    independently a second time, from the brief-plus-spec context alone).
    Accepted-and-already-fixed: see reconciliation below.
  - deepseek (low, `simpler-alternative`): recommends explicitly AGAINST a
    cutover date, on the theory that it is "a standing mechanism that can
    break when events are replayed, amended, or have ambiguous timestamps."
    Rejected-with-reason: see reconciliation below.
- **Reconciliation:** Both reviewers were shown this spec **before** it was
  updated with the epoch-gated design (see `## Internal Plan Review`
  addendum above) — the plan-level "Design Revision 2" (mini-plan) already
  existed by the time this architecture call ran, but the spec file itself
  had not yet been brought current, so both reviewers reasoned about the
  superseded, non-epoch OR. Net effect: **openai's finding is already fixed**
  by the shipped design (epoch-gated at `REVERSAL_EPOCH_MS`, exactly the fix
  it recommends: "pre-cutover records retain executed-count interpretation,
  post-cutover records use collected-count interpretation"). **deepseek's
  suggestion to drop the cutover is rejected**, because deepseek's own stated
  reason for rejecting it ("ambiguous timestamps," "breaks on replay/amend")
  is the SAME failure mode openai's finding depends on being handled
  correctly, and the existing `CONVENTION_EPOCH_MS` in this exact file
  already resolves it soundly for the FIRST reversal (compared as an
  instant, not lexically, with `+02:00`-vs-`Z` handling and file-order
  tie-breaks) — `REVERSAL_EPOCH_MS` reuses that same, already-proven
  mechanism rather than inventing a new one. A missing/unparseable `ts`
  defaults to the pre-epoch (old, stricter) rule, so a replayed/ambiguous
  event degrades to the MORE conservative interpretation, never a false
  green. Nobody suggested a `reject`, so this did not require stopping to
  ask the operator; both findings were resolvable from evidence already in
  the run.

## Goal
Migrate every webui place that currently treats `tests.passed === tests.total`
as "this run is green" to the monorepo's collected-count convention: add a
`skipped` field end-to-end (JSONL → server types → API → client types) and
redefine "green" as `passed + skipped === total`, so a run with a platform-
gated skip is never misreported as failing (or, once totals include skips,
as a lower pass percentage) while a genuine failure is still caught.

## Acceptance Criteria

**Superseded by Design Revision 2 (mini-plan) — no client-side predicate
file.** The epoch ambiguity caught by external review (below) meant the
gate has to be resolved WHERE an event's `ts` is in scope, which is
server-side only; every client consumer now reads a pre-resolved
`GateState` field instead of re-deriving pass/fail, which also removed the
need for a mirrored client predicate + its own drift-guard. The list below
is the as-shipped design; all items are done.

- [x] `RunTests` (server `event-log-types.ts` + client `runDataApi.ts`) and
      `MissionTests` (server `mission-context/types.ts` + client
      `missionContextApi.ts`) all carry `skipped: number | null`, parsed from
      the event's `tests.skipped` (present) or `null` (absent — legacy
      events). Both mirror pairs stay in sync per their existing drift
      guards (`mission-context-types-sync.test.ts`) plus a NEW equivalent
      guard for the previously-unguarded `RunTests` pair
      (`run-tests-mirror-sync.test.ts`). `MissionTests` additionally carries
      `gate: GateState` — the pre-resolved verdict.
- [x] `event-log-reader.ts`'s `projectTests()` and `mission-context/
      artifacts-tests.ts`'s `normalizeResults()` both read `skipped` through
      (same tolerant absent→null pattern as `passed`/`total`).
- [x] A single shared predicate — `server/src/core/tests-gate.ts`
      `deriveTestsGate(tests, ts)` — is the ONE place the pass/fail/unknown
      derivation lives, EPOCH-GATED at `REVERSAL_EPOCH_MS`
      (2026-08-08T00:00:00Z, layered on D4's existing `CONVENTION_EPOCH_MS`):
      an event before the reversal reads `passed === total` (old: `total` =
      executed); at/after it reads `passed + skipped === total` (new: `total`
      = collected). `unknown` when `passed`/`total` are absent/non-integer/
      negative or `total <= 0`; a negative/non-integer `skipped` normalizes
      to `0` rather than forging a green. **Post-reversal, `unknown` ALSO
      covers `total - skip <= 0` (executed count zero)** — added after
      Stage-2 code review found `passed:0,total:5,skipped:5` vacuously
      satisfied `passed+skip===total` although nothing ever ran, which would
      have lit a false ALL CLEAR on the proof card (the single worst outcome
      `proofLines.ts`'s own header names). Both branches are permanent (not a
      migration shim). Server-side only — see the `## Architecture Review`
      section for why a permanent unconditional OR (Revision 1) was rejected
      in favor of the epoch.
- [x] The gate is resolved ONCE per run, server-side, in the THREE places an
      event's `ts` is already in scope — `run-data-join.ts`
      `deriveGates()`/`deriveTestGate(tests, ts)`, and the SHARED
      `mission-context/artifacts-tests.ts` `toMissionTests(t, ts)` (threaded
      from `buildTestsArtifact`'s `events.run.ts`), which `mission-context/
      resolver.ts` also now calls for its own `context.tests` field instead
      of rebuilding the shape inline. `resolver.ts` was found via `tsc
      --noEmit` during Build, not anticipated by the mini-plan's original
      "two places" count, and originally DID duplicate the construction
      inline — Stage-2 code review found that duplication had already
      DIVERGED (the inline copy did not null out `{passed:0,total:0}` the
      way `toMissionTests` does, so `context.tests` and the Tests artifact's
      `detail.results` could disagree for the same run). Extracting the one
      shared, exported constructor closed the divergence structurally rather
      than by convention; covered by `resolver.tests-gate.test.ts` — and
      every CLIENT consumer reads the pre-resolved field instead of
      re-deriving:
      `recordNodes.ts completionFlags().tests` →
      `facts.gates?.test === "pass"`; `proofLines.ts testsGreen()`/
      `suiteFailLine()` → `facts.gates?.test`; `narrator-record.ts
      testsCaption(tests, gate)` takes the resolved gate from its caller;
      `missionArtifacts.ts testsResultText()` reads `results.gate`.
      `narrator.ts narrateVerdict` needed NO change (verified by reading it —
      it only renders `${passed}/${total}` once its caller already decided
      `outcome === "clear"`).
- [x] `projectLogStats.ts`'s `buildSparkline()` pass-ratio needed NO change
      (verified): `passed / total * 100` stays numerically valid under
      EITHER convention, since `passed <= total` always holds regardless of
      which convention wrote the record — a non-epoch-aware clamp was
      unnecessary once confirmed, not merely deferred.
- [x] The D4 ratchet test (`event-test-counts-executed.test.ts`) is rewritten
      to assert the epoch-gated invariant above (not bare `passed === total`)
      via `deriveTestsGate`, plus two convention-independent integrity checks
      (`total >= passed` always; `total >= passed + skipped` post-reversal
      only — deepseek's finding). Its header/comments describe the reversal +
      why both branches are permanent, and it runs against the REAL
      `shipwright_events.jsonl`, confirming all 42 historical `skipped`-
      carrying records still read `pass` with zero amendments.
- [x] This run's own `work_completed` event (written at F5b) records
      `tests.total` as the COLLECTED count with an explicit `tests.skipped`
      — the first record under the new convention, not another old-style one.
      `evt-a444cb0d`, ts `2026-08-08T10:22:56Z` (post-epoch):
      `{passed:6534, total:6535, skipped:1}`, satisfies `passed+skipped===total`.
- [x] `known_issues.md`'s "Open upstream gap — skipped tests have nowhere to
      go" section is removed (confirmed first that its `apply_amendments`
      shallow-merge fact survives independently in `conventions.md:225`),
      replaced by a one-line "closed by this run" pointer.
- [x] `conventions.md`'s D4 entry (iterate-2026-07-21-compliance-audit-reconcile,
      line ~225) gets a follow-up convention line recording the reversal.
- [x] Every touched function's existing test file gains cases for: no
      `skipped` field (legacy/back-compat, byte-identical outcome to before),
      `skipped > 0` post-reversal (new-convention green), old-convention
      green (`passed === total`, `skipped` extra, e.g. 4390/4390/skipped:1),
      a genuine failure under each convention, the epoch-boundary collision
      case (`passed:99,total:100,skipped:1` reading `fail` pre-reversal and
      `pass` post-reversal on identical numbers), and a negative/non-integer
      `skipped`/`passed`/`total` (must NOT forge a `pass`). Plus a disk-based
      Boundary Probe (`run-data-join.skipped-boundary.file.test.ts`) and an
      end-to-end Playwright spec (`mission-tests-skipped-gate.spec.ts`).

## Spec Impact
- **Classification:** none
- **NONE justification:** No user-visible capability is added, modified, or
  removed, and — because the dual-predicate design needs no data amendment —
  no historical record's rendered state changes either. The affected FRs
  (survivor IDs — FR-01.54/55/56/60 folded into FR-01.66; FR-01.59 covers the
  Ship's-Log gallery FR-01.60 folded into) already promise **honest**
  derivation ("no invented activity", "the body is always honest"). This
  change corrects an edge case (a *future* run with skipped tests) so that
  promise holds more completely — it does not change what the FR describes
  the product as doing, and it does not retroactively change what any
  existing run is shown as. `--affected-frs FR-01.66,FR-01.59` will still be
  recorded at F7 (compliance wants the touched FRs named even on a `none`
  classification). (Reconsidered per the internal Opus plan review, which
  flagged this as the weaker call under the original — data-amendment —
  design; the dual-predicate resolution removes the reason it flagged.)

## Out of Scope
- Any change to the monorepo (`shipwright` repo) — P2.05 already delivers the
  producer side of this contract; out of scope for this webui-only run.
- Amending any of the 42 historical `event_amended` records that already
  carry `tests.skipped` — the dual-predicate reads all of them correctly
  as-is (verified by hand against the real log during the internal plan
  review); no rewrite needed or wanted.
- Renaming `event-test-counts-executed.test.ts` — the filename is a stable
  cross-referenced anchor (CLAUDE.md rule numbering, memory, conventions.md);
  only its assertions + header change.
- ~~Rendering the skip count itself in the UI~~ — **REVERSED mid-run.** This
  was originally scoped OUT (the ACs only required the pass/fail *derivation*
  to be correct). Stage-2 code review then concretely surfaced the cost of
  that choice: a skipped-carrying green run rendered "All 10 tests passing"
  directly beside the honest "9/10 passing" receipt — an overstatement, not
  a derivation bug, but a real one, in a codebase whose whole architecture is
  built around never rendering a false claim. Put to the operator (a
  wording/scope tradeoff, not a pure engineering call); they chose to fix it
  now. `testsResultText()` (client) / `resultsSentence()` (server) now render
  `"9 of 10 tests passing (1 skipped)"` for a skipped-carrying pass, and
  `"All N tests passing"` only when `skipped` is 0/absent. Every consumer
  test + the E2E spec updated to match; verified in a real browser.
- The campaign sub-iterate runner's flat `tests_passed`/`tests_total` channel
  (`server/src/external/mission-context/facts-slice3.ts`, `client/src/lib/
  missionWording.ts testCountLabel`, rendered in `MissionSlice3Details.tsx`)
  — a structurally separate wire format (campaign `status.json`, produced by
  a different, campaign-runner-owned producer) with no `skipped` concept at
  all today. Flagged by the internal plan review; recorded here as a
  deliberate, named deferral rather than a silent miss — extending that
  channel is a separate change to a different producer's contract.

## Design Notes
n/a — no new UI surface; existing text strings' underlying boolean/derivation
changes, no new component, no visual/token change.

## Affected Boundaries
| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| monorepo `record_event.py` (already shipped) | webui `server/src/core/event-log-reader.ts` `projectTests()` | JSON line in `shipwright_events.jsonl`, field `tests.skipped` |

This is an `touches_io_boundary` change (JSONL event schema field newly read)
— Boundary Probe sub-step runs in Build (Step 6a): round-trip a synthetic
event carrying `skipped` through the reader → join → every consumer, and one
without it, and confirm both interpretations end-to-end.

## Confidence Calibration
- **Boundaries touched:** `shipwright_events.jsonl`'s `work_completed.tests`
  block, read by `server/src/core/event-log-reader.ts` `projectTests()`.
  Written by the monorepo's `record_event.py` (unchanged, already shipped);
  read-only on the webui side (Architecture rule 1/4).
- **Empirical probes run:**
  - `tests-gate.test.ts` (20 cases) — the predicate matrix, incl. the
    epoch-boundary collision case that proves the epoch (not the raw
    numbers) disambiguates two identical-looking records.
  - `run-data-join.skipped-boundary.file.test.ts` (8 cases) — REAL disk
    round-trip (temp `shipwright_events.jsonl` written + read back through
    `readRunData`/`readRunDetail`), covering skipped-absent/zero/positive-
    green/positive-fail and the epoch boundary itself.
  - `event-test-counts-executed.test.ts` rerun against the REAL, live
    `shipwright_events.jsonl` (not a fixture) — all 42 historical `skipped`-
    carrying records plus every other in-scope record read `pass`, zero
    offenders, zero amendments needed.
  - `mission-tests-skipped-gate.spec.ts` (Playwright, real browser, real
    dev-stack session) — a POST-reversal `passed:9,total:10,skipped:1`
    fixture renders "All 10 tests passing" in the Mission Tests detail panel
    and "9/10" (honest count) in the Instruments chip and artifact-link
    receipt. Confirms the fix end-to-end, not just at the unit layer.
- **Test Completeness Ledger:**

  | Behavior | Status | Evidence |
  |---|---|---|
  | `deriveTestsGate` pre-reversal parity (no skip) | tested | `tests-gate.test.ts` |
  | `deriveTestsGate` pre-reversal, real historical shape (skip extra) | tested | `tests-gate.test.ts` |
  | `deriveTestsGate` post-reversal green/fail (skip folded) | tested | `tests-gate.test.ts` |
  | Epoch-boundary collision (same numbers, opposite verdict) | tested | `tests-gate.test.ts` |
  | Malformed input floors (negative/non-integer/total<=0/null) | tested | `tests-gate.test.ts` |
  | Missing/unparseable `ts` degrades to the stricter pre-reversal rule | tested | `tests-gate.test.ts` |
  | `RunTests`/`MissionTests` server↔client mirror parity | tested | `mission-context-types-sync.test.ts`, `run-tests-mirror-sync.test.ts` |
  | `event-log-reader.ts` reads `skipped` through (absent/present) | tested | `event-log-reader.test.ts` |
  | `run-data-join.ts` gate delegation, real disk round-trip | tested | `run-data-join.skipped-boundary.file.test.ts` |
  | `deriveTestsGate` post-reversal: all-collected-tests-skipped -> `unknown`, never a vacuous pass (code review, MEDIUM — `passed:0,total:5,skipped:5` previously satisfied `passed+skip===total`) | tested | `tests-gate.test.ts` |
  | `artifacts-tests.ts`/`missionArtifacts.ts` skip-carrying-pass wording discloses the skip count (`"9 of 10 tests passing (1 skipped)"`), never rounds up to `"All 10 passing"` (code review, MEDIUM; operator chose to fix now rather than defer) | tested | `artifacts-tests.test.ts`, `MissionTestsDetail.counts.test.tsx`, `missionArtifacts.tests-chip.test.ts`, `mission-tests-skipped-gate.spec.ts` |
  | `toMissionTests()` is the SOLE `RunTests`->`MissionTests` constructor — `resolver.ts`'s `context.tests` and the Tests artifact's `detail.results` can no longer diverge on the `{0,0}` edge (code review, LOW-MEDIUM: they previously did, since `resolver.ts` built the shape inline) | tested | `artifacts-tests.test.ts` (`{0,0}`->null case), closed by construction for `resolver.ts` since it now calls the same function |
  | `resolver.ts` — the THIRD server-side gate-resolution site (found via `tsc`, not in the original mini-plan); `context.tests` gate-resolved, epoch-disambiguated | tested | `resolver.tests-gate.test.ts` (new) |
  | `recordNodes.completionFlags().tests` reads `gates.test`, incl. the discriminating `passed:9,total:10`→`done` case | tested | `recordNodes.test.ts` |
  | `proofLines.testsGreen()`/`suiteFailLine()` read `gates.test`, incl. the discriminating `passed:9,total:10`→`clear` case | tested | `proofLines.test.ts` |
  | `narrator-record.testsCaption()` takes the resolved gate, incl. the discriminating "green" (not "passing") wording case | tested | `narrator.test.ts` |
  | `narrator.ts narrateVerdict` — verified no change needed | tested (by reading + existing suite unchanged) | `narrator.test.ts` (unmodified, still green) |
  | `projectLogStats.buildSparkline()` — verified no change needed (pass-ratio math, unaffected by the headline wording decision) | tested (reasoned: `passed<=total` holds under either convention) | n/a — no behavior change, no new test; known minor quirk (sparkline dilutes slightly under skips) left undocumented-but-accepted per operator's wording-scope answer |
  | D4 ratchet against the REAL live event log (42 records + all others) | tested | `event-test-counts-executed.test.ts` |
  | D4 integrity: `total >= passed` always | tested | `event-test-counts-executed.test.ts` |
  | D4 integrity: `total >= passed+skipped` post-reversal only | tested | `event-test-counts-executed.test.ts` |
  | Boundary Probe: skipped-absent/zero/positive-green/positive-fail, real disk | tested | `run-data-join.skipped-boundary.file.test.ts` |
  | E2E: Mission tab renders a skipped-carrying green run correctly, with the skip disclosed | tested | `mission-tests-skipped-gate.spec.ts` |
  | Post-reversal ALL-collected-tests-skipped (`gate:"unknown"`) reads as "skipped — none ran", never fail-shaped "passing" text or a false green (doubt review, MEDIUM: previously fell through to the same branch as a real failure) — and a partial record (only `passed` or only `total` present) still keeps its own distinct fallback wording, not swallowed by the new `unknown` branch (regression caught by the ledger's own existing case, fixed before commit) | tested | `artifacts-tests.test.ts`, `missionArtifacts.tests-chip.test.ts` |
  | An offset-less `ts` (no `Z`/`±HH:MM`) defaults to the pre-reversal rule rather than `Date.parse`'s host-LOCAL-time reading, which would make the epoch verdict depend on the machine running the check (doubt review, LOW-MEDIUM) | tested | `tests-gate.test.ts` |
  | D4 `describe` title no longer teaches the reverted pre-epoch-only rule for a post-reversal event (doubt review, LOW) | fixed (rename, no new assertion needed) | `event-test-counts-executed.test.ts` |
  | Forward-amendment hazard: a future amendment of a pre-reversal event's `tests` must stay in the OLD shape, since `effectiveEvents()` keeps the target's own `ts` (doubt review, LOW) | documented (header comment; not independently testable — no such amendment exists yet) | `event-test-counts-executed.test.ts` header |

  0 untested-testable.
- **Confidence-pattern check:**
  - Asymptote (depth): the predicate itself has 20 direct unit cases plus a
    disk-based Boundary Probe plus a real-browser E2E — four independent
    layers converging on the same epoch-gated behavior, including the
    specific collision case external review caught (proof the design
    actually closes the gap it was built for, not just that it compiles).
    Every consumer's own regression suite additionally carries the
    "discriminating" case (`passed !== total` numerically but `gate ===
    "pass"`) — the shape a revert to the old `passed === total` reading would
    silently break, added after the spec-reviewer found the first pass of
    consumer tests all coincidentally had `passed === total` agree with
    `gate`, so none of them would have caught that regression.
  - Coverage (breadth): every consumer identified across two internal-review
    passes (Opus verified the first inventory was incomplete) plus the
    architecture review is wired and covered — server readers, all THREE
    server-side gate-resolution sites (`run-data-join.ts`,
    `mission-context/artifacts-tests.ts`, and `mission-context/resolver.ts`
    — the mini-plan originally undercounted this as two; corrected), and
    every client consumer that renders a green/fail judgment.

## Verification (medium+)
- **Surface:** web (Backend-affects-Frontend rule: this touches event
  parsing consumed by the UI's Mission tab / Ship's-Log cards, even though no
  `client/**` route file itself is new)
- **Runner command:** `npx vitest run` (server + client) — this is a pure
  derivation-logic change with no new network/DB surface; the E2E layer
  (Step 11a/b) verifies the Mission tab still renders a green run's Record
  rail correctly through a real dev-stack session.
- **Evidence path:** `server/coverage` + `client/coverage` (vitest), plus the
  E2E spec's Playwright report.

## Self-Review

Self-Review:
  1. Spec Compliance:    [pass] Implements the epoch-gated dual-convention read
     exactly per the `## Decision` section; the wording-disclosure follow-on
     (skip count in the Tests headline) was an explicit operator decision via
     `AskUserQuestion` ("Fix the wording now"), not scope creep.
  2. Error Handling:     [pass] `tests-gate.ts` defensively normalizes every
     input (non-integer/negative/null all degrade to `unknown`, never a
     forged pass); an offset-less/unparseable `ts` degrades to the stricter
     pre-reversal rule (doubt review fix); the event-log reader tolerates an
     absent `skipped` field.
  3. Security Basics:    [n/a] Read-only event-log interpretation logic; no
     user input reaches SQL/HTML, no auth surface touched.
  4. Test Quality:       [pass] Every assertion is on observable output
     (rendered wording, resolved `GateState`), never internal state; each
     behavior has a happy path, a genuine-failure path, and the
     "discriminating case" (`passed !== total` numerically but `gate ===
     "pass"`) that a revert to the old rule would silently break.
  5. Performance Basics: [n/a] No loops, no DB/network calls added; pure
     derivation over an already-in-memory record.
  6. Naming & Structure: [pass] Every touched/new file verified ≤300 lines
     (largest: `event-test-counts-executed.test.ts` at exactly 300,
     `missionArtifacts.ts` at 298, `resolver.ts` at 299).
  7. Affected Boundaries:[pass] Producer: the monorepo's `tests_block.py`
     (already shipped, out of scope). Consumer: this webui's event-log
     reader + `tests-gate.ts`. `touches_io_boundary` fires (event-log
     format) — real-disk Boundary Probe exists and passes
     (`run-data-join.skipped-boundary.file.test.ts`).
  8. Test Hygiene Probe: [pass] `scan_test_hygiene.py --diff` — no findings.

Action: All clear, proceed to commit.

**Review cascade (model=opus throughout, per operator standing instruction):**
`spec-reviewer` PASS (two passes — REJECT→fix→PASS) → `code-reviewer` APPROVE
(two passes — CHANGES REQUESTED→fix→APPROVE, then two trivial follow-up
suggestions on the APPROVE itself, both applied) → `doubt-reviewer` (Stage 3,
adversarial): 4 genuine findings (1 MEDIUM wording gap on the `unknown` gate
state, 1 LOW-MEDIUM host-timezone-dependent epoch parsing, 2 LOW
doc/title accuracy), all fixed and re-verified green in-session. External
code-review cascade (`external_review.py --mode code`, provider=openrouter):
first attempt degraded (both legs returned an empty reply); a same-session
retry of the identical request succeeded for one leg (deepseek), which
correctly flagged that the FIRST diff handed to it (`git diff HEAD`) silently
omitted every new untracked file — including the core `tests-gate.ts`
predicate itself. Fixed by `git add -N` on the seven new source/test files
before re-diffing (reverted after, no working-tree change); the corrected,
complete diff was re-submitted.

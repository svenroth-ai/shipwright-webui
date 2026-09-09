# Mini-Plan — mission-ac-coverage-view

- **run_id:** iterate-2026-09-09-mission-ac-coverage-view
- **Complexity:** small
- **Spec impact:** MODIFY FR-01.66 (Mission Context / Artifacts)
- **Confirmed with user:** extend the existing Mission Tests artifact/panel
  rather than add a new standalone panel.

## Scope (from the triage card)

Mission Control's Tests artifact already lists, per finished iterate run,
which test files were added / changed / removed and which FR each one
covers (`server/src/core/mission-context/artifacts-tests.ts` +
`traceability.ts`, rendered by `MissionSlice2Details.tsx`'s `TestsDetail`).
The v4 traceability manifest schema (shipped by w3/w5 of campaign
req3-06-mechanics-webui, #439/#440) adds an optional `ac_id` on each test
link. This iterate reads that field — if present — and groups the SAME
rows by acceptance criterion, purely as a view. **It does not compute,
infer, or store an AC binding of its own** — a file with no `ac_id` on any
of its manifest links stays ungrouped.

**Calibrated expectation:** measured in this repo, 0 of 33 requirements in
`.shipwright/compliance/test-traceability.json` currently carry an `acs`
breakdown or `ac_id` (w5 promoted 9/32 to `required_layers_source:
explicit`, but AC-scoped `@covers` tagging itself has not run here yet).
So the default, common case for this repo today is "no AC tags recorded" —
which must render as an explicit **absent** note, never as "0 tests" or a
blank table.

## Files to create/modify

1. `server/src/core/mission-context/types-slice2.ts` — extend `TestFrRef`
   with `acIds: string[]` (every distinct `ac_id` seen on this file's
   cases for this FR; `[]` = none tagged). Add `AcTestGroup { frId; acId;
   files: { path; kind }[] }`. Extend `TestsArtifact.detail` with
   `acCoverage: { tagged: boolean; groups: AcTestGroup[] }`.
2. `server/src/core/mission-context/traceability.ts` — read `t.ac_id` per
   test case in `readTraceabilityIndex`'s loop; thread it into `addLink`
   as a unioned, deduped `acIds` array (mirrors how `mappedFrom` is
   carried today).
3. `server/src/core/mission-context/traceability.v4-fixture.test.ts` —
   update the three existing `toEqual` assertions for the new `acIds`
   field; add one case where the SAME file+FR has two test cases tagging
   two different ACs, asserting both are unioned onto one `frs` entry.
4. `server/src/core/mission-context/traceability.test.ts` — read first;
   update any `frs` shape assertions for the new field (default `[]`).
5. `server/src/core/mission-context/artifacts-tests.ts` — in
   `summarizeFiles`, fold `rows[].frs[].acIds` into `AcTestGroup[]` keyed
   by `(frId, acId)`; `tagged = groups.length > 0`. Thread `acCoverage`
   into `buildTestsArtifact`'s returned detail (present whenever `rows`
   exist; `{tagged:false, groups:[]}` when no row carries an AC tag).
6. `server/src/core/mission-context/artifacts-tests.test.ts` — new cases:
   (a) a row whose manifest entry carries `acIds` produces a populated,
   correctly-grouped `acCoverage`; (b) an entirely untagged manifest
   (matching this repo's real 0/33 state) yields
   `{tagged:false, groups:[]}`, not an empty-but-"tagged" state; (c) no
   cross-contamination between two files under the same FR but different
   ACs.
7. `client/src/lib/missionContextApi.ts` — mirror the same three type
   changes verbatim (DO-NOT #7 — no cross-package import; this is the
   client's own copy of the wire shape).
8. `client/src/lib/missionArtifacts.ts` — add `acGroupLabel(group)` →
   `"AC07 — FR-01.11"` (reuses the existing FR-id-first convention).
9. `client/src/components/external/mission/MissionSlice2Details.tsx` —
   inside `TestsFileTable` (after the existing RTM table), render:
   - `!detail.acCoverage.tagged` → a note, `data-testid=
     "artifact-tests-ac-absent"`: "These tests are not yet tagged by
     acceptance criterion — the table above shows coverage by requirement
     only." (only when `hasRows`; no note when there are no file rows at
     all — nothing to tag).
   - tagged → a list, `data-testid="artifact-tests-ac-groups"`, one
     `data-testid="artifact-tests-ac-group"` per `(frId, acId)` with its
     `acGroupLabel` and the added/changed/removed files under it (reusing
     `testChangeWord`).
10. `client/src/components/external/mission/MissionSlice2Details.test.tsx`
    (or extend the existing test file for this component if one exists)
    — RTL cases for both branches + the mixed-FR no-cross-contamination
    case.
11. `client/e2e/helpers/mission-s2-fixtures.ts` — extend `traceability()`
    with an optional `{ withAc?: boolean }` param (default unchanged —
    every existing call site keeps producing untagged links, which is
    also the real-repo shape) that adds `ac_id` to the `ADDED` test link.
12. `client/e2e/flows/mission-artifacts-s2-ac-coverage.spec.ts` (new,
    keeps `mission-artifacts-s2.spec.ts` under the 300-LOC rule) — two
    flows against the real dev stack: (a) `traceability({ withAc: true })`
    renders the AC group with the right file under it; (b) the default
    (untagged) fixture — already used by the existing REMOVED-test
    scenario — renders the absent note instead of an empty/misleading
    group list.

## Test strategy

- Server unit (Vitest): traceability reader (frozen v4 fixture, extended)
  + artifacts-tests builder (tagged / absent / mixed). No new IO, no new
  external boundary — pure function extensions.
- Client unit (RTL): `MissionSlice2Details` `TestsDetail` render, both
  branches.
- E2E (Playwright, real dev stack via F0.5 — safety-enforced at this
  complexity because the change is UI-facing): the two flows above, over
  a real seeded project/task/manifest, following the existing S2 fixture
  pattern (no mocked git, no mocked manifest read).
- Full test suite required regardless of the above (risk flag
  `touches_shared_infra`: this touches `client/src/lib/*`).

## Alternative approach (considered, rejected)

**Alternative:** compute the AC grouping purely client-side from the
existing `TestRow.frs` (no server change), since the client already
receives `frs` and could re-derive an AC index if the manifest were
fetched raw.

**Rejected because:** the client has no independent read of
`test-traceability.json` today — the whole point of the traceability
reader living server-side is the size/corruption bounding
(`traceability.ts`'s own doc comment: 8 MB cap, entry cap, typed
`unavailable`). Re-fetching the raw manifest client-side to re-derive
`ac_id` would duplicate that bounding logic in a second place and create
exactly the "second source of truth for bindings" the triage card
explicitly rules out. Reading `ac_id` in the one existing server-side
inversion point and passing it through as one more field on the existing
wire shape is the smaller, single-source-of-truth change.

## Test Completeness Ledger (Step 7.5 — safety-enforced at small)

Risk flags on this run: `touches_shared_infra` only — no `touches_io_boundary`,
so Confidence Calibration (boundary-probe rounds) stays advisory; this ledger
is the mandatory piece at `small`.

| # | Behavior | Disposition | Evidence |
|---|---|---|---|
| 1 | `addLink` unions `ac_id` across two cases on the same file+FR onto one `frs` entry | tested | `traceability.ac-ids.test.ts` |
| 2 | `addLink` leaves `acIds: []` when no case for that file+FR carries an `ac_id` | tested | `traceability.ac-ids.test.ts`, `traceability.test.ts` |
| 3 | Whitespace-only `ac_id` is normalized to absent before reaching `addLink` | tested | `traceability.ac-ids.test.ts` |
| 4 | No AC-id cross-contamination between two different files under the same FR | tested | `traceability.ac-ids.test.ts` |
| 5 | `groupByAc` produces one group keyed by `(frId, acId)` for a single tagged row | tested | `artifacts-tests-ac.test.ts` |
| 6 | `groupByAc` splits one file into two groups when its cases tag two different ACs, without cross-contaminating file lists | tested | `artifacts-tests-ac.test.ts` |
| 7 | `groupByAc` returns `{tagged:false, groups:[]}` for the untagged (real-repo) shape | tested | `artifacts-tests-ac.test.ts` |
| 8 | `buildTestsArtifact` wires `acCoverage` from the SAME `rows` array the file table renders (`files?.rows ?? []`) — no divergent source | tested | `artifacts-tests-ac.test.ts` (asserts on `buildTestsArtifact` output directly, not just `groupByAc` in isolation) |
| 9 | Client renders an explicit "not yet tagged" note (not an empty table, not "0 tests") when `tagged === false` | tested | `MissionTestsAcCoverage.test.tsx`, E2E spec test 2 |
| 10 | Client groups files under an `acGroupLabel` heading ("AC07 — FR-01.11") when tagged | tested | `MissionTestsAcCoverage.test.tsx`, E2E spec test 1 |
| 11 | Client renders TWO separate group entries for the same FR tagging different ACs, without cross-contamination | tested | `MissionTestsAcCoverage.test.tsx` |
| 12 | The AC panel is actually wired into the real rendered page (not just the isolated component) | tested | E2E spec (both tests navigate the real app to `artifact-link-tests` and assert on the live DOM) |
| 13 | Server↔client wire-type mirror (`AcTestGroup`, `TestFrRef.acIds`, `TestsArtifact.detail.acCoverage`) does not drift (ADR-080) | tested | `mission-context-types-sync.test.ts` (added `AcTestGroup` to `SHARED_INTERFACES`) + `tsc --noEmit` on both workspaces |
| 14 | No launch-payload surface (`core/launcher.ts` / `buildCopyCommands`) touched | tested | repo-wide grep for new symbols (`acCoverage`, `acIds`, `AcTestGroup`) confined to `mission-context` + its mirrors/tests, confirmed independently by spec-reviewer |

No `untestable` entries — every behavior the diff introduces has a named,
passing test. Full server (4129 passed / 7 skipped) and client (4060 passed)
suites green; `tsc --noEmit` clean on both workspaces; new E2E spec (2 tests)
green against the real isolated dev stack.

## Review Cascade

- **self:** completed, 0 findings.
- **spec:** completed (spec-reviewer), 0 findings — PASS.
- **code:** completed (code-reviewer), 1 low-severity finding (stale comment
  in `traceability.v4-fixture.test.ts` claiming `ac_id` was "unread" — fixed
  in-line, re-verified green).
- **doubt:** not_applicable — no migrations/async-concurrency/cross-plugin-
  import/irreversible-ops trigger present (additive, synchronous, same-repo
  view).
- **plan / plan_internal / external_code:** not_applicable — small
  complexity, external LLM plan/code review is medium+ only.

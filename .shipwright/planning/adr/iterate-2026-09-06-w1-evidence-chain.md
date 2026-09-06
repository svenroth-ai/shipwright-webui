# CI regenerates and diffs the traceability manifest against the commit

**Run:** `iterate-2026-09-06-w1-evidence-chain` (sub-iterate `w1`, campaign
`req3-06-mechanics-webui`)

## Context

P0b/D8 for the WebUI: the requirement<->test traceability manifest
(`.shipwright/compliance/test-traceability.json`) had no CI enforcement at
all — a stale manifest (missing `@covers` bindings, orphaned tests) could
sit uncaught indefinitely. This is the WebUI half of what P3.0 did for the
monorepo (PR #654).

## Decision

Added a `traceability-manifest` CI job (push/workflow_dispatch only, never
`pull_request`/`schedule`) that imports the `test_links` collector from a
SHA-pinned checkout of the public `svenroth-ai/shipwright` monorepo,
regenerates the manifest from the current commit, and diffs it against the
committed one via `scripts/ci/traceability_manifest_gate.py`. Non-zero exit
on drift fails the build.

## CI trust-boundary acknowledgement (Step 3.4)

Diff touches `.github/workflows/ci.yml` (third-party checkout +
`astral-sh/setup-uv`, both SHA-pinned). Operator ack recorded at
`.shipwright/planning/iterate/iterate-2026-09-06-w1-evidence-chain/ci_supplychain_ack.json`,
`consistent_with: "#290"` (this repo's existing asymmetric action-pinning
posture, DO-NOT #25). The prior attempt of this sub-iterate escalated here;
the owner (Sven Roth) reviewed and approved before this attempt resumed.

## Design pivot: `source_commit` is NOT a gating field (post external-review)

The first draft compared the committed manifest's `source_commit` field to
`HEAD` and treated a mismatch as staleness. **External code review
(2026-09-06, reject-severity) proved this design unsatisfiable by
construction**, and it was fixed before this ADR's finalization — see
"External-Code-Review-Findings" below for the full finding and fix.
Confirmed empirically against this repo's own history: commit `c9d3170c`
("Release v0.27.0") carries a manifest whose `source_commit` reads
`dd7857d7` — `c9d3170c`'s OWN PARENT, never itself — because a commit's hash
is a function of its tree, which includes the manifest file; the manifest
can never embed the hash of the commit it will be committed inside of. A
gate comparing `committed.source_commit == HEAD` at `push` time can
therefore never pass, on any commit, regardless of whether a regen lands —
not "starts red until a regen lands" (the ADR's first-draft framing, and
also GLM's high-severity plan-review finding, both resolved by the same
fix) but permanently red by design. Fix: `source_commit` is now
informational provenance only (like `generated_at`), reported in the JSON
output's `info` block but never gating the exit code. Staleness is decided
purely by the FR<->test topology (added/removed requirements, `@covers`
bindings, orphans, invalid tags, `spec_hash`).

## External-Plan-Review-Findings

Both reviewers returned `revise` (mini-plan review, `iterate --mode`,
2026-09-06). High/medium findings, triaged:

| # | Reviewer | Severity | Finding | Disposition |
|---|---|---|---|---|
| 1 | glm | high | Gate expected to go RED post-merge with no path back to green | accepted-and-fixed (root cause = same `source_commit` design flaw; fixed by making it informational-only, see pivot above) |
| 2 | glm | medium | Cross-repo import is an unversioned API coupling; no contract check on collector shape | accepted-and-fixed: `run()`'s import+call now wrapped in `except (ImportError, AttributeError, TypeError)`, message names the pinned SHA to re-check |
| 3 | glm | medium | Job executes third-party code; plan didn't call out job isolation | rejected-with-reason: already satisfied — this workflow's top-level `permissions: contents: read` (no job widens it) already applies; no secrets used; noted explicitly in the ci.yml comment |
| 4 | glm | medium | Normalization scope (evidence-field exclusion) is quiet about what it doesn't check | rejected-with-reason: already documented at length in the gate's own SCOPE DECISION docstring; no further duplication needed |
| 5 | openai | high | Execution contract (Python/uv version, install, working dir) underspecified; no integration test of `run()` itself | accepted-and-fixed: added `test_traceability_manifest_gate_run.py`, a network-free integration test of `run()` against a stub collector (all exit-code branches); version/install resolution deferred to the pinned plugin's own `uv run --project`, out of this repo's scope |
| 6 | openai | high | push-only means a stale manifest can merge via PR, detected only post-merge | rejected-with-reason: intentional, pre-existing design constraint — iterate PRs structurally cannot carry a regenerated manifest (`derived_snapshots.py`'s `TEST_TRACEABILITY`, iterate-2026-07-27-derived-snapshots-off-branch); already documented in the ci.yml comment; raised again in code review and declined for the same reason each time |
| 7 | openai | medium | Normalization underspecified re: schema validation / JSON canonicalization | accepted-and-fixed (partial): added `test_schema_version_mismatch_IS_drift` confirming `schema_version` is NOT stripped (a bump fails loud); ordering/determinism of the upstream collector's own output is out of this repo's scope (it is not vendored here) |
| 8 | glm/openai | medium | Job permissions / least-privilege for third-party code execution | rejected-with-reason: same as #3 — already satisfied by the workflow's existing top-level `permissions:` block |
| 9 | glm | low | No infra-vs-gate-failure distinction on network/fetch errors | rejected-with-reason: already naturally separated — `actions/checkout` failures surface as a distinct, differently-named CI step, not conflated with the manifest-diff step |
| 10 | glm | low | Reverse-guard test should explicitly assert `pull_request`/`schedule` absent | rejected-with-reason: already satisfied — `test_the_job_excludes_pull_request_and_schedule` does exactly this |
| 11 | openai | low | No documented regen path for the red state | rejected-with-reason: moot after the design pivot (gate is no longer red-by-default); the regen command is stated in the gate's own failure message |

## External-Code-Review-Findings

Three rounds run against the evolving diff (`--mode code`). Round 1
verdicts: glm=revise, openai=**reject**. Round 2: glm=revise, openai=revise.
Round 3 (final): glm=**approve**, openai=revise (two of its three remaining
items are repeats of already-declined findings from earlier rounds; the
third was fixed).

| # | Round | Reviewer | Severity | Finding | Disposition |
|---|---|---|---|---|
| 1 | 1 | openai | **reject** | `source_commit == HEAD` self-referential, unsatisfiable by construction | accepted-and-fixed — see the design pivot section above; this IS the fix |
| 2 | 1 | openai | medium | Fixture test couldn't reveal the self-reference bug (both sides used the same stubbed sha) | accepted-and-fixed: replaced with tests asserting source_commit-mismatch-alone is NOT drift, plus a genuine-topology-drift test |
| 3 | 1 | glm | medium | `if:` reverse-guard test only checked substrings; a tautological `\|\|` condition would still pass | accepted-and-fixed: test now asserts the exact expected condition string |
| 4 | 1 | glm | medium | Only `ImportError` caught; a reshaped (not missing) collector API raises unhandled `AttributeError`/`TypeError` | accepted-and-fixed: broadened to `except (ImportError, AttributeError, TypeError)` |
| 5 | 1 | glm | medium | `build_manifest` call is an unversioned cross-repo API surface; a signature change raises `TypeError` uncaught | accepted-and-fixed: covered by the same broadened except above (call now inside the same try block) |
| 6 | 1 | glm | low | `_normalize` assumes every link is a dict; malformed committed manifest crashes | accepted-and-fixed: `isinstance(link, dict)` guard added |
| 7 | 1 | glm | low | push-only PR-merge risk | rejected-with-reason: see plan-review finding #6 above, same reasoning |
| 8 | 1 | glm | low | Manual `sys.path`/`sys.modules` cleanup in one test wasn't exception-safe | accepted-and-fixed: moved to a pytest fixture with `try/finally` teardown |
| 9 | 2 | openai | medium | `actions/checkout@v4` (both new steps) uses a mutable tag, not a SHA | rejected-with-reason: this is this repo's OWN established, documented posture (DO-NOT #25) — GitHub-owned actions deliberately stay on mutable tags; confirmed via `grep` that all 7 other `actions/checkout@v4` uses in this same file are equally unpinned; SHA-pinning would be the actual posture violation |
| 10 | 2 | openai | low | Test doesn't verify `actions/checkout` pinning, so the above "regression" would pass | rejected-with-reason: moot — see #9, there is no regression to guard against |
| 11 | 2 | glm | medium | `orphans`/`untagged_tests` entries might carry `status`/`executed` evidence fields, un-stripped, causing permanent-red | rejected-with-reason, empirically falsified: inspected the real committed manifest — `orphans` entries are dicts with keys `test`/`tagged_fr`/`reason`/`category` (no evidence fields); `untagged_tests` entries are plain strings, not dicts at all |
| 12 | 2 | glm | low | Unhandled `JSONDecodeError` on malformed committed JSON | accepted-and-fixed: wrapped in `try/except json.JSONDecodeError`, structured failure reason |
| 13 | 2 | glm | low | `_summarize_diff`'s `fresh_reqs[key].get('id', ...)` assumes a dict; malformed shared requirement value crashes the reporting path itself | accepted-and-fixed: `isinstance` guard added |
| 14 | 2 | glm | low | push-only PR-merge risk (repeat) | rejected-with-reason: repeat of #7/plan-review #6 |
| 15 | 2 | glm | low | Pinned checkout lands inside the project tree; could pollute the regen if `test_roots`/`prune_dirs` don't exclude it | rejected-with-reason: self-diagnosing — if it happens, the gate reports concrete named diff lines (spurious requirements/orphans under the checkout path), which is exactly the failure mode this gate exists to surface; verifiable on the first real CI run |
| 16 | 3 | openai | low | Test matched concatenated `run:` strings across all steps; an `echo` masquerade would pass | accepted-and-fixed: test now isolates the single step containing the script path and asserts `uv run`/`python` + both flags on that step alone |
| 17 | 3 | glm | medium | Only `plugin_root` added to `sys.path`, not the monorepo checkout root; collector's stated `shared/scripts` dependency might need it | accepted-and-fixed: monorepo root (`plugin_root.parent.parent`) now also inserted, harmless if unused |
| 18 | 3 | openai | high | push-only PR-merge risk (repeat, 3rd time) | rejected-with-reason: repeat of #7/#14/plan-review #6, same disposition every round |
| 19 | 3 | openai | medium | `actions/checkout@v4` mutable tag (repeat) | rejected-with-reason: repeat of #9, same disposition |
| 20 | 3 | glm | low | Stub collector's keyword contract is unverified against the REAL pinned commit until first CI run | disclosed, known limitation: acceptable — the push gate itself is the integration test for the real collector; documented in the module docstring |

Asymptote: round 1 had a reject-severity finding + 7 others (all
fixed/declined); round 2 had 0 reject/high-unaddressed + 6 findings (all
fixed/declined, one empirically falsified); round 3 converged to glm=approve
with openai's 3 remaining items being 2 repeats (already declined, same
reasoning both times) + 1 fixed. Stopped here — the review loop was not
finding new, unaddressed defects on round 3.

## Self-Review

See the run's `self` review-record row (`record_review_pass.py`,
`review-type self`) for the full 7-item checklist; all 7 passed. Affected
Boundaries (ADR-024): producer = the existing compliance regen writing
`.shipwright/compliance/test-traceability.json`; consumer = this new CI
gate. No new serialized format introduced; the network-free integration
tests round-trip a real write-to-disk + read-back of the manifest file
through `run()`.

## Confidence Calibration

`touches_io_boundary` fired on the final diff-risk recheck (the gate reads a
real file, `.shipwright/compliance/test-traceability.json`, off disk).
Boundary: the manifest file, producer = compliance regen (writes it),
consumer = this new gate (reads it via `committed_path.read_text()` +
`json.loads`). Probes run (all real write-to-disk + read-back through
`run()`, not mocked):

1. `test_run_returns_0_when_regen_matches_committed` / a genuine
   requirements-drift fixture — **finding**: none directly, but the
   surrounding empirical check (comparing this repo's own commit history)
   surfaced the reject-severity `source_commit` self-reference bug — fixed
   (see the design pivot above).
2. `test_run_returns_1_with_structured_reason_on_invalid_committed_json` — a
   real malformed file on disk — **finding**: unhandled `JSONDecodeError` —
   fixed (structured failure reason).
3. Round 3 external code review over the fixed code — **no new IO-boundary
   finding**. Combined with probe 2's fix holding under the full local test
   suite (769 scripts/ci tests green), two consecutive probes with no new
   finding — asymptote reached, boundary calibrated.

Edge cases not probed: the manifest's `fold_map` top-level key (present in
the real committed manifest, absent from this run's fixtures) — acceptable,
`_normalize`/`_summarize_diff` never special-case it, so it passes through
equality checks unchanged either way, same as any other untouched field.

## Consequences

CI now enforces that the traceability manifest's FR<->test topology matches
a fresh regen on every push/workflow_dispatch to main. `source_commit`
remains informational (never gates). No vendored copy of the `test_links`
collector — re-pinning the monorepo commit is the only maintenance burden.

## Rejected alternatives

- Vendoring the ~850-line `test_links` collector into this repo — rejected,
  disproportionate for a script this repo does not own.
- Gating on `pull_request` — rejected, iterate PRs structurally cannot carry
  a regenerated manifest (collision-avoidance policy), would make every
  ordinary iterate PR red for a reason it cannot fix.
- Comparing `source_commit` literally to `HEAD` — rejected after external
  review proved it unsatisfiable by construction (see pivot section above).

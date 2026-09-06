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

**Correction (round 4, below):** two round-3 findings from `reviews.json`'s
raw external-review payload were never added to this table — glm's
`sys.path` `scripts.` shadowing note (round 3, low: a later `import
scripts.` in the same process resolves into the plugin root, not this
repo's own `scripts/`) and openai's repeat PR-exclusion finding (round 3,
this time filed `high` rather than the earlier `medium`/`low`, effectively a
duplicate of row 18 at a different severity label). Both stayed
`rejected-with-reason` for the same reasoning already on record (row 7/#7
for the shadowing risk — same class as the `sys.path` pollution declined
elsewhere; row 6/#18/#19 for the PR-exclusion repeat); flagged here so the
table's own count matches `reviews.json`, per this repo's convention that a
disposition table IS the released record.

## Round 4 — internal code-review cascade (Stage 2, campaign 3f-bis, before merge)

The campaign orchestrator's Stage-1 `spec-reviewer` PASSED (both ACs
satisfied, in-scope). Stage-2 `code-reviewer` returned **REQUEST CHANGES**
with two HIGH findings — genuine correctness bugs that would make a
*current* manifest fail the gate, the exact "permanently red for a
non-staleness reason" class this whole sub-iterate exists to eliminate.
Fixed before merge (this table's own convention: correct in place, keep the
record of what changed).

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | **high** | `_normalize` stripped link-level `status`/`executed` but not each requirement's `coverage` map, which the upstream collector derives FROM those same fields (`_cov_status`: `"ok"` iff enabled AND `executed=="pass"`). The gate always regenerates with `evidence={}`, so a committed manifest carrying real execution evidence (`coverage:"ok"`) would report permanent drift against every regen (`coverage:"MISSING"`) — latent today only because this repo has no `test-evidence-index.json` yet. | accepted-and-fixed: `_normalize` now neutralizes `coverage` VALUES (keeps keys — the required/filed layer set is genuine topology). New tests: `test_coverage_value_alone_does_not_count_as_drift`, `test_coverage_key_set_change_IS_drift`. |
| 2 | **high** | Link-array equality also polices ORDER, but upstream emits `sorted(found)` over `pathlib.Path` objects — an order that differs by OS (case-fold on Windows vs. case-sensitive on POSIX) and CPython version. The committed manifest (produced on a Windows box) would report stale on Linux CI even with zero real topology change, and a local Windows regen cannot reproduce CI's order to "fix" it. | accepted-and-fixed: `_normalize` now sorts each layer's link list by `(id, tag_source)` on both sides before comparing (the SET of bindings, not their incidental order). New test: `test_link_order_alone_does_not_count_as_drift`. Added `_link_sort_key` helper. |
| 3 | medium | `_summarize_diff` enumerated a fixed field list, omitting `fold_map`/`fold_defects`/`invalid_ids` (which `build_manifest` does emit, and `fold_map` IS present in this repo's committed manifest). Drift confined to one of those exits 1 with an empty `diff` array — a red build with no actionable log line. | accepted-and-fixed: added a generic fallback that names any other differing top-level key (bounded to the key name, not its value). New test: `test_summarize_diff_reports_an_unenumerated_top_level_field`. |
| 4 | medium | `except (ImportError, AttributeError, TypeError)` around the `build_manifest`/`_validate_manifest` call meant "gate could not run" (infra failure) and "manifest is stale" (real verdict) were both exit 1 — indistinguishable to any consumer. | accepted-and-fixed: split into `ImportError` (module not found — "pin moved") vs `AttributeError`/`TypeError` (call failed — reshaped signature OR genuine collector bug), both now exit **2**, distinct from exit 1 ("stale"). Updated `test_run_names_the_pin_when_the_collector_cannot_be_imported` (now asserts exit 2); added `test_run_returns_2_when_the_collector_call_itself_raises`. |
| 5 | low | Neither `actions/checkout` step set `persist-credentials: false`, so `GITHUB_TOKEN` sat in `.git/config` while third-party Python from the pinned checkout ran in the same job — low impact (`permissions: contents: read`, no secrets) but the one credential the job actually exposes to imported code. | accepted-and-fixed: `persist-credentials: false` added to both checkout steps. New test: `test_both_checkouts_do_not_persist_credentials`. |
| 6 | low | The stub-collector integration test's `_cleanup` removed only `plugin_root` from `sys.path`, not the second entry `run()` also inserts (`plugin_root.parent.parent`, the monorepo checkout root) — leaked one `sys.path` entry per test into the shared pytest session. | accepted-and-fixed: `_cleanup` now removes both. (Production `run()` itself still leaves both entries on `sys.path` after a real CI invocation — accepted, matching round-3 finding #20's "disclosed known limitation" pattern: a one-shot CI process has no later caller to pollute.) |
| 7 | low | Two of the three imported symbols (`_validate_manifest`, all of `_test_links_io`) are PRIVATE upstream API, most likely to be renamed without notice — the ci.yml comment near `ref:` didn't say so. | accepted-and-fixed: comment above the pinned checkout step now names the exact symbol set, underscores included. |
| 8 | low | `miniplan.md`'s "Test strategy" section still read "`source_commit` diff treated as stale" — the reversed, pre-pivot design — while only a footer elsewhere in the same file corrected it (repo convention: correct in place). | accepted-and-fixed: bullet corrected in place to name the tests that actually ship (evidence/coverage/order/source_commit all treated as non-drift). |

All 8 fixed in this same commit, re-verified: local `scripts/ci/tests` suite
green after the fix (see F0 in Finalization). No new REQUEST CHANGES round
needed — every finding had a concrete, bounded fix; none required a design
reversal like round 1's `source_commit` finding did.

**Bloat split (same commit).** The round-4 fixes pushed
`traceability_manifest_gate.py` to 334 lines, past this repo's 300-line
source ceiling (Stop-hook gate). Split along the seam the test suite already
drew: `_link_sort_key`/`_normalize`/`_summarize_diff` (pure, no I/O, no
cross-repo dependency) moved to a new sibling module
`scripts/ci/traceability_manifest_diff.py`, taking the SCOPE DECISION
docstring with them (it documents policy those functions implement); `run()`/
`main()`/the CLI stayed in `traceability_manifest_gate.py`, which now imports
`_normalize`/`_summarize_diff` from the new module. The diff-logic test file
was renamed to match (`test_traceability_manifest_gate.py` ->
`test_traceability_manifest_diff.py`, `git mv`). Mechanical move, no logic
change; 775/775 tests green after. No baseline exception needed — both
resulting files are under the ceiling.

## Round 5 — second code-review pass, same class caught incomplete

Re-review of the round-4 fixes returned **REQUEST CHANGES** again: the
link-order fix (round 4, finding #2) was correct but incomplete — it only
covered `tests` link arrays, not the other two file-scan-ordered fields.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | **high** | `orphans` and `invalid_tags` are populated during the SAME per-file scan (`sorted(found)` over `Path` objects) as the `tests` link arrays round 4 fixed — the identical OS/CPython ordering flip applies, and both were left unsorted. Proven live in this repo, not hypothetical: two real test files in this manifest's own orphan set sort in opposite order on Windows vs. Linux. | accepted-and-fixed: added `_orphan_sort_key`/`_invalid_tag_sort_key`; `_normalize` now sorts `orphans` and `invalid_tags` on both sides before comparing. `invalid_layers` deliberately left unsorted — it's built from `spec.md`'s document-order parse, not the file-scan traversal, so it carries no such caveat. New tests: `test_orphan_order_alone_does_not_count_as_drift`, `test_invalid_tags_order_alone_does_not_count_as_drift`, `test_orphan_and_invalid_tag_set_change_IS_drift` (order-insensitivity must not neutralize a genuine SET change). |
| 2 | medium | `_validate_manifest` raises `ValueError` on a schema-invalid regen (by its own "fail loud" contract), and the collector's `ManifestIntegrityError` deliberately subclasses bare `Exception`, not `ValueError` — neither is caught by round 4's `ImportError`/`AttributeError`/`TypeError` split, so both escaped uncaught and exited 1: the SAME code as a genuine staleness verdict, with no JSON envelope at all. | accepted-and-fixed: added a final `except Exception` catch-all in `run()`, after the two typed cases, mapping any other collector-raised exception to exit 2 with a message naming it as a collector-internal failure, not a staleness verdict. New test: `test_run_returns_2_when_the_collector_raises_a_bare_exception_subclass` (simulates a `ManifestIntegrityError`-shaped subclass). |
| 3 | low | The pre-existing malformed-node test (`test_summarize_diff_tolerates_a_malformed_shared_requirement_value`) exercised `_summarize_diff` directly, never through `_normalize`'s own guard — the order `run()` actually calls them in production. A non-dict requirement node or non-list `tests` layer value would have crashed inside `_normalize` itself before `_summarize_diff` ever ran, and the existing test gave false confidence that path was covered. | accepted-and-fixed: `_normalize` now guards both shapes (`if not isinstance(node, dict): continue` / `if not isinstance(links, list): continue`) rather than crashing on `.get`/iteration. New test: `test_normalize_tolerates_a_malformed_requirement_node_and_layer_value`, which runs `_normalize` then `_summarize_diff` in the real call order. |
| 4 | low | `uv run --project ...` in the gate step had no `--locked`, so a `uv.lock`/`pyproject.toml` drift at the pinned monorepo commit would silently re-resolve fresh third-party dependencies instead of failing the step loud. | accepted-and-fixed: added `--locked` to the `uv run` invocation in ci.yml. New assertion in `test_the_job_runs_the_gate_script`. |

All 4 fixed in this same commit; local `scripts/ci/tests` suite green
(780/780).

**Second bloat split (same commit).** The round-5 fixes pushed
`test_traceability_manifest_diff.py` to 303 lines and
`test_traceability_manifest_gate_run.py` to 320 — both past the ceiling, and
the Stop-hook gate blocked on it (advisory-only headroom, hard block at
completion). Same policy as round 4's split: real extraction, not a baseline
exception. `test_traceability_manifest_diff.py` split along its own
non-drift-vs-IS-drift seam: the SCOPE DECISION / non-drift tests (what
`_normalize` neutralizes) stayed; the IS-drift + `_summarize_diff` +
malformed-input-tolerance tests moved to a new sibling
`test_traceability_manifest_diff_drift.py`. `test_traceability_manifest_gate_run.py`
split along its success-vs-infra-failure seam: the success/stale/missing/
malformed-JSON cases stayed; the import-failure/call-failure/exception-
catch-all cases moved to a new sibling
`test_traceability_manifest_gate_run_infra_failures.py`. Both splits needed
shared helpers extracted too (the `_link`/`_manifest` manifest builders into
`traceability_manifest_fixtures.py`; the stub-collector-writing + `sys.path`/
`sys.modules` teardown plumbing into `traceability_gate_stub_collector.py`),
matching this repo's existing convention of non-`test_`-prefixed helper
modules living alongside their test files (`accepted_risks_paths.py`,
`bootstrapper_ci_shape.py`, `semgrep_channels.py`). Mechanical split, no
logic change; all resulting files well under the ceiling (max 187 lines);
780/780 tests green after.

## Round 6 — third code-review pass, PASS with one non-blocking follow-up verified

Third review confirmed all four round-5 fixes correct and complete (verified
by counting every `def test_` before/after the split — no test lost or
duplicated — and tracing every import to a real definition). One required
fix was raised: the reviewer read the ADR before the "Second bloat split"
section above was added, so its snapshot still said "not split further" —
already stale by the time the review landed; no action needed beyond this
ADR itself now being current.

The review's non-blocking observation — whether `untagged_tests` needs the
same order-insensitive sort as `orphans`/`invalid_tags`, since it comes from
the same `enumerate_untagged=True` per-file scan — was checked against the
real collector source (`shipwright/plugins/shipwright-compliance/scripts/lib/collectors/test_links.py`,
sibling monorepo clone): `untagged_tests` is built as
`sorted(all_test_ids - tagged_ids)`, its OWN independent `sorted()` call over
a set of test-ID STRINGS, not `Path` objects — string sort is
environment-stable, so it carries no OS/CPython ordering caveat. Confirmed,
not just assumed; added an inline comment in `_normalize` (matching the
existing `invalid_layers` one) recording this so a future reader doesn't
have to re-derive it. The review's two other observations (a deeper
`node["tests"]`-not-a-dict edge case; `_summarize_diff` reporting only
lengths for `orphans`/`invalid_tags`) were explicitly flagged low-priority/
out-of-scope by the reviewer itself and left as-is. 780/780 tests green
after.

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

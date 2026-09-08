# Iterate: Traceability manifest gate — stop manufacturing repair PRs

- **Run ID:** iterate-2026-09-08-manifest-regen-finalization
- **Type:** CHANGE (CI/compliance-gate behavior)
- **Complexity:** medium (`touches_ci_supplychain` — `.github/workflows/**`)
- **Triage:** trg-1324dfc4 (supersedes trg-d54661e6)

## Problem

See the full ADR for the investigation and evidence:
[`iterate-2026-09-08-manifest-regen-finalization-traceability-gate-advisory.md`](../adr/iterate-2026-09-08-manifest-regen-finalization-traceability-gate-advisory.md).

Summary: the push-only "Traceability manifest (gate)" job hard-fails `main`
whenever a fresh regen of `.shipwright/compliance/test-traceability.json`
disagrees with the committed one — which happens on nearly any PR that adds a
test. Seven repair PRs across eight failures over three weeks
(#436/#438/#441/#443/#444/#446 + 2c4ba5c0), each blocking every other iterate
in the meantime. The card asked for a decision among three options with
evidence, not taste.

## Decision

Adopted a corrected form of option (b): the gate stays, but the regen step
becomes advisory (`continue-on-error`), and a follow-up step opens/refreshes a
small bot PR carrying the fresh regen whenever real drift is found — using
only the existing `GITHUB_TOKEN`, no auto-merge. Options (a) (finalization
commits the manifest from the iterate branch) and (c) (stop committing it
entirely) were both investigated and rejected with evidence — (a) is
code-forbidden by `check_no_derived_snapshots_committed`, (c) breaks this
repo's own live readers of the committed file. Full detail, including the
GITHUB_TOKEN/PR-required-ruleset constraint that shaped the final design and
the portability note for the monorepo, is in the ADR linked above.

## Spec Impact

MODIFY — this changes CI gate behavior and adds a new automated PR-opening
step; no product-facing spec (`spec.md`) requirement is added, changed, or
removed. No FR is minted.

## Affected Boundaries

- `.github/workflows/ci.yml` — `traceability-manifest` job (read-only,
  unchanged permissions): `continue-on-error` on the existing regen step,
  plus a new conditional artifact-upload step. A second, new job
  `traceability-manifest-regen-pr` (job-scoped `permissions:`
  `contents: write` + `pull-requests: write`, its own `concurrency:` group)
  downloads that artifact and shells out to `git`/`gh` to open/refresh the
  fix PR. Split into two jobs (not one) on doubt-review feedback — see the
  ADR's "Doubt review" section.
- `scripts/ci/traceability_manifest_gate.py` — new `--write-fresh` flag/param,
  purely additive (default `None`, existing call sites unchanged).

No client/server runtime code, no product surface, no schema change.

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** low
- **Summary:** Implementation matches the mini-plan exactly; both prior external-review findings (fork/token check-triggering limitation, stale-run race) are present and sound, including a real-shell-execution test for the race guard. No script-injection surface (shell vars, not `${{ }}` interpolation).
- **Findings:** (1) completeness/low — implementation matches mini-plan, positive confirmation, no action; (2) completeness/low — Test Completeness Ledger did not yet list the stale-run-guard test — fixed (row added below); (3) architecture/low — a maintainer closing the auto-opened PR without merging lets it silently reappear on the next drift-triggering push — disclosed in the ADR's Consequences as an accepted low-stakes characteristic, not built against.
- **Known limitations:** the auto-opened PR has no durable "rejected" state — closing it without merging does not suppress it reappearing on the next push carrying real drift (see ADR Consequences).
- **Status:** clean (1 fixed [ledger row], 1 disclosed, 0 declined)

## Architecture Review
- **Ran:** yes (`--mode architecture` over `architecture-brief.md`)
- **Verdict:** approve
- **Summary:** Retain the gate as advisory + drift-triggered repair PR rather than deleting enforcement or narrowing the check — the committed manifest has live consumers, so silent staleness is worse than visible, low-friction repair work. No findings.

## Full Code Review Cascade (Stage 1-3)

- **Stage 1 (spec-reviewer):** completed, 0 findings.
- **Stage 2 (code-reviewer):** completed, 1 low-severity finding (accepted;
  recorded via `record_review_pass.py`).
- **Stage 3 (doubt-reviewer):** completed, 3 findings (2 medium, 1 low). All
  three were FIXED (not rebutted): the job was split into a read-only gate
  job + a write-scoped `traceability-manifest-regen-pr` job that never
  checks out the pinned third-party plugin; the regen-PR job gained its own
  job-scoped `concurrency:` group so overlapping pushes cannot race; the
  push switched from a bare `git push --force` to
  `--force-with-lease=<ref>:<expect>`. Full detail in the ADR's "Doubt
  review" section. `external_code`: `not_applicable` (internal cascade was
  available and used; not a blocker-escalation scenario).

## Confidence Calibration

- **Boundaries touched:** a GitHub Actions workflow (`.github/workflows/ci.yml`)
  and one first-party CI script (`scripts/ci/traceability_manifest_gate.py`).
  `touches_ci_supplychain` risk flag applies — acknowledgement recorded at
  `.shipwright/planning/iterate/iterate-2026-09-08-manifest-regen-finalization/ci_supplychain_ack.json`.
- **Empirical probes run:**
  - Confirmed `.shipwright/compliance/test-traceability.json` IS in
    `shared/scripts/lib/derived_snapshots.py`'s `DERIVED_SNAPSHOTS` and that
    F11's `check_no_derived_snapshots_committed` is a hard ERROR gate on it —
    read the actual verifier source, not assumed from the name.
  - Confirmed (via `gh api .../rulesets`) `main-protection` requires a PR for
    every change to `main` and lists 11 required status checks, none of which
    is `Traceability manifest (gate)` — it already cannot block a PR merge
    today, only `main_health.py`'s read of it can.
  - Confirmed the webui server reads the committed manifest directly from the
    working tree (`server/src/core/mission-context/{traceability,pointer,
    worktree-roots}.ts` + tests) — this is what makes option (c)
    disproportionate, not a guess.
  - Confirmed via the pinned collector's source at the CI-pinned commit
    (`gh api .../contents/...test_links.py?ref=c0d1b38...`) that a regen
    produces `schema_version: 4`, and confirmed the CURRENTLY committed
    manifest at this run's base is ALREADY `schema_version: 4` (bumped by
    #446) — the card's "still schema_version 3" claim is stale; recorded in
    the ADR rather than silently left uncorrected.
  - Found the monorepo's own `shared/scripts/tools/ci_manifest_drift_check.py`
    (iterate-2026-08-26-r1b) already treats the identical failure class as
    advisory — read its source, this is the precedent cited for the severity
    change, not an invented posture.
- **Test Completeness Ledger:** see table below.
- **Confidence-pattern check:** asymptote — the riskiest single line
  (`steps.gate.outcome == 'failure'` vs. `.conclusion`) is exercised directly
  by `test_the_job_no_longer_hard_fails_main_but_nothing_else_is_silent`, and
  the follow-up step's actual shell body (not its YAML text) is executed
  against a real local git remote + stubbed `gh` in
  `test_traceability_regen_pr_shell.py`, covering all three outcome branches
  (infra-failure no-op, fresh PR, refresh-existing-PR). Coverage breadth: the
  `--write-fresh` flag is tested for match/mismatch/omitted; the job shape is
  tested for the swallow-step, the conditional step, permissions, no-merge,
  and token-only auth. `cross_component` does not apply — this touches one
  job in one workflow, not the shared merge/hook/campaign machinery the flag
  is scoped to.

### Test Completeness Ledger

| Behavior | Status | Evidence |
|---|---|---|
| `--write-fresh` writes the regen when it matches committed | tested | `test_write_fresh_writes_the_regen_even_when_it_matches_committed` |
| `--write-fresh` writes the regen when it is stale | tested | `test_write_fresh_writes_the_regen_when_stale_too` |
| `--write-fresh` omitted writes nothing | tested | `test_write_fresh_is_a_noop_when_omitted` |
| Existing `run()` success/stale/missing/malformed-JSON behavior is unchanged | tested | full `test_traceability_manifest_gate_run*.py` suite still green (8 pre-existing tests) |
| Gate step is the ONLY step with `continue-on-error`, carries `id: gate` | tested | `test_the_job_no_longer_hard_fails_main_but_nothing_else_is_silent` |
| Follow-up step is the ONLY conditional step, reads `outcome` not `conclusion` | tested | same test |
| Job permissions are exactly `contents:write` + `pull-requests:write` | tested | `test_the_job_grants_only_the_write_scopes_the_followup_step_needs` |
| Follow-up step never attempts to merge | tested | `test_the_followup_step_never_attempts_to_merge` |
| Follow-up step authenticates with only the default token | tested | `test_the_followup_step_uses_only_the_default_token` |
| Gate step passes `--write-fresh` to the script | tested | `test_the_advisory_step_writes_a_fresh_manifest_for_the_followup_step` |
| Missing fresh-regen output (infra failure) → graceful no-op, no branch/PR | tested | `test_missing_fresh_file_is_a_graceful_noop` (real shell execution) |
| Real drift, no PR open → commit+push+`gh pr create` | tested | `test_real_drift_opens_a_pr_when_none_is_open` (real shell execution) |
| Real drift, PR already open → refresh branch, do not re-create | tested | `test_real_drift_refreshes_without_opening_a_second_pr` (real shell execution) |
| `main` advanced past `$GITHUB_SHA` since this run started → stand down before any auth/push (stale-run guard, added after external plan review) | tested | `test_stale_run_stands_down_without_pushing` (real shell execution; advances `origin/main` after capturing the stale SHA, confirms no `gh` call and no branch created) |
| The gate script's other CLI flags/behavior (unrelated to this change) | covered-by-existing-test | pre-existing `test_traceability_manifest_gate_run_infra_failures.py`, `test_traceability_manifest_diff*.py` |
| Gate job has no `permissions:` override (read-only, alongside the pinned checkout) | tested | `test_the_job_has_no_write_permissions` |
| Regen-PR job never checks out any third-party repository | tested | `test_the_job_never_checks_out_the_pinned_third_party_plugin` (both job-shape modules) |
| Gate job exposes `steps.gate.outcome` as a job output for the sibling job | tested | `test_the_job_exposes_the_gate_outcome_as_a_job_output` |
| Regen-PR job `needs:` the gate job and its `if:` reads that output + excludes `schedule` | tested | `test_the_job_needs_the_gate_job_and_is_gated_on_its_outcome` |
| Regen-PR job carries a job-scoped `concurrency:` group (`cancel-in-progress: false`) | tested | `test_the_job_has_a_concurrency_group_so_pushes_cannot_race` |
| Regen-PR job downloads the gate job's uploaded artifact, tolerating a missing one | tested | `test_the_job_downloads_the_artifact_the_gate_job_uploaded` |
| Push uses `--force-with-lease`, never a bare `--force` | tested | `test_the_followup_step_never_force_pushes_blind` (shape) + `test_real_drift_refreshes_without_opening_a_second_pr` (real shell execution against a real prior bot commit on the remote branch) |

0 testable-but-untested rows.

## Self-Review

- [x] Matches the decision recorded in the ADR (no scope drift — implementation
  is exactly the two files the ADR names).
- [x] `check_no_derived_snapshots_committed` still applies unchanged to this
  branch's own commit — this PR touches `.github/workflows/ci.yml` and
  `scripts/ci/*`, never `.shipwright/compliance/test-traceability.json`
  itself.
- [x] No new secret/credential added; `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`
  only.
- [x] Full existing `scripts/ci/tests/` suite green (837 passed, 2
  pre-existing skips, unrelated).
- [x] Affected Boundaries: two CI jobs (one pre-existing, one new — split
  per doubt-review), one CI script. No client/server code.

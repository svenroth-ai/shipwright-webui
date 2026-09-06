# Mini-Plan: w1 — Evidence chain: CI regenerates the manifest and it must match the commit

run_id: iterate-2026-09-06-w1-evidence-chain
campaign: req3-06-mechanics-webui

## Files to create/modify

- `.github/workflows/ci.yml` (edit) — new `traceability-manifest` job, gated
  `push`/`workflow_dispatch` only (never `pull_request`, never `schedule`).
- `scripts/ci/traceability_manifest_gate.py` (new) — CI-local glue: imports
  the `test_links` collector from a SHA-pinned checkout of the
  `svenroth-ai/shipwright` monorepo (not vendored — ~850 lines across four
  files this repo does not own), regenerates the manifest from the current
  commit, normalizes out execution-evidence fields (`status`/`executed`) and
  `generated_at`, and diffs the result against the committed
  `.shipwright/compliance/test-traceability.json`. Non-zero exit + a
  human-readable diff summary on mismatch.
- `scripts/ci/tests/test_traceability_manifest_gate.py` (new) — unit tests
  for the diff/normalize logic (fixture manifests, no live collector import).
- `scripts/ci/tests/test_traceability_manifest_ci_job.py` (new) — structural
  test asserting the new job's trigger shape (`push`/`workflow_dispatch`
  only, weekly-schedule reverse-guard compatible) and pinned refs/SHAs.

## Component hierarchy

N/A (CI-only change, no UI).

## Data model changes

None. Reads the existing committed manifest; writes nothing.

## Test strategy

- Unit tests over `traceability_manifest_gate.py`'s normalize/diff functions
  using small fixture manifests (added/removed requirement, evidence-field-only
  diff treated as clean, `source_commit` diff treated as stale).
- Structural test over `ci.yml` parsing the new job's `if:` condition and
  pinned action refs (SHA format, not a mutable tag, for the third-party
  checkout and `astral-sh/setup-uv`).
- No E2E/browser surface — this is a CI workflow + a Python CLI gate, not a
  webui-observable feature. F0.5 surface = `none` with justification (see
  iterate spec / ADR).

## Acceptance criteria mapping

- "CI regenerates and diffs the manifest" → `traceability-manifest` job +
  `traceability_manifest_gate.py run()`.
- "A stale manifest fails the build" → non-zero exit on any non-normalized
  diff, verified by `test_traceability_manifest_gate.py`'s stale-fixture case.

## Risk notes

Touches `.github/workflows/ci.yml` (CI trust boundary) — checks out a
third-party repo (`svenroth-ai/shipwright`, SHA-pinned) and installs
`astral-sh/setup-uv` (also SHA-pinned), consistent with the repo's existing
asymmetric action-pinning posture (PR #290, DO-NOT #25). Operator ack
recorded at `ci_supplychain_ack.json` in this run's planning dir before this
mini-plan was authored (prior attempt escalated at Step 3.4; owner approved).

**REVISED after external review (2026-09-06):** the first draft of this
mini-plan and the gate itself compared the committed manifest's
`source_commit` to `HEAD` and treated a mismatch as staleness. External code
review (reject-severity) proved this unsatisfiable by construction — a
manifest can never embed the hash of the commit it will be committed inside
of — confirmed empirically against this repo's own commit history (see the
gate's module docstring). Fixed: `source_commit` is now informational
provenance only, like `generated_at`; staleness is decided purely by the
FR<->test topology fields. This also resolves the plan-review finding
("no path back to green") from the same root cause.

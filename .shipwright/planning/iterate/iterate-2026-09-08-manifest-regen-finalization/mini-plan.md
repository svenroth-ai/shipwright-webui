# Mini-plan: traceability manifest gate becomes advisory + auto-heal PR

## Chosen approach

Modify `.github/workflows/ci.yml`'s existing `traceability-manifest` job:

1. Give the existing "Regenerate + diff the traceability manifest" step
   `id: gate` and `continue-on-error: true`, and pass it a new
   `--write-fresh /tmp/fresh-test-traceability.json` flag.
2. Add `--write-fresh` to `scripts/ci/traceability_manifest_gate.py`: when
   given, write the freshly-built (already-validated) manifest to that path
   whenever the regen itself succeeds, independent of whether it matches the
   committed file.
3. Add a job-level `permissions: {contents: write, pull-requests: write}`
   (this job only — the workflow stays `contents: read` everywhere else).
4. Add a follow-up step `id: open-regen-pr`, `if: steps.gate.outcome ==
   'failure'`, authenticated with only `GH_TOKEN: secrets.GITHUB_TOKEN`, that:
   - no-ops gracefully if the fresh-regen file is missing (an infra failure,
     not real drift — nothing mechanical to fix);
   - otherwise copies the fresh regen over the committed manifest, commits it
     on a single reusable branch `bot/traceability-regen`, force-pushes it,
     and opens a PR via `gh pr create` unless one is already open (in which
     case the force-push alone refreshes it).
   - never attempts `gh pr merge`.

## Alternative considered and rejected

Literal option (a) — commit the regen from inside the finalizing iterate
branch. Rejected: `check_no_derived_snapshots_committed` (F11, ERROR
severity) hard-fails any iterate commit touching
`.shipwright/compliance/test-traceability.json`; this is not a style
preference to override but a collision/wrong-git-history safeguard with its
own measured incident history. See the ADR for the full trail, including why
literal option (b) ("commits it ... directly") and option (c) were also not
adopted as originally worded.

## Risk / blast radius

- Touches only one CI job in one workflow file, plus one first-party CI
  script's optional flag (additive, default `None`).
- New job-level write permissions are scoped to this ONE job; every other job
  in the workflow keeps the top-level read-only default.
- No new secret/credential. No change to branch protection / rulesets.
- Explicitly NOT full automation (no auto-merge) — documented limitation, not
  an oversight; the reasons are in the ADR and in the follow-up step's own
  comment in ci.yml.

## Test plan

Extend `scripts/ci/tests/`:
- `--write-fresh` behavior (match / stale / omitted) directly against
  `run()`.
- Workflow-shape assertions: exactly one `continue-on-error` step (the gate),
  exactly one conditional step (the follow-up) reading `outcome` not
  `conclusion`, exact job permissions, no merge attempt, token-only auth.
- The follow-up step's actual shell body executed against a real local git
  remote + a stubbed `gh`, covering: missing-fresh no-op, fresh PR open, and
  refresh-of-an-already-open PR.

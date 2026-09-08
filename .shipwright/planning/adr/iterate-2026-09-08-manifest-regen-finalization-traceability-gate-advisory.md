# ADR: Traceability manifest gate becomes advisory + CI-opened regen PR

- **Run ID:** iterate-2026-09-08-manifest-regen-finalization
- **Triage:** trg-1324dfc4 (supersedes trg-d54661e6)
- **Section:** CI / Compliance Gates — `.github/workflows/ci.yml` `traceability-manifest` job

## Problem statement

The "Traceability manifest (gate)" job (push-to-`main`-only) regenerates
`.shipwright/compliance/test-traceability.json` from the pinned
`shipwright-compliance` collector and hard-fails the build when it disagrees
with the committed file. Between 2026-08 and 2026-09-08 this produced **seven**
one-commit "regenerate stale traceability manifest" repair PRs
(#436, #438, #441, #443, #444, #446, plus 2c4ba5c0) across eight failures,
the last two (#442, #447) landing from ordinary feature work, not campaign
work. Each red state blocked every other iterate from starting
(`main_health.py` reads it as `red`, and B1b of the iterate skill refuses to
proceed until it is repaired). The gate's own trigger fires on
`untagged_tests` moving — which happens on nearly any PR that adds a test —
so it had stopped catching genuine defects and started manufacturing traffic.

The card asked for a decision between three options, "with evidence rather
than taste", and to record anything that forbids the apparently-obvious one.

## Options considered

### (a) Finalization regenerates and stages the manifest whenever the diff touches tests/spec.md — REJECTED, forbidden

`.shipwright/compliance/test-traceability.json` is one of the twelve paths in
`shared/scripts/lib/derived_snapshots.py`'s `DERIVED_SNAPSHOTS`
(iterate-2026-07-27-derived-snapshots-off-branch), and F11's
`check_no_derived_snapshots_committed` is a **hard ERROR gate** on any iterate
commit that touches it. The reasons that decision gives are not stylistic —
they're measured: a branch-local regen reads the branch's own git history
(pre-squash SHAs, no visibility into concurrently-merging branches), and on
2026-07-27 `main`'s own committed `change-history.md` (a sibling derived
file) over-counted commits by 11 and cited a SHA `git merge-base
--is-ancestor` proved was never on `main`. Worse, N parallel iterate branches
each regenerating and committing this exact file would collide N(N-1)/2
times on a file carrying none of their actual changes. Option (a) is
literally the thing this prior decision exists to prevent; adopting it would
require reversing iterate-2026-07-27-derived-snapshots-off-branch, which this
iterate has no standing to do unilaterally and no new evidence to justify
reversing (the collision/wrong-history argument is untouched by anything
found here).

### (c) Stop committing the manifest; derive it in CI only — REJECTED, disproportionate

Checked first, as the card asked: this repo's own WebUI server reads the
committed file directly from a project's working tree, not from any CI
artifact — `server/src/core/mission-context/{traceability,pointer,
worktree-roots}.ts` plus their tests, the compliance dashboard, and the
IntentWizard grade badges. Eliminating the committed artifact would require
either vendoring the ~850-line, four-file `test_links` collector into this
repo (the exact vendor-with-hash-drift-guard cost `traceability_manifest_gate.py`'s
own docstring already rejects as disproportionate "for a script this repo
does not own or fork") or having every consuming project run the collector
on demand — a materially larger project than fixing a CI gate. Rejected as
out of proportion to the defect.

### (b) CI regenerates and commits it on merge; the gate becomes advisory — ADOPTED, in a corrected form

The literal framing ("CI ... commits it ... directly") does not fit this
repo's constraints and was corrected rather than assumed:

- `main-protection` ruleset requires a PR for every change to `main`
  (0 approvals required, but PR-required, `non_fast_forward`) — a direct
  `git push` to `main` from CI is not possible regardless of token scope.
- A PR opened by a workflow using the default `GITHUB_TOKEN` does not trigger
  this repo's other `pull_request`-gated workflows (Client/Server tests, PR
  Review, Security Scan, Diff coverage, E2E smoke, Visual regression,
  Accepted-risk register — all in `required_status_checks`) — GitHub's
  documented anti-recursion behaviour. Such a PR could never clear the
  required checks to auto-merge without a separate PAT/App credential, which
  is a new, security-sensitive addition this iterate does not have standing
  to provision (main-repair.md's own caution against adding unattended
  main-push automation "before this procedure has proven itself" applies
  here directly, and no such credential exists in this repo today — verified
  by grepping every workflow for `secrets.` and finding none but the default
  token and one unrelated API key).

So "commits it" becomes "opens a ready-to-merge PR" and "becomes advisory"
becomes "the regen step's own failure no longer fails the job" — both
implemented, neither requiring new credentials or ruleset changes:

1. The `Regenerate + diff` step gets `continue-on-error: true` (`id: gate`).
   `main_health.py`/GitHub's job-conclusion API will read this job as green
   even when drift is found — this job no longer blocks other iterates. The
   failure is not silent: GitHub renders a `continue-on-error` failure with
   its own visible warning marker in the Actions UI, and the step's own JSON
   output (unchanged) still names the exact drift.
2. A second job (`traceability-manifest-regen-pr`, `needs:` the first),
   gated on `needs.traceability-manifest.outputs.gate_outcome == 'failure'`
   (the RAW pre-swallow result), regenerates nothing a second time — it
   downloads the artifact the gate job already uploaded from its
   `--write-fresh` output — and pushes it to a single reusable branch
   `bot/traceability-regen`, opening (or refreshing) a PR. It explicitly does
   not attempt `gh pr merge`. This is a SEPARATE job from the gate step, not
   a follow-up step in the same job — see "Doubt review" below for why.

**Precedent for "advisory" specifically:** the monorepo's own
`shared/scripts/tools/ci_manifest_drift_check.py` (iterate-2026-08-26-r1b)
already treats structural drift in the identical FR<->test manifest as
"real drift, reported, never a reason by itself to fail the build" — for a
different regen source (real JUnit evidence vs. this repo's bare
`enumerate_untagged=True` regen), but the identical severity question. This
adopts the same posture rather than inventing a second one for the same
problem class.

## Consequences

- Main no longer goes "red" (in the `main_health.py` / iterate-blocking
  sense) for this class. No further "regenerate stale traceability manifest"
  repair PRs should be needed as a human/agent-noticed, hand-authored
  correction — the fix is auto-prepared the moment drift is next detected.
- The auto-opened PR still needs a human or the next iterate's
  `main-repair` procedure to nudge (e.g. an empty commit to re-trigger the
  now-required checks) and merge — this is NOT full unattended automation,
  by deliberate choice (see rejected credential path above). Document this
  limitation plainly rather than imply full automation.
- The committed manifest can now be stale for longer than before any given
  merge lands the auto-PR — accepted, because the fields that actually move
  on ordinary PRs (`untagged_tests` counts) are bookkeeping quality, not a
  safety or compliance-correctness signal on their own; a genuinely wrong
  `spec_hash`/orphan/invalid-tag would still show up (still computed, still
  reported, still opens a fix PR) — it just no longer stops the world.
- If a maintainer closes the auto-opened `bot/traceability-regen` PR without
  merging (e.g. to handle the drift a different way), nothing remembers that
  decision: the next push that still shows drift force-pushes a fresh regen
  to the same branch name and `gh pr create` opens a new PR (a closed PR does
  not block a later one on the same branch). Given this class fires on
  nearly every PR that adds a test, a maintainer who closes it once should
  expect it to reappear on the next ordinary PR. Accepted as a low-stakes
  characteristic (worst case: an easily-re-closed, harmless PR) rather than
  built against — internal plan review (opus-plan-reviewer, 2026-09-08,
  low severity) raised this and confirmed it is not a functional defect.

## Doubt review (Stage 3, disprove-biased) — three findings, all fixed

The adversarial reviewer attacked concurrency/ordering, boundary/contract,
reversibility and hidden-coupling. Three doubts survived; all three were
fixed rather than argued around, since each had a real, low-cost mechanical
fix:

1. **Medium — TOCTOU on the push, not just the stale-run check.** The
   `git ls-remote` guard and the eventual `git push` are separated by several
   shell lines (auth, checkout, commit); the top-level
   `concurrency: cancel-in-progress` only cancels the WORKFLOW and a run
   already past the check can still finish, so two individually-valid checks
   could still race on which push lands last. **Fixed**: the regen-PR job now
   carries its own job-scoped `concurrency: {group: traceability-regen-pr,
   cancel-in-progress: false}`, so a second run's job cannot even START until
   the first one's finishes — the race is closed, not narrowed.
2. **Medium — write permissions alongside a pinned third-party checkout in
   the same job.** `contents: write` + `pull-requests: write` were live in
   the same job that checks out and imports code from the pinned
   `shipwright-compliance` plugin — anything reachable from that import graph
   could poison `$GITHUB_ENV`/`$GITHUB_PATH` for the later `gh auth
   setup-git`/`git push` steps in the same job ("poisoned pipeline
   execution"). **Fixed**: split into two jobs. `traceability-manifest`
   stays read-only (no `permissions:` override) and checks out the pinned
   plugin; `traceability-manifest-regen-pr` holds the write scopes and never
   checks out any third-party repository — it only downloads the artifact
   the first job already computed. Guarded by
   `test_the_job_never_checks_out_the_pinned_third_party_plugin`.
3. **Low — bare `git push --force` could silently discard a human's manual
   commit** to the bot-owned branch (e.g. a hand-authored fix pushed instead
   of just merging). **Fixed**: switched to
   `git push --force-with-lease=<ref>:<expect>` against a freshly re-read
   remote SHA (falling through to a plain push only on the branch's first
   creation), and the auto-opened PR body now states plainly that the branch
   is bot-owned and any manual commit there will be overwritten on the next
   drift cycle.

None of the three were argued away with a rebuttal — each is now covered by
a shape test (`test_traceability_manifest_regen_pr_ci_job.py`) or a
real-shell-execution test (`test_traceability_regen_pr_shell.py`).

## Schema version — checked per the card's request

The committed manifest at this run's base (`c452b8f9`, origin/main HEAD) is
already `schema_version: 4` (bumped by #446, "schema v4 pin bump", merged
before this card was last amended). The card's own text ("this repo's
manifest is still schema_version 3") is stale as of that PR — noted here so
it does not silently ride along as if still true. This iterate's changes
make no further schema change.

## Portability to the monorepo

**Partially portable, not adopted wholesale here.** The ADVISORY-severity
half is directly portable and arguably already adopted in spirit —
`ci_manifest_drift_check.py` already treats the identical failure class as
non-blocking. The CI-opens-a-regen-PR half is NOT recommended for the
monorepo as-is: the card's own portability note says the monorepo's manifest
"is known not to be fully reproducible (some fields vary per run)" — an
auto-PR built from a non-reproducible regen would churn a fresh, low-signal
diff on every run even with no real requirement/test change, which is
strictly worse than the current state there. That reproducibility gap is a
prerequisite, separate piece of work (not attempted in this iterate — this
iterate has no standing to fix a different repo's collector) and should be
filed as its own card before porting the auto-PR mechanism, not silently
assumed solved.

## Rejected alternatives (summary)

(a) forbidden by `check_no_derived_snapshots_committed`
(iterate-2026-07-27-derived-snapshots-off-branch); (c) disproportionate given
this repo's own live consumers of the committed file. See "Options
considered" above for the full evidence trail.

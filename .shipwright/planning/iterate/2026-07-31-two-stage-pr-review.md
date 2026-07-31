# Iterate: split the Tier-3 PR review into two stages

- **Run ID:** iterate-2026-07-31-two-stage-pr-review
- **Intent:** CHANGE (port an upstream CI shape; enforcement only)
- **Complexity:** medium · risk flag `touches_ci_supplychain`
- **Spec Impact:** NONE — no product behaviour, endpoint, schema or UI changes.
  CI-only; nothing the Command Center renders or serves moves.
- **Origin:** the monorepo reworked the same gate in
  [shipwright#437](https://github.com/svenroth-ai/shipwright/pull/437)
  (`iterate-2026-07-27-review-gate-failclosed-fork`). WebUI still runs the
  older single-stage shape that PR replaced.

## Problem

`PR Review` is one of the ten contexts the `main-protection` ruleset requires.
Today it is a **job name** in a single workflow, and that is the defect: GitHub
scores a **skipped** job as a **successful** required check. Two of the three
holes #437 closed are live here.

**Hole A — a fork PR is never reviewed, and passes.** `decide` carries
`if: github.event.pull_request.head.repo.full_name == github.repository`,
because GitHub withholds secrets from a fork-raised `pull_request` run. On a
fork PR `decide` is skipped, `review` is skipped through `needs:`, and the
required `PR Review` context goes **green having reviewed nothing** — while
every other check still ran and still blocked. The workflow's own header
documents this as a "fork limitation … handled manually"; a required check
that reports success is not handled manually, it is handled by nobody.

**Hole B — the gate can waive itself.** In `decide`, the `skip-pr-review` label
is evaluated **first**, before the sensitive-path rule. A PR editing
`.github/workflows/`, `scripts/ci/` or `scripts/hooks/` — the checks
themselves — can therefore be waived by the same label. FR-01.17 (E)7:
whoever unlocks a door is not the one who decides it may be unlocked.

**Hole C — oversize diff skips the review — is already CLOSED here.** Verified
rather than assumed: `pr_review_lib.truncate_diff` caps at 200 000 chars and
`pr_review.py` sets `effective_decision = "block" if truncated`, returning
`EXIT_BLOCK` (1) with a banner on the comment. There is no `|| true` in the
workflow either. Nothing to do for this one; it is pinned by the ported tests
so it cannot regress.

Underneath all three sits the structural point. As long as the required
context is produced by a **job that can be skipped**, silence reads as
success. The fix is to move the context onto a **commit status** posted by a
stage that the contributor cannot influence: if it never posts, the context is
absent, and an absent required context is `pending`, which blocks.

## Acceptance Criteria

- **AC-1** Stage 1 (`pr-review.yml`) runs on **every** pull request including
  one raised from a fork, references **no secret**, and carries **no policy**
  (no tier rule, no waiver rule, no fork guard).
- **AC-2** Stage 2 (`pr-review-run.yml`) is the **sole** producer of the
  `PR Review` context, posted as a **commit status**. No job in stage 1 is
  named `PR Review`, and stage 2 REFUSES to post at all if any check run is
  already claiming that name — since stage 1 runs from the PR head, a
  contributor can mint one, so sole-producer has to be enforced rather than
  merely intended. (Residual, recorded: a decoy check run created *after* that
  lookup is not caught; closing it fully needs a context name stage 1 cannot
  mint, which is a ruleset change and the operator's call.)
- **AC-3** Stage 2 derives **both** the tier (labels, author, changed paths)
  and the reviewed diff from the **API**, never from stage 1's artifact, and
  never checks out the PR head.
- **AC-4** `skip-pr-review` cannot waive review of a change that edits the
  checks themselves (the sensitive-path set).
- **AC-5** Ambiguity and movement fail closed: exactly one open PR whose head
  is the trusted event SHA, or refuse; and before blessing, verify **both**
  that the head still is that SHA **and** that the branch was not force-pushed
  at all since stage 1 began — so no mid-run force-push, including one that is
  reverted before the check (`A → B → A`), can leave a commit holding a green
  it did not earn.
- **AC-6** `Reviewer Selftest` remains a stage-1 job under its exact existing
  name — it is a required context and must keep reporting on every PR.
- **AC-7** The `check_required_checks` producer is run against this repo and
  its findings reported; the port must clear the `PR Review` **phantom** it
  currently reports.

## Mini-plan (and the alternatives that were rejected)

**Chosen — two workflows, context on a commit status.** Stage 1 keeps the
`pull_request` trigger and the offline `Reviewer Selftest`, adds a `prepare`
job that records the diff as an audit artifact, and loses `decide` + `review`.
Stage 2 fires on `workflow_run` (so it runs default-branch code with base-repo
credentials), resolves the PR from the trusted event, applies the tier rules
against API data, runs the vendored reviewer, and posts `PR Review`.

**Rejected 1 — `pull_request_target`.** It would give the credentialed run
access to secrets on a fork PR in one workflow instead of two. It is also the
classic pwn-request footgun: the trigger runs base-branch workflow code but is
routinely paired with a checkout of the PR head, and one careless `ref:` later
the contributor's code executes **with** the secrets. The two-stage split gets
the same capability with the untrusted half structurally unable to hold a key.

**Rejected 2 — keep one workflow and drop the fork guard.** GitHub does not
hand secrets to a fork-raised `pull_request` run at all, so the review would
fail rather than skip — trading a false green for a permanent red on every
fork PR. It also leaves the context on a job, so any future `if:` re-opens the
skip-means-pass hole.

**Rejected 3 (webui-specific) — move `Reviewer Selftest` into stage 2.** It
looks tidy (one workflow per trigger) and is wrong twice: the selftest is
offline and credential-free, so it belongs on the untrusted side by the same
least-privilege logic that put the reviewer on the trusted one; and it is a
**required context**, so relocating it to a `workflow_run` workflow would make
it a check the branch-protection matcher resolves differently. It stays put.

## Implementation

### Stage 1 — `pr-review.yml`, renamed `PR Review Prepare`

Two jobs. `selftest` is unchanged apart from its surrounding comments
(`pip install pytest pyyaml`, `python -m pytest scripts/ci/tests -q`).
`prepare` writes `pr-review-request/{pr.diff,meta.json}` and uploads it with
`actions/upload-artifact@v4`, retention 3 days.

Trigger types are `[opened, synchronize, reopened, labeled, unlabeled]`.
`unlabeled` is **added** here and is not in the upstream shape: without it,
*removing* `skip-pr-review` fires no event, so a waiver granted once could
never be revoked — the green status earned under the label would simply stay.
Adding a label re-decides; removing one has to as well.

Nothing this stage produces is trusted. `pull_request` runs the workflow file
**from the PR head**, so a contributor controls this file and everything it
emits. The artifact is an **audit record** of what stage 1 saw — evidence, not
input.

### Stage 2 — `pr-review-run.yml`, `PR Review Run`

`on: workflow_run: workflows: ["PR Review Prepare"], types: [completed]`.
Top-level `permissions: contents: read`; only the single job widens, to
`statuses: write` (the context) and `pull-requests: write` (the comment
carrying the reasons). Four steps:

1. **Resolve the PR** from `github.event.workflow_run.head_sha` by listing the
   base repo's **open pull requests** (`pulls?state=open`) and matching head
   SHA, requiring **exactly one**. Upstream asks `commits/{sha}/pulls`; that
   endpoint returns an **empty list for a fork PR**, which would have left
   every fork PR unresolvable and permanently red without ever being reviewed
   (probe 8). `workflow_run.pull_requests` is empty for fork PRs too, so it is
   not used either. Read with `--paginate --slurp` (pages flattened by
   `.[][]`): a match beyond page 1 must not read as absent, and a second match
   beyond it must not collapse a *two*-match ambiguity into an apparent unique
   one — the case the check exists to refuse.
2. **Decide the tier** from `repos/{repo}/pulls/{n}` (author, labels) and
   `…/files` (changed paths). Sensitive paths are everything that changes what
   CI enforces *or what it may stay quiet about*: `.github/workflows/`,
   `.github/actions/`, `scripts/ci/`, `scripts/hooks/`,
   `scripts/install-hooks.*`, `.trivyignore.yaml`,
   `shipwright_accepted_risks.yaml`, `.semgrepignore`, `.claude/settings.json`
   and `shipwright_bloat_baseline.json`. Matched with a **here-string**, not
   `printf | grep -q` (finding 16), and an at-cap file list counts as sensitive.
3. **Run the reviewer** — `python scripts/ci/pr_review.py --pr-number … --repo
   … --prompt-dir scripts/ci/pr_reviewer`, gated on stage 1 having succeeded
   **and** the tier requiring a review.
4. **Post the verdict** under `if: ${{ !cancelled() }}` — *not* `always()`,
   which would let a superseded run overwrite the live one (finding 15) — after
   re-reading the PR's head **and** the branch's force-push history, failing
   closed on either.

`.github/actions/` is in the sensitive set although the directory does not
exist yet. Creating a composite action requires a workflow edit (caught), but
*editing an existing one later* would not — the rule is a line of regex and
closes that latent gap before it opens. The suppression channels are there for
the same reason with less hypothesis attached: they exist today, and a
`skip-pr-review` label must not waive a PR that adds a Trivy suppression.

### Why this stage uses `setup-python`, not `uv`

The monorepo's stage 2 installs `astral-sh/setup-uv` because its reviewer is
invoked through `uv run`. The vendored copy here imports only the standard
library (`urllib`, `subprocess`, `json`) and shells out to `gh`, which is
preinstalled on the runner. `actions/setup-python@v5` is enough, and it keeps
this workflow free of any third-party action — the posture DO-NOT #25 records
(GitHub-owned actions on mutable tags, third-party SHA-pinned) needs no new
pin because no third-party action is introduced.

## Tests

Ported from the monorepo, re-pointed at this repo's paths:

- `scripts/ci/tests/_pr_review_workflows.py` — shared readers. **Assertions
  read parsed structure**, never raw text: these workflows document the holes
  they close, so a text match hits the explanatory comment and reports a
  defect that is not there. Two upstream tests false-failed exactly that way.
- `scripts/ci/tests/test_pr_review_fail_closed.py` — the gate cannot be
  bypassed by size, crash or waiver.
- `scripts/ci/tests/test_pr_review_fork_trust.py` — a credentialed stage 2
  trusts nothing the contributor controls.
- `scripts/ci/tests/test_pr_review_workflow_shape.py` — **rewritten**. Its
  current assertions pin the *old* shape (fork guard present, `needs: decide`,
  a job named `PR Review`) and invert under the new one.
- `scripts/ci/tests/test_workflow_token_permissions.py` — extended to cover
  `pr-review-run.yml` (read-only top level, `statuses: write` at job level).

## Merging this one

**This PR needs a one-time manual admin merge.** A `workflow_run` workflow
only fires from the default branch, so stage 2 does not exist for the PR that
introduces it and nothing posts `PR Review` here. The context will sit
`pending` — which is the mechanism working as designed, on the one PR where it
is inconvenient. Every subsequent PR is covered normally. The `main-protection`
ruleset grants admin `bypass_mode: always`.

Also note this PR itself edits `.github/workflows/` and `scripts/ci/`, i.e. it
is Tier 3 by its own rules, and under the new rules `skip-pr-review` would
**not** waive it (AC-4). That is the intended outcome: it needs maintainer
sign-off, which the manual merge is.

## External-Plan-Review-Findings

Two independent reviewers (openrouter: gemini + openai), both `revise`. Four
findings accepted, four rejected — two of those refuted by probe rather than
by argument.

**Accepted.**

1. *(openai, high)* **Paginate the associated-PR lookup.** Real: page-1-only
   reading can turn a two-PR ambiguity into a false unique match. `--paginate
   --slurp`. Upstream should take this back.
2. *(openai, medium — generalised)* **A waiver must be revocable.** The
   concrete gap is narrower than the finding: `unlabeled` is missing from the
   trigger types, so removing `skip-pr-review` re-decides nothing. Added.
3. *(openai, high)* **`persist-credentials: false`** on stage 2's checkout.
   The reviewer's *premise* is wrong (below), but the hardening stands on its
   own: this job holds `OPENROUTER_API_KEY` and a writable token, and nothing
   in it uses the git credential helper — `gh` authenticates from `GH_TOKEN`.
4. *(gemini, medium)* **`GH_TOKEN` on every `gh`-using step**, not just the
   reviewer step. Already the upstream shape; kept as an explicit checklist
   item because three separate steps shell out to `gh`.

**Rejected — refuted by probe.**

5. *(gemini high + openai high)* **"A commit status cannot satisfy the
   existing required context; the ruleset must be re-pointed."** Both
   reviewers argued branch protection binds `PR Review` to a Check Run and
   would wait forever on a Status. Probed instead of argued: the monorepo has
   already made this exact switch. On `shipwright#503`,
   `commits/<sha>/check-runs` contains **zero** runs named `PR Review`,
   `commits/<sha>/status` carries `PR Review = success` as a **commit
   status**, and the PR **merged** — under a ruleset whose entry is
   `{"context":"PR Review","integration_id":15368}`, the same app-bound shape
   this repo has. A status posted with `GITHUB_TOKEN` is attributed to the
   Actions app, so it matches. **No ruleset change is needed**, and the
   deployment step both reviewers asked for would have been a no-op edit to
   production branch protection.
6. *(openai, high)* **"Default checkout on `workflow_run` may resolve to the
   PR head."** False: for `workflow_run`, GitHub sets `GITHUB_REF`/`GITHUB_SHA`
   to the **default branch** of the base repository, which is why upstream
   passes no `ref:` at all. Pinned in both directions by
   `test_stage2_never_checks_out_contributor_code`, which fails on any `ref:`
   derived from the PR.

**Rejected — on the merits.**

7. *(gemini, medium)* **"Gate the stage-2 job on
   `workflow_run.conclusion == 'success'`."** This trades a diagnosis for a
   silence. Both variants block (a skipped job posts nothing, and an absent
   required context is `pending`), but the shipped shape posts an explicit
   `failure` reading *"stage 1 failed — nothing was reviewed"*, so the human
   sees **why** the PR is stuck instead of finding a context that never
   arrives. Step-level gating plus `if: always()` on the post step is the
   deliberate choice, not an oversight.
8. *(gemini low + openai medium)* **"Drop `prepare` and the artifact — stage 2
   does not read it."** Not reading it is the point: it is an audit record,
   and it is *not* duplicated by the API. The API serves the diff at the
   PR's **current** head; the artifact preserves what was proposed **at that
   SHA**, which is precisely what survives a force-push. Dropping it would
   also break the ported `test_stage1_records_the_change_for_audit` and
   diverge the vendored suite from its canonical source on the first port.
   The availability coupling openai identifies is real and **accepted**: an
   artifact-upload flake reds the whole of stage 1 and therefore posts
   `PR Review = failure`. That is the correct direction — a re-run clears it —
   and the coupling is load-bearing regardless, because `Reviewer Selftest`
   lives in the same workflow and its failure *must* reach the verdict.

### Round 2 — re-review of the revised plan

Both reviewers `revise` again. Two of the four medium findings were about
things already in the workflow that the plan excerpt did not show; the rest
split into one real residual risk and two rejections.

**Accepted.**

9. *(openai, medium ×2)* **Pin `persist-credentials: false` and the stage-2
   concurrency group with tests.** Both were already implemented — the excerpt
   fed to the reviewer showed neither — but the observation that neither was
   *guarded* was right, and the concurrency group is the only thing standing
   between an older stage-2 run and a newer verdict for the same SHA. Added
   `test_stage2_checkout_does_not_persist_credentials` and
   `test_stage2_serialises_runs_for_one_head`.

**Accepted as a documented residual risk, not fixed.**

10. *(openai, high)* **A waiver revoked leaves a stale green for one CI cycle.**
    Real. `unlabeled` re-runs the gate, but the previous
    `PR Review = success` sits on the SHA until stage 2 replaces it — a window
    of a minute or two in which an armed auto-merge could still fire. The
    proposed fix is a trusted `pull_request` handler that posts `pending` on
    label change, and that is **worse than the disease**: it would put
    `statuses: write` on a fork-reachable trigger, handing the untrusted side
    the one capability this whole change exists to keep away from it. Note the
    direction of travel — upstream has no `unlabeled` trigger at all, so there
    the stale green is **permanent**; here it is bounded by one CI cycle. The
    residual window is accepted, and the person who can open it is the
    maintainer who owns the waiver.

**Rejected — on the merits.**

11. *(gemini, high)* **"Missing `edited` trigger creates a base-branch
    bypass."** Traced rather than assumed, and it does not: `branches: [main]`
    means a PR targeting anything else never ran stage 1, so it has **no green
    status to inherit**. Re-pointing it at `main` fires `edited`, which nothing
    listens to, so the required context stays absent — and absent blocks. The
    failure mode is "needs one more push before the review starts", not "merges
    unreviewed". Adding `edited` would re-run the reviewer on every title and
    body edit to buy that convenience. Recorded as a comment in the trigger
    block so its absence does not read as an oversight.
12. *(gemini, medium)* **"Short-circuit stage 2 when the SHA already has a
    green `PR Review`."** The concern is fair — any label event re-runs the
    reviewer on an unchanged SHA — but the proposed remedy **re-opens the hole
    this change closes**: re-emitting a previous `success` without re-deciding
    is exactly how a waived PR keeps a green after the waiver is revoked, and
    it would make finding 10 permanent instead of momentary. The waste is also
    smaller than it looks: Tier 1/2 PRs never call the model at all
    (`needs_review=false`), so only external-contributor and sensitive-path PRs
    pay, and label churn on those is rare. Accepted cost, deliberately.

## External-Code-Review-Findings

Round 3, `external_review.py --mode code` over the diff. One reviewer returned
`unavailable` on both attempts (degraded, recorded); the other returned
`revise` with two findings, the first of which is the sharpest thing any
reviewer said in three rounds and **found a real hole in AC-5 as I had built
it**.

13. *(openai, high — FIXED)* **`A → B → A` defeats a head-equality check.** The
    reviewer fetches the diff by PR **number**, which tracks the moving head,
    while the verdict lands on the immutable event SHA. Re-reading the head
    before blessing catches a force-push that *stays* moved — but a
    contributor who pushes malicious `A`, force-pushes benign `B` while the
    model is running, then restores `A` before the check, gets `A` blessed on a
    review of `B`. Head equality holds at every point we looked. **Upstream has
    this hole too** — its comment reasons only about the head having moved, not
    about what the reviewer was served in between.

    Fixed here rather than deferred, because AC-5 claims the property in so
    many words. Where the head *ended up* says nothing about the window, so
    stage 2 now also asks whether the branch was force-pushed **at all** since
    stage 1 began: `issues/{n}/timeline` filtered to `head_ref_force_pushed`
    events at or after `workflow_run.run_started_at` (ISO-8601 UTC compares
    lexicographically), folded into the existing head-moved branch so the
    number of status producers stays at two. A force-push from *before* the run
    is ignored — every previously-force-pushed PR carries one, and treating
    those as disqualifying would fail such a PR forever.

    Verified load-bearing rather than assumed: neutralising the new clause
    makes `test_verdict_fails_closed_on_an_a_b_a_force_push` fail (posts
    success, rc 0); restoring it returns the suite to green.

14. *(openai, medium — answered, and the reviewer was reading a diff)* **"The
    oversize and unparseable guards do not test the behaviour they claim."**
    Half right, and worth acting on. The two vendored *workflow-shape* tests
    genuinely only assert that no skip-and-succeed step exists — but the
    behaviours are covered, in files the diff did not contain and the reviewer
    could not see: `test_pr_review_script.py::test_truncation_fails_closed_needs_human`
    drives a real >200 000-char diff and asserts `EXIT_BLOCK` + a forced
    `block`, and `::test_json_parse_fail_exits_2_and_dumps_raw` covers
    unparseable output. Both vendored tests now carry a docstring naming where
    the behavioural coverage lives, so the weak assertion cannot be mistaken
    for the whole story.

## Internal-Review-Findings (three-stage cascade)

**Stage 1 — `spec-reviewer` (HARD-GATE): REJECT, then PASS.** AC-1..AC-6 were
verified line by line; AC-7's *reporting* half was cited as unbacked — the spec
forward-referenced a producer record into a `## Notes` placeholder that was
still empty. Fixed by actually running the producer twice and recording both
runs as the tables above. Also raised two non-blocking items, both fixed: two
docstrings still describing the removed `decide` job, and a `Reviewer Selftest`
regex (`^\s*name:`) that a *step* of that name would have satisfied while
reporting no check at all — now pinned to the four-space job indent.

**Stage 2 — `code-reviewer`: eleven findings, ten fixed.** The three mediums
were all real, and one was a bug I had introduced rather than inherited.

15. *(medium — FIXED)* **`always()` posts from a CANCELLED run, defeating the
    concurrency guard I had just added a test for.** `always()` is true even
    when the job is cancelled, so `cancel-in-progress` stopped a superseded run
    doing more *work* but not from *posting*: run A decides `skip-pr-review`,
    run B cancels A on the same SHA, and A's verdict step still posts `success`
    — landing after B's and overwriting it. `if: ${{ !cancelled() }}` keeps
    every diagnostic branch (a stage 1 that merely *failed* does not cancel
    this job) while making the superseded run silent, and silent means absent
    means blocked. The test that asserted the concurrency group existed did
    not exercise the interaction; there is now one that reads the `if:`.
16. *(medium — FIXED)* **Two independent fail-open paths in the sensitive-path
    rule**, in the one direction a gate must never fail. (a) `printf | grep -q`:
    `grep -q` exits at the first match, the writer then takes SIGPIPE, and
    under `pipefail` the *pipeline* reports non-zero **although grep matched** —
    so a >64 KiB file list with an early match took the `else` branch and a
    workflow edit classified as Tier 1/2. Replaced with a here-string, which
    has no writer to kill. (b) `pulls/{n}/files` caps at **3000** entries
    however it is paginated, so a sensitive path beyond the cap is invisible; an
    at-cap list is now treated as sensitive, because "none in the part we were
    shown" is not "none". Both are covered by executed tests (2001 paths, and a
    3000-path list).
17. *(medium — FIXED)* **The reviewer advertised an override this change
    disabled.** `pr_review.py` told the operator to apply `skip-pr-review`
    after a manual look at a truncated diff — but the new tier step ignores
    that label on a sensitive path, and an oversize diff is very often exactly
    that. The maintainer would have followed printed advice into a `::notice::`
    in a log nobody opens and a still-red gate. Message and comment corrected.
18. *(low — FIXED)* **The `gh` stub was flag-blind**, so the behaviour suite
    could not catch the thing it exists to catch: dropping `--slurp` (real `gh`
    emits a flat array `.[][]` cannot walk) or `--jq` (real `gh` emits JSON
    objects the path grep never matches → fail open) left every test passing.
    The stub now asserts its own contract, and `test_harness_rejects_a_dropped_flag`
    proves it by running the resolve body with `--slurp` removed.
19. *(low — FIXED)* `now=$(… || echo "")` conflated "could not read the head"
    with "the head moved", sending a maintainer hunting a force-push that never
    happened. Three distinct descriptions now, all still failing closed, with a
    `GH_FAIL` arm in the stub so the error branches are executed.
20. *(low — FIXED)* `echo "number=$(…)"` — a command substitution used as an
    *argument* does not trip `set -e`, so a jq failure would have written
    `number=` and exited 0. Unreachable today, but this is the step whose whole
    job is to fail closed. Assigned first, then echoed.
21. *(low — FIXED)* `decide()` wrote `reason` with a bare `echo`. No injection
    today (every call site passes a literal), but it is the sole writer of the
    gate's decision, and one future edit passing an API-derived value would let
    an embedded newline append its own `needs_review=false`. Heredoc form now.
22. *(low — FIXED)* **The sensitive-path set omitted the suppression
    channels.** I had added `.github/actions/` pre-emptively on the argument
    that editing an existing composite action later would go uncaught; the same
    argument applies with more force to channels that already exist. A
    `skip-pr-review` label could waive a PR adding a Trivy suppression. Added
    `.trivyignore.yaml`, `shipwright_accepted_risks.yaml`, `.semgrepignore`,
    `.claude/settings.json`, `scripts/install-hooks.*` and
    `shipwright_bloat_baseline.json` — DO-NOT #25 names the first two as a pair
    that must agree, so either half is a policy edit.
23. *(low — FIXED)* `pr_review.py` had grown to 299 with one line of headroom
    and no bloat-baseline entry. Back to **299** after tightening the prose it
    only opened for a docstring correction.
24. *(low — accepted, filed upstream)* **Four vendored guards cannot fail** —
    a re-asserted expression, an absent literal no version ever contained, a
    raw-text read that a deleted-guard-but-kept-comment edit would pass, and a
    tautological `or`. Deliberately **not** repaired here: they are vendored
    byte-identical to shipwright#437, and a vendored file that silently
    diverges is worse than a weak one. `_pr_review_workflows.py` now names all
    four so a reader does not mistake them for the gate; the real coverage is
    behavioural.
25. *(low — done at F4)* No changelog drop. Filed.

**A defect the fixes themselves surfaced.** Moving `reason` to the heredoc form
turned 23 tests red: the harness's `$GITHUB_OUTPUT` parser only understood
`k=v`, so it reported `reason` as *absent* and the tests read as "the step
stopped emitting it". The parser now models both forms, as the runner does — a
reminder that a harness which simplifies the format it is standing in for will
eventually lie about the thing it is testing.

**Stage 3 — `doubt-reviewer`: 15 doubts, and one of them changed the design.**
Tasked to disprove the central claim rather than confirm it.

26. *(high — FIXED, and this is the one that matters)* **`commits/{sha}/pulls`
    returns EMPTY for a fork PR**, so the resolve step — the shape upstream
    ships — could never have resolved one. Every fork PR would have failed to
    resolve, exited 1, and posted `PR Review = failure`: **permanently red,
    never reviewed.** The change's entire motivation, inverted into an
    availability regression that no same-repo PR would ever have revealed.
    Probed rather than argued: three real fork PRs on `cli/cli` return `[]`
    from `commits/{sha}/pulls` and resolve correctly from
    `pulls?state=open` matched on head SHA. Switched, with a fork case in the
    executed suite. **This is a live bug in shipwright#437** and needs porting
    back.
27. *(high — MITIGATED, residual recorded)* **The required context can have a
    second producer.** Probe 1 only established that a commit status satisfies
    the app-bound context *when no check run of that name exists*; stage 1 runs
    from the PR head, so a contributor can add a workflow with a job named
    `PR Review` and mint one — and defeat the vendored guard against it in the
    same diff, since that guard runs from their head too. Stage 2 now refuses
    outright when any check run claims the name (`checks: read`). **Residual:**
    a decoy whose check run is created *after* stage 2's lookup is not caught;
    fully closing it needs a context name stage 1 cannot mint plus a ruleset
    edit, which is an operator decision. The claim in AC-2 is scoped
    accordingly rather than left absolute.
28. *(medium — FIXED)* **`cancel-in-progress` cancels only OVERLAPPING runs.**
    A superseded stage-2 run whose `workflow_run` event arrives after its
    successor already finished is never cancelled, so `!cancelled()` does not
    silence it and it posts `failure` over the live `success` — a spurious
    permanent red. A cancelled stage 1 now posts nothing at all. (The reviewer
    checked the dangerous direction and it was already closed: a later run
    re-derives tier inputs from the API, so it always reflects current policy.)
29. *(medium — FIXED)* **The classifier was rename-blind.** `pulls/{n}/files`
    emits one entry per rename with the NEW path in `filename`, so moving
    `scripts/hooks/pre-commit` to `tools/pre-commit` took the executed hook out
    of the guarded directory invisibly. Now reads `previous_filename` too.
30. *(medium — FIXED)* **`[ "$forced" -ne 0 ]` failed OPEN**, in the step whose
    job is to fail closed — `[ "" -ne 0 ]` exits 2, which inside `A || B` reads
    as FALSE and blesses the commit. Reported as latent; it is **reachable**:
    `jq` on empty input exits 0 printing nothing (verified). String comparison
    now, with a regression test.
31. *(medium — FIXED)* **The tier was widened; the reviewer prompt was not.**
    Finding 22 routed six suppression channels to the reviewer, whose rules
    still named three paths and closed with "if the diff is trivially safe,
    approve plainly" — and a one-line Trivy suppression looks exactly that. The
    door was un-waivable and unlocked. Prompt now carries rule 4b, and
    `test_pr_review_sensitive_paths_sync.py` ratchets both directions
    (registry → prompt and prompt → registry).
32. *(medium — SCOPED)* **The exemption keys on the PR author, not the commit
    author**, so anyone with push access to a maintainer's branch inherits it.
    Nil exposure here (one maintainer, no other writers) but the claim was
    absolute; recorded in the workflow with the condition an adopter must meet.
33. *(low — FIXED)* An empty `run_started_at` would have made
    `created_at >= ""` true for every entry and reddened every force-pushed PR
    forever. Now `: "${RUN_STARTED_AT:?}"`, with a test.
34. *(low — FIXED)* **A phantom ledger citation.** Row 1 cited
    `shape::test_fork_guard_absent`, deleted when that module was trimmed. The
    behaviour was covered by its co-cited sibling, so this was a lying row
    rather than a hole — which is worse in an artefact the next reviewer trusts
    instead of re-deriving. `test_iterate_ledger_citations.py` now resolves
    every `module::test_name` in every iterate ledger; it found the phantom and
    a brace-shorthand citation that no checker could ever have resolved. Case
    counts corrected too (13→21, 8→7).
35. *(low — FIXED)* Three stale references to `test_pr_review_stage2_behaviour.py`,
    a module the split had already removed — including in CLAUDE.md rule 30,
    the normative index a maintainer reads first.
36. *(low — FIXED)* `.gitattributes` added to the sensitive set. A `* -diff`
    rule renders a change as "Binary files differ", so it controls what the
    reviewer can SEE. The reviewer flagged the media-type question as
    unresolved; the path is one alternation either way.
37. *(low — DOCUMENTED)* The two remaining shape guards in the verdict module
    now say so in their docstrings — `${{ success() || cancelled() }}` would
    satisfy the `if:` check and still post from a cancelled run.
38. *(low — DOCUMENTED)* The dependabot clause is inert here by DO-NOT #25 and
    unforgeable (`[`/`]` are illegal in usernames); noted rather than removed.
39. *(low — ACCEPTED RISK)* **Ambiguity fails closed onto the victim.** Anyone
    who can open a PR can mirror a commit (identical tree, parents, author and
    message reproduce the SHA) into their own branch, making two open PRs share
    a head SHA; stage 2 then refuses and the *legitimate* PR is blocked. This
    is the deliberate "ambiguity is indistinguishable from an attack"
    trade-off, but its cost lands on a third party, so it is recorded here
    rather than left implicit. Remedy: close the duplicate PR.
40. *(low — DOCUMENTED)* No `merge_group` trigger. A required context in a
    merge queue must be reported by a `merge_group`-triggered run, so enabling
    a queue would leave entries waiting until they time out. Fail-closed and
    irrelevant today (squash-PR-only, no queue), but this change is the moment
    it became load-bearing — an absent context is now the *designed* blocking
    mechanism, not an accident. Noted in stage 1's header.

**What the adversarial pass could NOT break**, reported because "no finding"
should mean "attacked and held": the `A → B → A` guard (four constructions
tried, all fail because a run whose `head_sha` is A cannot have *started* after
the A→B push); the artifact trust boundary; neutering stage 1 by deletion,
rename, gutted triggers or cancellation spam (every one is a self-DoS, since
the context simply stays absent); `--paginate --slurp` + `.[][]` on an empty
timeline; and `parse_outputs`' fidelity to the runner's `$GITHUB_OUTPUT` forms.

## Required-check findings (AC-7)

`check_required_checks.py --project-root . --json` against
`svenroth-ai/shipwright-webui@main`, run twice — once on `origin/main` and once
on this branch, because one of the findings is one this change fixes. Filed as
triage `trg-f8a1b359` (severity high, `source: required-checks`). The producer
reads the host's ruleset with the operator's own `gh` auth; the Actions token
cannot, which is why this is a producer and not a CI gate.

The must-pass set is 10 contexts, every one bound to `integration_id: 15368`
(the GitHub Actions app).

**Before this change** — 1 unenforced, 2 phantom:

| Direction | Context | Reading |
|---|---|---|
| unenforced | `Accepted-risk register (gate)` | **Real.** Landed 2026-07-29 (#332) and never added to the ruleset. It runs on every PR, reports, and holds nothing up. |
| phantom | `PR Review` | **Real, and this change fixes it.** Both `decide` and `review` carried a job-level `if:`, and the deriver files `if:`-gated jobs under `conditional` rather than `checks` — so the repo appeared to produce no `PR Review` at all. |
| phantom | `Diff coverage (gate)` | **False positive.** The job is real and reports on every PR; it carries `if: github.event_name == 'pull_request'` (ci.yml:64) only because the workflow ALSO runs on `push: [main]`, where a diff against `origin/main` is meaningless. |

**After this change** — 2 unenforced, 1 phantom:

| Direction | Context | Reading |
|---|---|---|
| unenforced | `Accepted-risk register (gate)` | Unchanged. Operator action. |
| unenforced | `Prepare review request` | **New, and benign by design.** Stage 1's audit job is not separately required because it does not need to be: it reports into stage 1's overall conclusion, and stage 2 posts `PR Review = failure` whenever that is not `success`. It is already gating — through the verdict, not on its own. |
| phantom | `Diff coverage (gate)` | Unchanged false positive. |
| — | `PR Review` | **Cleared.** `automerge_readiness.POSTED_STATUS_CONTEXTS` already maps `pr-review-run.yml → "PR Review"`, so the deriver now credits the posted status. |

**Not fixed here, deliberately.** Adding a context to the must-pass set is a
change to production branch protection that affects every future PR in the
repo, and it is the operator's call, not this iterate's — so it is reported,
not done. Two of the three findings need no code:

- **`Accepted-risk register (gate)` should be required.** One entry at
  Settings → Rules. It already runs and already fails correctly.
- **`Diff coverage (gate)` needs nothing.** Removing the `if:` to satisfy the
  producer would be the wrong repair — it is load-bearing for the `push` arm.
  The defect is in the producer: a job gated on
  `github.event_name == 'pull_request'` inside a workflow that also runs on
  `push` **always** reports on a pull request, so treating every `if:`-gated
  job as un-requireable is too blunt. That is a finding against
  `shared/scripts/lib/automerge_readiness.py`, filed upstream rather than
  worked around here.

## Confidence Calibration

- **Boundaries touched:** the CI trust boundary
  (`.github/workflows/pr-review.yml`, new `.github/workflows/pr-review-run.yml`)
  and the vendored guard suite under `scripts/ci/tests/`. No application code,
  no config parsing, no `.env`, no state file, no runtime write surface.

- **Empirical probes run:**
  1. **Does a commit status satisfy an app-bound required context?** Two
     reviewers said no. `gh api repos/svenroth-ai/shipwright/commits/<sha>/check-runs`
     for PR #503 returns **0** runs named `PR Review`;
     `…/commits/<sha>/status` carries `PR Review = success`; the PR is merged;
     the ruleset entry is `{"context":"PR Review","integration_id":15368}` —
     the same shape this repo has. **Refuted.** No ruleset change needed.
  2. **Does the port actually clear the phantom?** Producer run before and
     after: `PR Review` moves out of `phantom` and into `derived`. Table above.
  3. **Does the shell do what the YAML looks like it does?** Lifted every
     `run:` body out of stage 2 and executed it against a stubbed `gh` — 28
     behavioural cases. This is what covers pagination, waiver ordering and the
     verdict matrix; nothing else could.
  4. **Is the reviewer's oversize path really already closed?** Read the code
     rather than trusting the brief: `pr_review.py` sets
     `effective_decision = "block" if truncated` and returns `EXIT_BLOCK` (1)
     with a banner. Confirmed — hole C needed no work.
  5. **Is the new force-push guard load-bearing, or decoration?** Neutralised
     the `[ "$forced" -ne 0 ]` clause and re-ran: the `A -> B -> A` case posts
     `success` with rc 0. Restored it: green. The test fails for the reason it
     claims to.
  6. **Does that guard work against REAL GitHub, or only against my fixtures?**
     A guard that never fires is worse than none, and the whole thing rests on
     a timeline event name I had not seen. Ran the workflow's exact query
     against production: `head_ref_force_pushed` is confirmed on real PRs
     (shipwright#437, #380) — it appears in none of the webui PRs I sampled
     because none were force-pushed — and the literal filter, `--paginate
     --slurp` and `.[][]` included, returns **2** against a 2020 bound and
     **0** against a 2030 one. `workflow_run.run_started_at` is likewise a real
     field carrying an ISO-8601 UTC string, so the lexicographic comparison is
     sound. Had the event name been wrong, the guard would have failed **open**
     and silently.
  8. **Can stage 2 even find a fork PR?** The one probe I had not run, on the
     case the whole change exists for. `repos/cli/cli/commits/<fork head>/pulls`
     returns `[]` for three separate real fork PRs; `repos/cli/cli/pulls?state=open`
     matched on head SHA returns each of them. Upstream's endpoint would have
     left every fork PR unresolvable and permanently red **without ever being
     reviewed** — an availability regression no same-repo PR could have
     surfaced. Switched, and reported back upstream.
  9. **Two defects the probes found**, both of which a shape-only test suite
     would have shipped: the inherited `uses:\s*(\S+)` pin-check matched the
     substring inside `stat`+`uses: write` and reported a permission scope as
     an unpinned third-party action (latent until stage 2 needed
     `statuses: write`); and the first draft of the behaviour tests asserted on
     **stderr**, but `::error::` goes to **stdout** — five cases false-failed,
     and had the expectations been laxer they would have false-*passed* on a
     workflow that printed nothing.

- **Test Completeness Ledger:** 50 behaviours — 48 `tested`, 2 `untestable`,
  **0 testable-but-untested**. Table below.

- **Confidence-pattern check.** *Depth (asymptote):* the shape tests plateaued
  immediately — they can only ever confirm the file still contains the strings
  someone wrote. Depth came from changing instrument, not from more assertions
  of the same kind: executing the shell found things reading it did not.
  *Breadth (coverage):* both stages, both trust directions (stage 1 holds
  nothing / stage 2 trusts nothing), both drift directions of the required-check
  set, and every branch of the verdict — including the two that only occur when
  an earlier step failed. *Integration composition:* not applicable — the
  `cross_component` flag does not fire (no hook fan-out, no merge/event-log
  resolver, no phase validator, no campaign drain); the risk flag here is
  `touches_ci_supplychain`, acknowledged separately.

### Test Completeness Ledger

| # | Behaviour | Status | Evidence |
|---|---|---|---|
| 1 | Stage 1 runs on fork PRs (no fork guard) | tested | `fail_closed::test_stage1_is_not_fork_guarded` |
| 2 | Stage 1 references no secret | tested | `fail_closed::test_stage1_holds_no_secret` |
| 3 | Stage 1 carries no tier/waiver policy | tested | `fail_closed::test_stage1_carries_no_policy`, `shape::test_carries_no_policy` |
| 4 | Stage 1 records the audit diff | tested | `fail_closed::test_stage1_records_the_change_for_audit` |
| 5 | No stage-1 job is named `PR Review` | tested | `fail_closed::test_stage1_owns_no_pr_review_context` |
| 6 | Removing a label re-decides (`unlabeled`) | tested | `fail_closed::test_stage1_re_decides_when_a_label_is_removed` |
| 7 | `Reviewer Selftest` stays a JOB of that exact name | tested | `shape::test_keeps_the_reviewer_selftest_job` (4-space indent pins job, not step) |
| 8 | Stage 1 holds no write scope at all | tested | `token_permissions::test_pr_review_stage1_holds_no_write_scope_at_all` |
| 9 | Stage 2 chained to stage 1 by exact name | tested | `fork_trust::test_stage2_is_triggered_by_workflow_run` + `fork_trust::test_stage2_names_stage1_exactly` |
| 10 | Stage 2 never checks out the PR head | tested | `fork_trust::test_stage2_never_checks_out_contributor_code` |
| 11 | Identity from the trusted `workflow_run` event | tested | `fork_trust::test_stage2_takes_identity_from_the_trusted_event` |
| 12 | Stage 2 never reads stage 1's artifact | tested | `fork_trust::test_stage2_never_reviews_the_artifact` |
| 13 | Changed paths read from the API, paginated | tested | `fork_trust::test_stage2_reads_changed_paths_from_the_api` |
| 14 | Exactly one open PR at the event SHA, or refuse | tested | `decide::test_resolve_pull_request` — 8 executed cases incl. two-matches-across-pages, match-only-on-page-2, a FORK PR, closed PR, wrong head |
| 15 | Tier: author / label / sensitive-path matrix | tested | `decide::test_tier_decision` — 21 executed cases |
| 16 | Waiver cannot cover a change to the checks | tested | `decide::test_tier_decision[skip-pr-review + workflows]`, `fail_closed::test_waiver_cannot_cover_a_change_to_the_checks` |
| 17 | Sensitive-path match is anchored at path start | tested | `decide::test_tier_decision[docs/.github/workflows/...]` → not sensitive |
| 18 | Verdict state for every outcome combination | tested | `verdict::test_verdict_branches` — 7 executed cases |
| 15a | Suppression channels count as sensitive (trivyignore, accepted-risks, semgrepignore, settings.json, install-hooks, bloat baseline) | tested | `decide::test_tier_decision` — 7 executed cases (6 channels + `.gitattributes`) plus a waiver-cannot-cover case |
| 15b | A file list larger than the 64 KiB pipe buffer still classifies | tested | `decide::test_tier_survives_a_file_list_larger_than_the_pipe_buffer` — 2001 paths, match first |
| 15c | An at-cap (3000) file list is treated as sensitive | tested | `decide::test_tier_treats_a_truncated_file_list_as_sensitive` |
| 15d | `reason` round-trips through the heredoc output form | tested | `decide::test_tier_reason_round_trips_through_the_output_file` |
| 15e | The harness is not flag-blind (a dropped `--slurp` fails a test) | tested | `decide::test_harness_rejects_a_dropped_flag` |
| 18a | A cancelled (superseded) run posts nothing | tested | `verdict::test_verdict_step_is_silent_when_cancelled` |
| 18b | "Could not read" is reported distinctly from "moved" | tested | `verdict::test_verdict_distinguishes_unreadable_from_moved` — 2 executed cases via `GH_FAIL` |
| 19 | Head moved mid-run ⇒ failure, exit 1 | tested | `verdict::test_verdict_fails_closed_when_the_head_moved` |
| 19a | `A → B → A` force-push ⇒ failure (head equality alone would bless it) | tested | `verdict::test_verdict_fails_closed_on_an_a_b_a_force_push` — **verified load-bearing**: neutralising the clause makes it fail |
| 19b | A force-push from before this run does NOT disqualify | tested | `verdict::test_verdict_ignores_a_force_push_from_before_this_run` |
| 19c | Checkout persists no git credentials | tested | `fork_trust::test_stage2_checkout_does_not_persist_credentials` |
| 19d | Two stage-2 runs for one head are serialised, newest wins | tested | `fork_trust::test_stage2_serialises_runs_for_one_head` |
| 14a | A FORK PR resolves (`commits/{sha}/pulls` returns empty for one) | tested | `decide::test_resolve_pull_request[fork-pr-resolves]`; the real-API half is probe 8 |
| 15f | A rename OUT of a sensitive directory is still sensitive | tested | `decide::test_tier_sees_a_rename_out_of_a_sensitive_directory` |
| 15g | `.gitattributes` counts as sensitive (it controls what the reviewer can see) | tested | `decide::test_tier_decision` |
| 15h | The tier's path set and the reviewer prompt agree, both directions | tested | `test_pr_review_sensitive_paths_sync.py::test_every_routed_path_is_named_in_the_reviewer_prompt` + `test_pr_review_sensitive_paths_sync.py::test_the_prompt_names_no_path_the_tier_never_routes` |
| 18c | A superseded (cancelled) stage 1 posts nothing at all | tested | `verdict::test_verdict_says_nothing_when_stage1_was_cancelled` |
| 19e | A non-numeric force-push count fails closed | tested | `verdict::test_verdict_fails_closed_when_the_force_push_count_is_not_a_number` — reachable: `jq` on empty input exits 0 printing nothing |
| 19f | A missing force-push lower bound refuses rather than reddening every PR | tested | `verdict::test_verdict_refuses_without_a_force_push_lower_bound` |
| 21a | A second check run claiming `PR Review` is refused | tested | `verdict::test_verdict_refuses_when_a_second_producer_claims_the_context` |
| 21b | Other check runs are none of the gate's business | tested | `verdict::test_verdict_is_unbothered_by_other_check_runs` |
| 22a | The job grants `checks: read`, or the impostor lookup reddens every run | tested | `token_permissions::test_pr_review_stage2_can_read_check_runs` |
| 26a | Every ledger citation in this spec resolves to a real test | tested | `test_iterate_ledger_citations.py::test_cited_test_exists` — it found the phantom row 1 cited |
| 20 | Verdict lands on the immutable event SHA | tested | `verdict::test_verdict_lands_on_the_immutable_event_sha` |
| 21 | Exactly one producer of the context | tested | `verdict::test_stage2_has_exactly_two_status_producers` (head-moved + normal, mutually exclusive) |
| 22 | Stage 2 top level read-only; job widens to `statuses`+`pull-requests` | tested | `fail_closed::test_stage2_top_level_token_is_read_only`, `token_permissions::test_pr_review_stage2_widens_writes_at_job_level` |
| 23 | Reviewer exit code never discarded (`\|\| true`) | tested | `fail_closed::test_reviewer_exit_code_is_never_discarded` |
| 24 | Oversize diff fails closed rather than skipping | tested | `fail_closed::test_oversize_diff_fails_instead_of_skipping` + pre-existing `test_pr_review_script`/`test_pr_review_lib` on `EXIT_BLOCK` |
| 25 | Third-party actions SHA-pinned; GitHub-owned on tags | tested | `shape::test_third_party_actions_sha_pinned` (regex anchored — see probe 5), `server/src/test/ci-action-pinning-posture.test.ts` 8/8 |
| 26 | No `${{ github.* }}` interpolated into a `run:` body | tested | `shape::test_no_direct_github_context_in_run_body` |
| 27 | A commit status satisfies the app-bound required context on THIS repo | untestable | `requires-external-nondeterministic-service` — only a live PR against live GitHub proves it here. Probed on the monorepo, which runs the identical ruleset shape and has already switched (probe 1). Fails closed if wrong: the context stays absent and the PR blocks. |
| 28 | Stage 2 fires and reviews on a real fork PR | untestable | `requires-external-nondeterministic-service` — needs a genuine fork PR against live GitHub. Same fail-closed direction. |

## Notes

**On merging this one, again, because it is the one surprising consequence.**
Stage 2 does not exist on `main` until this merges, and a `workflow_run`
workflow only fires from the default branch. So nothing posts `PR Review` on
this PR, the context sits `pending`, and the merge blocks — the mechanism
working exactly as designed, on the single PR where that is inconvenient.
Admin merge once; every subsequent PR is covered normally.

**What is left for the operator**, neither of which this PR can do for itself:

1. Add `Accepted-risk register (gate)` to the `main-protection` ruleset's
   required checks (Settings → Rules). It has been running and gating nothing
   since 2026-07-29.
2. Nothing for `Diff coverage (gate)` — the producer is wrong about it, and the
   fix belongs upstream in `automerge_readiness.py`.

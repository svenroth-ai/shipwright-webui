# Iterate: Unpin first-party GitHub Actions, drop Dependabot, record the decision

- **Run ID:** `iterate-2026-07-18-unpin-actions-no-dependabot`
- **Intent:** CHANGE (infra / CI posture)
- **Complexity:** medium
- **Spec Impact:** NONE — no FR behavior changes; CI workflow definitions + decision record only
- **Reverts:** PR #285 (`789dbec2`, merged 2026-07-17) — `.github/` portion only

## Problem

PR #285 SHA-pinned every first-party GitHub Action across 6 workflows and added
`.github/dependabot.yml` to keep those pins fresh. It contradicted a documented
accepted-risk position that existed only as an env var + two change-history rows,
and it introduced a GitHub-hosted proprietary service into the CI surface.

The owner has decided against Dependabot on an architectural principle:
**GitHub is repo host + Actions runner only; no other GitHub-hosted services.**
The rationale is portability — Shipwright is a framework other projects adopt,
and its CI template must not impose a hosted service on adopters. Cost is not
the driver (`shipwright-webui` is public, so Dependabot is free here).

Without Dependabot, pinning is the half-position the 2026-06-30 framework
decision explicitly warned about: pins rot silently and stop receiving the
actions' own security patches. The coherent posture is mutable tags + the
owner-scoped Semgrep tailoring that webui already opted into via #208.

## Why the machinery did not catch it (evidence)

Established empirically during scoping, and load-bearing for the ADR:

1. **#285 ran as a full medium iterate** — repo_scout, interview, iterate_spec,
   external_plan_review, self_review, code_review, confidence_calibration, test,
   finalize. Zero skips (`iterates/iterate-2026-07-17-pin-actions-sha.plan.json`).
   The full process ran and still did not surface the contradiction.
2. **`risk_flags: []`.** `classify_complexity.py` contains no pattern for
   `.github`, `workflows`, or `dependabot` — verified by grep. Changing the files
   that define which third-party code executes with repository credentials fires
   no risk flag. Reproduced live: this revert, touching the same 7 files,
   also classifies with `risk_flags: []`.
3. **Nothing reads ADR `Re-Review-Date`** — verified by grep across the compliance
   plugin and shared scripts. The only expiry mechanism that exists is the
   `.trivyignore.yaml` accepted-risk register rendered by the compliance
   dashboard as "⚠️ EXPIRED — re-review" (`ci_security.py:246-255`).

Items 2 and 3 are framework gaps; they are out of scope here and go to a
separate monorepo iterate. Item 2 is recorded because the ADR must state why a
reviewed change could contradict a recorded decision unnoticed.

## Acceptance Criteria

- **AC-1** — All 8 first-party action references (`actions/*`, `github/*`) across
  the 6 workflows are restored to their pre-#285 mutable tags: `checkout@v4`,
  `setup-node@v4`, `setup-python@v5`, `github-script@v7`, `upload-artifact@v4`,
  `codeql-action/init@v3`, `codeql-action/analyze@v3`,
  `codeql-action/upload-sarif@v4`.
- **AC-2** — The two THIRD-PARTY actions remain SHA-pinned, byte-identical to
  their current values: `peter-evans/create-or-update-comment@71345be…` and
  `svenroth-ai/shipwright/.github/actions/diff-coverage-gate@f36a656…`. They were
  pinned before #285 and are not in scope for the revert.
- **AC-3** — `.github/dependabot.yml` is deleted.
- **AC-4** — `SHIPWRIGHT_SEMGREP_ACCEPT_GH_OWNED_ACTION_TAGS` in
  `.claude/settings.json` is unchanged and documented in the ADR as load-bearing
  (Chesterton-Fence).
- **AC-5** — An ADR in `.shipwright/agent_docs/decision_log.md` records the
  framework-wide no-hosted-services principle, the owner-scoped acceptance, the
  third-party-stays-pinned asymmetry, the supersession of #285's implicit
  decision, and the Re-Review trigger.
- **AC-6** — `.trivyignore.yaml` carries an accepted-risk entry with
  `expired_at: 2027-07-18`, so the compliance dashboard surfaces the acceptance
  and flags it for re-review when due.
- **AC-7** — #285's bookkeeping (iterate entry, triage row, changelog drop,
  event, test results) is NOT reverted — the record that #285 happened must stand.
- **AC-8** — The `github-actions-mutable-action-tag` Semgrep alerts that RETURN
  after merge are dismissed with a reason citing the ADR (owner-approved in
  session). **Post-merge step** — the alerts cannot exist before main carries the
  revert, so this runs after the owner's admin-merge, not during build.

  Measured before acting rather than estimated (the earlier "44" was wrong):

  | Tool | Open now | Disposition |
  |---|---|---|
  | Semgrep `dependabot-missing-cooldown` (`.github/dependabot.yml:7`) | 1 | **Self-resolves** — the file is deleted by AC-3. No dismissal. |
  | Semgrep `github-actions-mutable-action-tag` | 0 | **Returns after merge** (~20 expected, count confirmed from the API before dismissing). These are AC-8's actual subject. |
  | Scorecard (35, incl. 24× `PinnedDependenciesID`) | 35 | **Out of scope** — see below. |

  The 35 Scorecard alerts are ORPHANED: all carry the identical timestamp
  `2026-06-30T15:36:13Z` and webui has no `scorecard.yml` workflow, so no producer
  re-evaluates them. They predate #285 by two and a half weeks and are unaffected
  by this revert in either direction. Consequently **#285's stated benefit of
  "clears 24 Scorecard PinnedDependenciesID alerts" was never achieved** — pinning
  could not close an alert nothing re-runs. Recorded in the ADR as evidence.

  Dismissing the orphans is a separate decision (the monorepo faces the identical
  situation with 28 orphans after #298 removed Scorecard there) and is deliberately
  NOT bundled here: it is not caused by this change, and the two repos should be
  handled consistently in one owner decision rather than piecemeal.
- **AC-9** — PR #286 is closed as obsolete with a comment pointing at the ADR.
  **Post-merge step**, for the same reason as AC-8: while main still carries the
  pins, #286 is a legitimate open PR. Removing `dependabot.yml` may cause
  Dependabot to close it on its own — verified by API read-back after merge, and
  closed manually only if it is still open.
- **AC-10** — A triage item is filed in the **monorepo** (`C:/01_Development/shipwright`,
  absolute path — a worktree-relative `../shipwright` resolves wrong) carrying the
  framework follow-up, so the framework-wide propagation survives this session.
  Filed via `shared/scripts/triage.py::append_triage_item_idempotent`,
  `dedup_key=ci-supplychain-guardrails-and-acceptance-surfacing`, severity
  `medium`, kind `improvement`, with a `launch_payload` brief covering:
  1. **Propagate the principle** — no GitHub-hosted proprietary services in the
     shipped CI template (`shared/templates/github-actions/*`) or adopt
     scaffolding, so adopters do not inherit Dependabot.
  2. **Gap 2 (root cause of #285)** — an acceptance silences the *triage item*
     but NOT the *code-scanning alerts*. The repo keeps showing red for a risk
     that was consciously accepted, which trains people to "fix" it. Accepting a
     risk must converge BOTH surfaces.
  3. **Gap 4** — `classify_complexity.RISK_TAXONOMY` has no pattern for
     `.github/workflows/**` or `.github/dependabot.yml`. Add a
     `touches_ci_supplychain` flag (min_complexity `small`, enforces mandatory
     review). Cheapest item with the highest leverage — verified twice in this
     session that the CI trust boundary fires zero flags.
  4. **Gap 5** — nothing reads ADR `Re-Review-Date`; the only expiry surface is
     the Trivy-shaped `.trivyignore.yaml` register (`ci_security.py:163-201`).
     Generalize it into a scanner-agnostic accepted-risk register.
  5. **Gap 3 (stretch)** — no audit check detects a change contradicting a
     recorded decision. Most expensive, least certain; list it, do not commit to it.

## Affected Boundaries

- `.github/workflows/**` — CI trust boundary (which third-party code runs with
  repository credentials). No runtime/product surface.
- `.trivyignore.yaml` — new file, consumed by the compliance dashboard.
- GitHub code-scanning alert state — mutated via API, outside the repo.

## Mini-Plan

**Chosen approach — targeted path restore.** Restore the 7 `.github/` paths to
their `789dbec2~1` state via `git checkout 789dbec2~1 -- <paths>`, then delete
`dependabot.yml`. No workflow file has been touched since #285 (verified:
`git diff 789dbec2..HEAD -- .github/` is empty), so this is exact.

**Alternative considered — `git revert 789dbec2`.** Rejected: #285 is a squash
commit that also carries iterate bookkeeping (iterate entry, triage row,
changelog drop, event, 118 lines of test results). A wholesale revert would erase
the record that #285 happened, which is precisely what the ADR needs to preserve.
Reverting and then re-adding the bookkeeping is strictly more churn for the same
`.github/` result.

## Test Strategy

No runtime surface — this changes CI workflow definitions and a decision record.
The verification is structural plus the live CI run:

- YAML parse of all 6 workflows (`yaml.safe_load`) after the restore.
- Assertion that zero `actions/*` / `github/*` SHA pins remain and both
  third-party SHA pins are byte-identical to their pre-change values.
- `.trivyignore.yaml` parses and `parse_accepted_risks` returns the entry with
  `expired=False` today.
- The live end-to-end proof is this PR's own CI run executing the restored
  mutable tags — every job must go green apart from the expected "PR Review"
  failure (see Constraints).

## Constraints

- Touching `.github/workflows/*` trips the required **PR Review** check. It WILL
  fail; that is policy, not a defect. Merge requires
  `gh pr merge --squash --admin` and **the owner performs the merge.**
- webui is squash-only.
- Work happens in the iterate worktree, never webui's main tree.

## Confidence Calibration

- **Boundaries touched:** `.github/workflows/**` (CI trust boundary),
  `.trivyignore.yaml` (new compliance-consumed file), GitHub code-scanning alert
  state (external, via API).
- **Empirical probes run:**
  - `git grep "uses: …" 789dbec2~1 -- .github/workflows` → authoritative
    pre-#285 tag list obtained; both third-party entries already SHA-pinned,
    confirming the AC-2 asymmetry is pre-existing and not introduced here.
  - `git diff 789dbec2..HEAD -- .github/` → empty; no later edits to reconcile,
    so a path-restore is exact rather than a merge.
  - `classify_complexity.py` on this change → `risk_flags: []`; reproduces the
    #285 blind spot rather than assuming it.
  - grep for `re.review|rereview` across compliance + shared scripts → no reader
    of ADR `Re-Review-Date`; the `.trivyignore.yaml` register is the only
    existing expiry surface. AC-6 exists because of this finding.
  - `ls .trivyignore*` in the worktree → absent; AC-6 creates it.
  - `parse_accepted_risks` (the REAL consumer, imported by path from the
    compliance plugin) against the new register → 1 row, `expired=False` today,
    and `expired=True` when called with `now=2027-07-19`. The alarm is proven to
    ring by injecting a future date, not by waiting for one.
  - `yaml.safe_load` over all 6 restored workflows → ALL VALID, 12 jobs total.
    A local pre-flight so a syntax error surfaces here rather than after a push;
    the standing guarantee remains the CI run itself (GitHub refuses to execute
    invalid workflow YAML), since neither workspace has a YAML parser and adding
    one is not worth the dependency weight.
  - `gh api …/code-scanning/alerts` → the estimate that drove AC-8 was WRONG and
    was corrected against measurement: Scorecard 35 (all stamped
    `2026-06-30T15:36:13Z`, no `scorecard.yml` producer → orphaned, out of scope)
    and Semgrep 1 (`dependabot-missing-cooldown`, self-resolving via AC-3). The
    endpoint is reachable despite the triage summary reporting
    "code-scanning: (unavailable)" — the producer's view is not the truth.
- **Test Completeness Ledger:** see below.
- **Confidence-pattern check:** Depth — the revert target is not inferred but
  read from git at `789dbec2~1`, so "restored correctly" is checkable against a
  known-good state rather than judged. Breadth — all 6 workflows are covered by
  the parse + pin assertions, not a sampled subset; the third-party pins are
  asserted positively (must remain) rather than only the first-party ones
  negatively (must go), so a too-greedy restore fails loudly.

### Test Completeness Ledger

| # | Behavior | Disposition | Evidence |
|---|---|---|---|
| 1 | 8 first-party refs restored to mutable tags (AC-1) | tested | structural assertion over all 6 workflow files vs. the `789dbec2~1` reference list |
| 2 | 2 third-party refs remain SHA-pinned (AC-2) | tested | byte-equality assertion against current values |
| 3 | `dependabot.yml` absent (AC-3) | tested | path-absence assertion |
| 4 | Accept-flag unchanged (AC-4) | tested | byte-equality assertion on `.claude/settings.json` |
| 5 | All 6 workflows remain valid YAML | tested | `yaml.safe_load` pre-flight → ALL VALID (12 jobs). No committed regression test: neither workspace has a YAML parser and adding a dependency for this is not worth the weight — GitHub refuses to run invalid workflow YAML, so row 6's CI run is the standing guarantee |
| 6 | Workflows still execute correctly under mutable tags | tested | this PR's own CI run — all jobs green except the expected "PR Review" policy failure |
| 7 | `.trivyignore.yaml` entry parses + registers (AC-6) | tested | PASS — `parse_accepted_risks(root, now=2026-07-18)` → 1 row, correct id, `expired_at` parsed as a date, `expired=False` |
| 8 | The alarm actually rings once past `expired_at` | tested | PASS — same consumer with `now=2027-07-19` → `expired=True`; boundary probe confirms it expires strictly AFTER the date, not on it |
| 7-8 note | — | — | Both run the SHIPPED consumer (imported by path from the compliance plugin), not a re-implementation of its date logic. No committed regression test is possible: the consumer lives outside this repo, so a webui vitest cannot import it. Static file + external consumer ⇒ low regression risk accepted |
| 9 | ADR content (AC-5) | untestable | `requires-manual-visual-judgment` — prose adequacy is a review judgment; presence/structure is covered by the F11 ADR checks |
| 10 | Returning mutable-tag alerts dismissed (AC-8) | untestable | `requires-external-nondeterministic-service` — GitHub alert state, and the alerts cannot exist until main carries the revert. Post-merge API read-back is the evidence; the pre-merge inventory is already measured and recorded under AC-8 |
| 11 | PR #286 closed (AC-9) | untestable | `requires-external-nondeterministic-service` — GitHub PR state; post-merge API read-back (Dependabot may close it itself once its config is gone) |
| 12 | Monorepo triage item filed (AC-10) | tested | read-back assertion: `triage.read_all_items(monorepo_root)` contains the `dedup_key` with `status="triage"` — the write is idempotent, so the read-back is the proof it landed, not the exit code |

Untested-testable: **0**.

## Out of Scope

- The Semgrep `dependabot-missing-cooldown` finding — it disappears with
  `dependabot.yml`, so nothing is suppressed. Confirmed by the post-merge scan
  rather than papered over.
- The framework changes themselves (principle propagation, gaps 2/3/4/5). They
  are handed off via AC-10, not built here.

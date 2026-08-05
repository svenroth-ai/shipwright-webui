# A superseded review verdict stops blocking the pull request (webui port of ADR-117)

- **Run ID:** `iterate-2026-08-01-pr-review-stale-verdict`
- **Intent:** CHANGE (Path B) · **Complexity:** medium
- **Ports:** shipwright#508 / monorepo **ADR-117**
  (`iterate-2026-07-31-it7a-pr-review-stale-verdict`)
- **Spec Impact:** **NONE**
- **Spec Impact justification:** `.shipwright/planning/01-adopted/spec.md` carries
  no criterion about `pr_review`, Tier-3 review, or `CHANGES_REQUESTED` — the
  reviewer's contract lives in **CLAUDE.md rule 30** and in the vendored module
  itself, not in an FR. (Being precise about that on purpose: the monorepo's
  ADR-117 could justify NONE against its own FR-01.17, and this port cannot
  borrow that citation, because webui has no such FR.) Rule 30 already makes the
  reviewer's verdict the thing that gates merge; today it writes the verdict it
  reached while GitHub keeps displaying an older, opposite one, so the verdict
  actually read is not the verdict actually reached. That is a defect against an
  existing contract, not a new promise — no criterion is minted and `spec.md` is
  not touched.

---

## 1. What is broken (measured upstream, structurally identical here)

A Tier-3 review that fails closed posts a GitHub `CHANGES_REQUESTED` review.
Two GitHub behaviours then combine badly:

1. A later `COMMENTED` review from the same reviewer does **not** retract an
   earlier `CHANGES_REQUESTED` one.
2. `dismiss_stale_reviews_on_push` clears **approvals** only.

The pull request therefore sits at `reviewDecision: CHANGES_REQUESTED` /
`mergeStateStatus: BLOCKED` with every required check green and zero open review
threads. **Nothing on the page names the blocker — the symptom is silence.**

Measured upstream on shipwright PR #446 (live API, 2026-07-31): five verdicts
stamped `bdd788a1`, `720f0de8`, `75e538c1`, `2ea75602`, `1086cf4e` survived six
later clean `COMMENTED` reviews and it merged only after a manual dismiss.

### Why this repository has the same defect

`scripts/ci/pr_review.py` is a vendored copy of the same reviewer, at canonical
version `iterate-2026-06-17-pr-review-truncation-failclosed`. It posts
`--request-changes` on a `block` verdict and `--comment` otherwise
(`post_pr_review_state`), and it has no dismissal path at all. The truncation
fail-closed rule (CLAUDE.md rule 30's tree) makes a *large* PR post
`CHANGES_REQUESTED` too, so the trigger is not limited to a genuine model block.

### Probe P-W1 — the fix is permitted here, and needs no workflow change

`.github/workflows/pr-review-run.yml` job `review` already declares
`pull-requests: write` (lines 66-69). Dismissal is exactly that permission, so
this diff touches **no** file under `.github/workflows/**` — which is also why
`touches_ci_supplychain` does not fire (its patterns are `.github/workflows/**`,
`.github/dependabot.y(a)ml`, `.github/actions/**`; `scripts/ci/**` is not among
them, verified against `risk_detectors.CI_SUPPLYCHAIN_FILE_PATTERNS`).

### Probe P-W2 — the legacy backlog on this repository

Verified at build time (§Confidence Calibration): verdicts posted **before** this
ships carry no marker and can never be attributed, so they are never cleared
(AC7). This is only an acceptable price if the standing backlog is small; it is
measured rather than assumed.

---

## 2. Acceptance criteria

- **AC1** — Given a Tier-3 review run that reaches a non-blocking verdict, when
  its own review has been posted and **is the verdict on the pull request's
  current head**, then every `CHANGES_REQUESTED` review this reviewer itself
  left on that pull request against a *different* commit is dismissed.
- **AC2** — Given a `CHANGES_REQUESTED` review left by a **human**, then it is
  never touched — the guard is structural (`user.type == "Bot"`), not a
  body-text guess.
- **AC3** — Given a `CHANGES_REQUESTED` review left by another bot, or by
  another workflow under the same `github-actions[bot]` identity, then it is
  never touched, because a candidate must carry this reviewer's own marker as
  the **last line** of its body.
- **AC4** — Given a run whose verdict is `block` (including a truncation
  fail-closed block) or whose decision is unknown, then **nothing is listed and
  nothing is dismissed**.
- **AC5** — Given this run did not review the commit that is now the head —
  whether the head moved after it posted, or it read an older commit while the
  head ran ahead — then **nothing is dismissed**. The commit this run *read* is
  proven separately from the commit its review is *stamped with*.
- **AC6** — Given dismissal is refused, or the listing fails or returns
  unparseable output, then the required check keeps the value the *review*
  earned, and the refusal is printed rather than swallowed.
- **AC7** — Given a `CHANGES_REQUESTED` review carrying **no marker**, then it
  is left alone and the run says so.
- **AC8** — Given the run clears (or declines to clear) stale verdicts, then it
  **names** what it did and why.
- **AC9 (port-specific)** — `scripts/ci/pr_review.py` stays within the 300-line
  source guideline without opening a bloat exception, and the vendor-provenance
  header states honestly how this copy now diverges from canonical.

---

## 3. Options considered

The four rejected alternatives are inherited from ADR-117 and are **not**
re-litigated here — approve-on-success (trades a stuck merge for a control
downgrade the moment `required_approving_review_count` rises), login-only
matching (sweeps up every other workflow under the shared bot login),
prefix/substring marker matching (a quoted or echoed marker becomes ownership),
and timestamp ordering (execution order is not commit order, and GitHub's
one-second precision ties silently no-op). Each was killed on evidence upstream;
re-deciding them would be re-running three review rounds for nothing.

What **is** decided here is the port's shape, because the vendored copy differs:

| Option | Verdict |
|---|---|
| **A. Re-vendor the whole canonical `pr_review*` tree** | **Rejected.** Canonical has moved far past this copy — a generated-artifact diff filter (`pr_review_diff_filter`), a rendering module (`pr_review_render`), byte-level diff reads, `nothing_reviewed_summary`. Dragging those in would ship three unrelated behaviour changes under an ADR-117 heading and make the review of the actual safety surface impossible. |
| **B. Port ADR-117 only, into this repo's shape** | **Chosen.** The card says so explicitly. The selector is the safety surface and it ports **verbatim**; only the wiring around it is adapted. |
| **C. Add the dismissal wiring inline in `pr_review.py`** | **Rejected — it does not fit.** The file is **299 lines** against a 300-line guideline with *no* baseline entry, so any inline growth is a NEW bloat crossing. Estimated ahead of build at ≈ +40 lines → ≈ 340; the wiring actually measured +16 → **315** (P-W4). Either way it does not fit. A new crossing passes pre-commit but is blocked at the Stop gate, and opening an exception for a file this diff is actively editing would be a fiction. |
| **D. Extract BOTH external boundaries — `pr_review_gh.py` and `pr_review_openrouter.py`** | **Chosen, and forced by C.** One module per external boundary. The `gh` half is canonical's own seam and **converges** the vendored copy toward it. The OpenRouter half was NOT planned and is recorded here because it was decided during build: the `gh` extraction alone frees ≈ 38 lines and lands `pr_review.py` at ≈ 332, still over. Canonical keeps OpenRouter inline and can afford to — it carries no vendor-provenance header, and this copy's header is ~25 lines that a vendored file may not trade away for line budget. So the same content produces a different split point, and the second extraction is load-bearing for AC9 rather than opportunistic. |

**`strip_display_unsafe` has no home here.** Canonical's `pr_review_dismiss`
imports it from `pr_review_render`, which this repo has never vendored. Adding
it to `pr_review_lib.py` would break that file's `adaptation: none — byte-identical
to canonical` claim and cost the ability to re-vendor it by straight copy.
It is therefore defined **inside `pr_review_dismiss.py`**, where its only caller
lives. Canonical's reason for hoisting it — *"exported rather than re-declared
per sink so no sink grows its own, weaker class"* — does not apply yet, because
this repo has exactly **one** sink (it has no `safe_path`, no diff filter, no
prompt-path rendering). Recorded so that a later port of the render module
hoists it rather than growing a second copy.

**Two of the three moved wrappers move verbatim; the third gains one check, and
that is not a tidy-up.** Canonical has since changed all three (bytes-not-
`text=True` on the diff read, an `encoding=`/`errors=` pair on every
body-carrying call). Those belong to a *different* canonical iterate and are not
smuggled in here — moving a function and changing it in the same commit is how a
behaviour change hides inside a refactor.

The exception is **`post_pr_review_state`, which now raises on a non-zero
`gh` exit.** It previously discarded the `CompletedProcess` entirely, so it could
not fail — which meant `pr_review.py`'s existing `except` clause around it was
DEAD CODE, and a rate-limited or forbidden post was indistinguishable from a
successful one. ADR-117 gates the whole cleanup on whether this reviewer's own
review actually LANDED, because that review is the anchor the ownership rule is
read from. Without the check, `state_posted` can only ever be `True`: the run
would go hunting for an anchor it never posted, find none, and report "this run's
own review is not visible yet" — the wrong cause, printed confidently. So this is
not a wrapper improvement that snuck in with a refactor; it is **the precondition
for AC4 and ledger row 25 being testable at all**, it is required by §4's own
`_post_verdict` contract, and canonical made the identical change for the
identical reason. Recorded here, in the module header, and in §6.
Guard: `calls::test_no_cleanup_when_the_review_state_never_landed` is reachable
only because of it.

The **new** wrappers do take `encoding="utf-8", errors="replace"`, because they
are new code and `list_pr_reviews` decodes review bodies that are model output
with emoji badges; `text=True` would decode those with the runner's preferred
encoding and raise on a non-UTF-8 locale.

---

## 4. Design

Six files in scope: four new, one modified, one deliberately UNTOUCHED. No new dependency, no workflow change.

| File | Change |
|---|---|
| `scripts/ci/pr_review_dismiss_select.py` | **New, pure, ported verbatim.** `MARKER_RE`, `new_nonce()`, `stamp_review_body()`, `StaleSelection`, `select_stale_verdicts()`. The whole ownership rule with no I/O. |
| `scripts/ci/pr_review_dismiss.py` | **New, the calls.** `DISMISSAL_MESSAGE`, `DismissalReport`, `read_reviewed_head()`, `dismiss_own_stale_verdicts()`. Adapted: local `strip_display_unsafe`. |
| `scripts/ci/pr_review_gh.py` | **New.** TWO existing wrappers moved verbatim; `post_pr_review_state` additionally raises on a non-zero `gh` exit (§3 — required by `_post_verdict`). Plus `list_pr_reviews()`, `fetch_pr_head_sha()`, `dismiss_pr_review()`, `_decode_pages()`. |
| `scripts/ci/pr_review_openrouter.py` | **New.** `DEFAULT_MODEL`, `OPENROUTER_URL`, `_post_openrouter()`, `call_openrouter()` moved out of the tool unchanged. Not planned; decided during build and priced in §3 option D — without it `pr_review.py` lands at ≈ 332 and AC9 fails. |
| `scripts/ci/pr_review_lib.py` | **Untouched on purpose** — kept re-vendorable by straight copy, which is why `strip_display_unsafe` did not go there (below). |
| `scripts/ci/pr_review.py` | Reads the head via `read_reviewed_head()` **before** fetching the diff; `_post_verdict()` stamps the review-state body with this run's nonce and reports whether it landed; on a non-`block` verdict that landed, calls the orchestrator with that head. |

**The marker** is a whole structured token, `<!-- shipwright-pr-review:{32 hex} -->`,
matched **entire** (`fullmatch`) and **positionally** — it counts as ownership
only as the last line of the body, which is where `stamp_review_body` puts it.

**Selection rule** (`select_stale_verdicts(reviews, nonce, head_sha, reviewed_sha)`):

1. **Anchor** = the review whose *last line* is this run's exact marker and whose
   `user.type == "Bot"`. None → dismiss nothing, and say why.
2. **Refuse** unless `reviewed_sha == head_sha == anchor.commit_id` (AC5).
3. **Dismiss** every review that is all of: `state == "CHANGES_REQUESTED"` ·
   last line matches `MARKER_RE` · `user.type == "Bot"` ·
   `user.login == anchor.user.login` · `commit_id != anchor.commit_id`.

**Why step 2 needs all three terms.** GitHub stamps `commit_id` at **submission**
— the head as it then stood, not the commit whose diff was read. So
`anchor.commit_id == head_sha` alone says only *"the head has not moved since I
posted"*: a run that reviewed X while the head advanced to Z is stamped Z, passes
a two-term guard, and would retract a live verdict about the intermediate commit
Y. The third term is the head captured **before** the diff is fetched and threaded
through by the caller; unreadable → `None` → refuse everything.

**One more head read immediately before the first dismissal**, skipped when there
is nothing to dismiss. Selection and mutation cannot be atomic; a force-push can
put a candidate's commit back at the head, and then a verdict about to be
retracted describes the code again.

**An unreadable listing is an error, not an empty pull request.** `gh` can exit 0
and return `{"message": "Not Found"}`; decoding that to `[]` would report an
unreadable PR as a clean one and send the reader to the wrong place.

Everything here is best-effort: the required check keeps what the **review**
earned, and a housekeeping failure is reported and then dropped.

## 5. Affected Boundaries

- **`gh` CLI / GitHub REST** — a new **mutating** call
  (`PUT …/pulls/{n}/reviews/{id}/dismissals`) and two new reads. `--paginate`
  output is decoded with `json.JSONDecoder().raw_decode` so both the merged-array
  and concatenated-pages shapes parse.
- **The `PR Review` required status** — the dismissal runs *after* the verdict is
  posted and **its outcome never reaches the exit code**; that is the claim this
  change actually establishes, and it is traced on every path. It is deliberately
  narrower than "unchanged by construction", which an earlier draft said and
  Stage-3 review rejected: the status is posted by a LATER workflow step using the
  same GitHub API budget this loop spends, so a shared secondary rate limit is a
  channel the exit-code argument does not cover. Named in §5b(f).
- **Module boundary inside `scripts/ci/`** — six functions change import site, so
  the tests that monkeypatch them move with them (Test-Update-Klausel). `TestGhWrappers` monkeypatched `pr_review.subprocess` and becomes
  `gh::TestMovedWrappers`; `TestPostOpenRouter` / `TestCallOpenRouter`
  monkeypatched `pr_review.urllib` / `pr_review._post_openrouter` and become
  `test_pr_review_openrouter.py`. Every assertion moves UNCHANGED — a refactor
  must not be able to quietly relax the guards it displaces.

## 5b. What this does NOT unblock (inherited, stated not rediscovered)

- **(a)** A same-head re-review cannot retract this reviewer's own earlier block:
  a candidate whose `commit_id` equals the anchor's is skipped as
  `current_commit`. The alternative would let any verdict be re-rolled away by
  re-reviewing until the model agrees — worse than a stuck merge.
- **(b)** A block posted by a concurrent run on a different SHA outlives the head
  it was stamped with, by the same mechanism.
- **(c)** The `needs_review == false` success path in
  `.github/workflows/pr-review-run.yml` still leaves a stale verdict standing.
  Out of scope here for the same reason as upstream: it is a workflow change, and
  a workflow change would put this diff inside `touches_ci_supplychain` and CLAUDE.md
  rule 30's tree for a fix that is not what this card asked for.
- **(d)** `reviewed_sha` is *fresh*, not *exact*: a force-push X → Y → X
  straddling the run defeats it. Closing it needs the workflow to pass its
  trusted `head_sha` in as `--head-sha` — again the workflow tree.
- **(e)** No retry when this run's own review is not yet visible in the listing
  (GitHub REST is not read-after-write consistent across a POST then a GET). The
  failure is a self-healing silent no-op: the next qualifying run clears it.
  **Refinement found by the second external code review (low), and NOT fixed
  here:** in that window — and equally when the three-term head guard refuses —
  `select_stale_verdicts` returns *before* it inspects any candidate, so the run
  reports the anchor problem and never mentions that an unmarked legacy block is
  sitting on the pull request. AC7's "left alone" holds structurally (nothing is
  examined, so nothing can be dismissed) and AC8's "say why" holds for the reason
  that actually stopped it; what is missing is the *second* sentence a maintainer
  would want. **Deliberately not fixed in this port:** the early return is inside
  the byte-identical vendored selector, and a report-only scan added HERE would
  break the hash pin, forfeit the byte-identity that is most of this port's
  value, and be reverted by the next re-vendor without anyone noticing — the
  exact drift the anchor card forbids. Filed upstream, where the whole rule lives.

- **(f)** The dismissal loop issues N unthrottled `PUT …/dismissals` calls. Those
  are content-creating requests against GitHub's secondary rate limit, and the
  next workflow step posts the required `PR Review` status with another
  content-creating call under `set -euo pipefail`. If the loop tripped the
  limit, that POST could 403, the step would fail, and an absent required
  context blocks. Not measured, and N is realistically small — a candidate
  needs a marked block verdict *followed by* a head move — but it is a real
  channel from housekeeping to the gate, so it is named rather than left inside
  a "by construction" claim. **Not fixed here:** the loop is inside the
  byte-pinned `pr_review_dismiss`, so a local `sleep` is the drift this port
  refuses; filed upstream (Stage-3 review agreed on both points).

**On shipping an irreversible write.** Dismissal has no inverse. The blast radius
on the day this merges is **zero** and grows only over reviews this same code has
itself stamped — ownership requires *our* marker, and no review in this
repository carries one. So the first thing it can possibly dismiss is a
change-request this code posted after shipping.

## 6. Out of scope (named, not silently dropped)

1. Canonical's diff filter, render module, byte-level diff read and
   `nothing_reviewed_summary` — a separate port. **This decision cost this very
   pull request, and the number is worth recording rather than discovering twice:**
   #343's diff measured **253,601 chars against the 200,000 cap**, so the reviewer
   fail-closed on truncation — and **43% of it (110,264 chars) is producer-generated
   artifacts** (this spec, `reviews.json`, `triage.jsonl`, the changelog drop, the
   event log) which `pr_review_diff_filter` drops by design. Code and tests alone are
   **143,337**, comfortably under. So the filter is not a nice-to-have for this repo:
   without it, any medium+ iterate touching a sensitive path is unreviewable by its
   own gate and needs an admin merge. Porting it FIRST, as its own small PR, is the
   sequencing that avoids repeating this.
2. The `needs_review=false` workflow path and an exact `--head-sha` (§5b c, d).
3. Rescuing unmarked legacy verdicts (AC7).
4. Changing the moved wrappers' behaviour while moving them — with the ONE
   disclosed exception of `post_pr_review_state` raising (§3), which AC4 and
   §4's `_post_verdict` contract require rather than merely permit.

## 7. Assumptions taken (no interview — `--autonomous`)

1. **Scope is ADR-117 only**, not a full re-vendor. The card states the shape
   differs and names the two files; a full re-vendor is option A, rejected in §3.
2. **Clearing stale verdicts is best-effort** — a refusal must never turn a
   passed review into a failed check. Failing the gate on housekeeping would
   newly block PRs that are fine.
3. **Dismissal happens on a passing verdict only.** A `block` run leaves older
   blocks standing; they are redundant, not wrong.
4. **BOTH external-boundary extractions are in scope** (`gh` and OpenRouter)
   because option C does not fit under the bloat guideline. Only the `gh` half
   was foreseen; the OpenRouter half was decided mid-build once the measured
   line count (P-W4) showed one extraction was not enough. Both are forced
   consequences of the port, not opportunistic refactors.

---

## Confidence Calibration

- **Boundaries touched:** GitHub REST via the `gh` CLI (one new *mutating*
  endpoint, two new read endpoints); the `PR Review` required status (read-only
  from this change's perspective); the `scripts/ci/` module boundary. No config,
  no on-disk state, no client/server surface.
- **Empirical probes run:** see §Probes below — filled at build time.
- **Test Completeness Ledger:** see §Ledger below.
- **Confidence-pattern check:**
  - *asymptote (depth)* — the risky direction is **over-dismissal**, so the tests
    push on identity (human, other bot, no anchor, quoted marker, forged anchor)
    rather than on the happy path.
  - *coverage (breadth)* — every branch of the selection rule has a case, plus
    the orchestration invariants (never on `block`, never flips the gate, head
    read before the diff).
  - *integration composition* — `cross_component` is **not** triggered: this diff
    touches neither the merge/churn/event-log resolvers, Claude-Code hooks,
    pipeline phase validators, nor campaign drain.

### Probes

All six were run, not reasoned. Two of them contradicted something this port
would otherwise have inherited as true.

| Probe | What it settled |
|---|---|
| **P-W1** | `.github/workflows/pr-review-run.yml` job `review` already declares `pull-requests: write` (lines 66-69). The dismissal is permitted **and needs no workflow change**, which is what keeps this diff out of `.github/workflows/**` and out of `touches_ci_supplychain`. |
| **P-W2** | **Upstream's justification for AC7 does NOT transfer.** ADR-117 priced the unmarked-legacy exclusion at zero because the monorepo had no open PRs. webui has one — **#329**, sitting at `reviewDecision: CHANGES_REQUESTED` from `github-actions[bot]`. Read live, it is stuck *twice over*: the verdict carries no marker (AC7 → never cleared) **and** it is stamped `53b47ad8`, which IS the current head, so residual (a) would skip it as `current_commit` even with a marker. It is also `mergeable_state: dirty`. **Conclusion stated plainly: this change does not unblock the one PR currently stuck — that one still needs a manual dismiss. The benefit is forward-looking only.** |
| **P-W3** | The canonical files are `i/lf w/crlf` in a Windows checkout, so a working-tree `sha256` (`ede29e43…` for the selector) matches **no** upstream git object; the reproducible LF-blob hash is `5cc9aea3…`. Exactly the trap webui #341 burned an iterate on. Every hash recorded by this change is over LF bytes, and the new pin normalises rather than trusting `.gitattributes` to stay put. |
| **P-W4** | The line budget was **measured, not estimated**. Wiring ADR-117 inline took `pr_review.py` from 299 to **315** — a new bloat crossing, which passes pre-commit but is blocked at the Stop gate, and for which an exception on a file this diff is actively editing would be a fiction. Extracting the `gh` boundary alone lands it at ~332 — still over. Extracting BOTH external boundaries lands it at **297** as shipped. (An earlier draft said 277 — measured before the Stage-2 ORDERING comment and the Stage-3 corrections landed, and not re-measured. A probe presented as a measurement should not be 20 lines out; re-measured, headroom is now ~3 lines, which is why the corrections above were trimmed rather than appended.) |
| **P-W5** | **Mutation verification, three guards — and one negative result.** (1) Moving the head read below `fetch_pr_diff` → `test_the_head_is_read_before_the_diff_is_fetched` goes red. ✅ (2) Restoring `(review.get("user") or {})` → four tests go red. ✅ (3) Deleting the trailing `.strip()` in `_own_marker` → **no behavioural test failed**; only the new vendor pin caught it. Chasing that produced the run's one genuine *correction of an upstream claim* — see ledger row 7. |
| **P-W6** | `cp` from the monorepo working tree carried **CRLF into every ported file** (191/193/287/219/177 CRLF pairs). Under `scripts/ci/** text eol=lf` git would have normalised them on commit, so this would never have failed CI — it would silently have made the working tree disagree with the index. Normalised explicitly. |

### Test Completeness Ledger

**118 tests across 8 modules · 32 behaviors · 31 `tested` · 1 `untestable` ·
0 testable-but-untested.** Module counts: selector 35 · orchestrator 16 ·
`gh` boundary 24 · tool wiring 11 · OpenRouter 5 · invariants 5 · file
contract 13 · sanitiser 9 (plus a shared offline-tripwire helper with no cases of its own). Rows 29-31 were added by the Stage-2 and external CODE reviews; rows 23 and 29 were REWRITTEN by Stage-3, which found row 23 claiming coverage the port did not have.

Whole suite: **431 passed** — 310 test cases plus 121 ledger-citation checks, of
which **67 are this spec's**. Those 66 exist only because the citations below were
converted to a form the repo's `test_cited_test_exists` guard can resolve and
aliases were registered for these seven modules; before that it matched none of
them and passed having verified nothing.

Citations use the `<alias>::<test_name>` form that
`scripts/ci/tests/test_iterate_ledger_citations.py` can actually resolve. That
guard matches only that shape and silently skips anything else, so the bare
test names this table first carried made it pass having checked **nothing** —
which is precisely the "reads as coverage and is not" failure its own docstring
describes. Aliases for these seven modules were registered in this diff.

| # | Behavior | AC | Status | Evidence |
|---|---|---|---|---|
| 1 | A passing run dismisses its own superseded change-requests | AC1 | tested | `calls::test_it_dismisses_and_reports`, `select::test_own_marked_verdict_on_a_superseded_commit_is_selected` |
| 2 | The posted review-state body carries this run's nonce, and the cleanup gets that same nonce | AC1 | tested | `stale::test_the_cleanup_looks_for_the_nonce_this_run_actually_posted` |
| 3 | The head is read **before** the diff is fetched | AC1, AC5 | tested | `stale::test_the_head_is_read_before_the_diff_is_fetched` — **mutation-verified (P-W5.1)** |
| 4 | A human's change-request is never dismissed, even carrying the marker | AC2 | tested | `select::test_a_humans_change_request` |
| 5 | An anchor that is not a `Bot` is refused | AC2 | tested | `select::test_an_anchor_that_is_not_a_bot` |
| 6 | Another bot's / another workflow's change-request is never dismissed | AC3 | tested | a DIFFERENT login: `select::test_another_bots_change_request`; the same shared `github-actions[bot]` login: `select::test_an_unmarked_verdict_under_the_same_shared_bot_login` (also row 25 — one test, two criteria, cited under both rather than lost between them) |
| 7 | A marker quoted mid-body is not ownership; a CRLF body still is | AC3 | tested | `select::test_a_quoted_marker_mid_body_is_not_ownership`, `select::test_a_quoted_anchor_marker_does_not_become_the_anchor`, `select::test_a_body_as_github_actually_returns_it_is_recognised`, `select::test_what_stamp_review_body_produces_is_recognised`, `select::test_leading_whitespace_before_the_marker_is_still_ownership`. **An upstream claim corrected, by measurement.** Canonical's ledger calls the trailing `.strip()` load-bearing *for CRLF*. It is not: the preceding `.rstrip()` already removes a trailing `

`, and the CRLF fixture passes with `.strip()` deleted. But the guard **is** load-bearing — for a different input class this run had to go looking for: **leading** whitespace or a tab before the marker on its last line (`"summary

   <marker>"`) is recognised only with it. An earlier draft of this row said "no body could be constructed", which was wrong and would have invited someone to delete the call. Retained, reason restated, a behavioural guard added (deleting `.strip()` now fails 3 cases, not just the hash pin), and both halves filed upstream. |
| 8 | A change-request about the *current* commit is never dismissed | AC4 | tested | `select::test_a_verdict_about_the_commit_that_is_current` |
| 9 | A `block` / truncated / unknown-decision run clears nothing | AC4 | tested | `stale::test_a_blocking_verdict_clears_nothing`, `stale::test_a_truncated_diff_clears_nothing`, `stale::test_an_unknown_decision_clears_nothing` |
| 10 | Reviewed is not head, or stamped is not head, then nothing dismissed | AC5 | tested | `select::test_anything_at_all_when_the_head_has_moved`, `select::test_a_run_that_reviewed_an_older_commit_clears_nothing` |
| 11 | An unreadable reviewed-head clears nothing | AC5 | tested | `select::test_an_unreadable_head_clears_nothing` |
| 12 | The head is re-confirmed before the first dismissal; moved or unreadable abandons the sweep | AC5 | tested | `calls::test_a_head_that_moved_since_selection_stops_the_sweep`, `calls::test_an_unconfirmable_head_stops_the_sweep` |
| 13 | With nothing to dismiss, no second head read is spent | AC5 | tested | `calls::test_nothing_to_dismiss_costs_no_extra_head_read` |
| 14 | A listing / head / dismissal failure never flips the gate | AC6 | tested | `stale::test_a_failing_cleanup_does_not_flip_the_gate`, `calls::test_one_refused_dismissal_does_not_stop_the_others` |
| 15 | Unparseable, non-array, OR EMPTY listing output raises rather than reading as "no reviews" | AC6 | tested | `gh::test_a_zero_exit_body_that_is_not_json_raises`, `gh::test_an_error_object_instead_of_an_array_raises`, `gh::test_a_zero_exit_with_no_json_at_all_raises` (3 cases), `gh::test_an_empty_array_is_still_an_empty_list` — the empty case is a DELIBERATE divergence from canonical taken on an external-review finding (§5b) |
| 16 | Every refusal is printed, never swallowed | AC6, AC8 | tested | the **two** `*_contained_and_named` tests — `calls::test_a_listing_failure_is_contained_and_named`, `calls::test_a_head_lookup_failure_is_contained_and_named` — plus `stale::test_a_failing_cleanup_is_reported_not_swallowed` |
| 17 | One malformed review row does not void the sweep; a non-dict `user` cannot either | AC6 | tested | `select::test_a_malformed_entry_is_counted_and_the_rest_still_clear`, `select::test_a_non_object_user_does_not_abort_the_sweep`, `select::test_a_non_object_user_cannot_break_the_anchor_scan_either` — **mutation-verified (P-W5.2)** |
| 18 | An already-dismissed review is not selected again (idempotent) | AC1 | tested | `select::test_an_already_dismissed_verdict_is_not_selected_again` |
| 19 | A marker echoed by the model is stripped before stamping | AC3 | tested | `select::test_a_marker_echoed_by_the_model_is_stripped_before_stamping` |
| 20 | The nonce is 128 bits from the cryptographic source, and matches what the selector accepts | AC1 | tested | `select::test_two_runs_never_share_a_nonce`, `select::test_the_nonce_fits_the_marker_the_selector_matches`, `select::test_it_comes_from_the_cryptographic_source` |
| 21 | The dismissal request sends PUT plus the required `message`, and no `event` | AC1 | tested | `gh::test_it_sends_a_put_with_the_required_message`, `gh::test_it_does_not_send_the_undocumented_event_field` |
| 22 | The listing decodes both `--paginate` shapes and drops non-object entries | AC1 | tested | `gh::test_it_reads_one_merged_array`, `gh::test_it_reads_arrays_concatenated_one_per_page`, `gh::test_a_non_object_entry_is_dropped_rather_than_carried` |
| 23 | Every emitted line is scrubbed at one choke point, and the sanitiser's ALPHABET is pinned | AC6, AC8 | tested | choke point: `calls::test_every_reported_line_is_scrubbed_wherever_the_text_came_from`, `calls::test_control_characters_from_gh_are_made_inert`. Alphabet + contract: `sanitiser::test_its_alphabet_is_exactly_the_documented_class` and 8 siblings. **Stage-3 caught this row claiming `tested` on the one function this port ADAPTED rather than vendored:** `strip_display_unsafe` was re-declared here because canonical hosts it in an unvendored module, its comment claimed to be "pinned by enumeration in the tests" (true upstream, false here), and narrowing its class to `\x00-\x1f` left 50 of 82 codepoints dead with the whole suite green. Canonical's sanitiser cases are now ported; the fix touched no pinned byte, so the vendoring posture never excused it. |
| 24 | The report names what was dismissed, what was left alone and why | AC8 | tested | `calls::test_it_says_why_when_it_dismisses_nothing`, `calls::test_the_default_log_goes_to_stderr` |
| 25 | **An unmarked verdict is left alone AND the run names it** | **AC7** | tested | left alone: `select::test_an_unmarked_verdict_under_the_same_shared_bot_login`; *said so*: `calls::test_an_unmarked_verdict_is_named_in_the_log` — **added in this port.** AC7's second clause had no assertion anywhere: `_describe` renders the skip map generically and the only says-why test pinned the `human` key. This is the message that matters most HERE, because P-W2 found this repo's one stuck PR stuck precisely for being unmarked. |
| 26 | No cleanup when the review state never landed (no anchor means no guessing) | AC1, AC4 | tested | `stale::test_no_cleanup_when_the_review_state_never_landed`, and the precondition it rests on: `gh::test_a_failure_is_raised_rather_than_discarded` (renamed from `test_review_state_failure_is_raised_rather_than_discarded` by the 2026-07-28-pr-review-parity merge, same class, same assertions — see that iterate's note below row 27). The external code review caught that the integration test monkeypatches the function to raise, so it would have stayed GREEN if the wrapper regressed to discarding the result — the guard had to move to the boundary that decides |
| 27 | Both sets of moved tests keep their original assertions; the reviewer still never approves | AC9 | tested | `gh` half: `gh::test_never_approves` (renamed from `test_review_state_never_approves`), `gh::test_success_decodes_utf8` (supersedes `test_fetch_pr_diff_success` — the merge with iterate-2026-07-28-pr-review-parity moved `fetch_pr_diff` from text- to bytes-mode, so the old text-round-trip assertion no longer describes the function; this is the equivalent successful-fetch case for the new mode), `gh::test_block_requests_changes` (renamed from `test_review_state_block_requests_changes`). OpenRouter half: `openrouter::test_builds_authorized_json_request`, `openrouter::test_http_error_wrapped`, `openrouter::test_bad_shape_raises_runtime` — cited so §5's "every assertion moves UNCHANGED" is evidenced for BOTH relocations, not just one. **Citations updated 2026-08-05** when `iterate-2026-07-28-pr-review-parity` was rebased onto this ADR-117 port: `test_pr_review_gh.py` was consolidated into one module covering both iterates' cases, which renamed three of the four cited tests and replaced the fourth with its bytes-mode equivalent — the underlying behaviour these rows evidence is unchanged, only the test names moved. |
| 28 | The marker namespace has exactly one producer; vendored copies are pinned and state provenance; no reviewer module silently crosses 300 lines | AC9 | tested | `pins::test_the_marker_namespace_has_exactly_one_producer`, `pins::test_a_vendored_module_has_not_been_edited_in_place`, `pins::test_every_pinned_module_states_its_provenance`, `script::test_no_reviewer_module_silently_crosses_the_size_guideline` |
| 29 | The offline suite really is offline — in EVERY module that drives `main()` | AC9 | tested | `script::test_approve_exits_0` et al. and `stale::test_a_passing_verdict_clears_its_own_stale_ones` et al., both under the shared `_pr_review_offline.no_real_gh` fixture. **Found by Stage-2 as a live defect** (`_wire` never patched ADR-117's two new boundaries, so every orchestration case shelled out to a real `gh api repos/owner/repo/pulls/42`), then **widened by Stage-3**: the fixture initially lived in one module while a SECOND module kept its own hand-maintained `_wire` and no tripwire — the same list-someone-must-remember failure, reproduced in the same diff. Mutation-verified in both modules; the tripwire raises a `BaseException` because an `AssertionError` is swallowed by the best-effort `except Exception` handlers and proved nothing. |
| 30 | A second producer of the marker namespace anywhere in the repo fails the build | AC3 | tested | `pins::test_the_marker_namespace_has_exactly_one_producer`. Widened on a Stage-2 finding from a non-recursive `scripts/ci/*.py` glob to every git-tracked-or-untracked file, because a workflow step or shell helper emitting the marker would satisfy the ownership predicate unseen. Namespace exclusivity is the ONLY thing closing the residual over-reach vector (a candidate needs a well-formed marker with ANY nonce, plus the shared bot login). |
| 31 | A vendored module excused from the manifest guard is pinned SOMEWHERE, or recorded as knowingly unpinned | AC9 | tested | `pins::test_the_not_hash_pinned_allowlist_and_this_module_agree` — Stage 2 caught the docstring promising "both directions" while asserting one. The reverse now closes over `_KNOWINGLY_UNPINNED`, so a NEW unpinned vendored leaf fails instead of joining a silent backlog. |
| — | A dismissal actually taking effect against **live** GitHub | AC1 | **untestable** | `reason_code: requires-external-nondeterministic-service` — needs a real stale, *marked* change-request on a real PR under the workflow's token. No review in this repository carries a marker yet (P-W2), so this is unreachable until the first Tier-3 PR after merge. F0.5 drove the two READ wrappers and the selector against the live API instead; the write is the one thing that cannot be. |

**Where the confidence is thin, stated plainly.** Everything except F0.5's live
reads is offline. The `PUT …/dismissals` call is verified as *well-formed*
(canonical probe P6's three real 422s) and as *permitted* (P-W1), never as
*effective in this repository*. The first Tier-3 PR after this merges is what
turns those into evidence — and per P-W2 that PR will find nothing to clear,
because nothing carries a marker yet. The blast radius on merge day is therefore
genuinely zero, and grows only over reviews this same code has stamped.

# External plan review — iterate-2026-08-01-pr-review-stale-verdict

- **Mode:** `iterate` · **Provider:** openrouter
- **openai:** `revise` (success) · **gemini:** `unavailable` (degraded —
  provider reported the reply was cut off, `finish_reason=length`)
- **Contradiction:** not comparable (only one reviewer answered)

## Findings (openai)

1. **edge-case / medium — one pre-mutation head read does not close the
   force-push race.** If the head changes between dismissals when several stale
   reviews are selected, a review whose commit becomes current again can still be
   dismissed. Suggests re-reading the head before *each* dismissal and stopping
   the loop on mismatch; concedes a narrow post-read/pre-write race is
   unavoidable because GitHub offers no conditional-dismiss API.

2. **approach / medium — "own marker" is a generic shape plus a shared login.**
   A different workflow using `github-actions[bot]` and the same marker
   convention would satisfy the candidate predicate, contrary to AC3. The nonce
   distinguishes the current *anchor* but does not prove an older *candidate's*
   nonce was minted by this reviewer, because any 32-hex token matches. Asks
   either for a producer-unique namespace, or for the namespace's exclusivity to
   be stated and tested explicitly.

3. **edge-case / low — duplicate anchors are unhandled.** Selecting one
   arbitrarily is unnecessary risk for an irreversible operation. Suggests
   requiring exactly one valid anchor and refusing otherwise.

4. **risk / low — the eventual-consistency no-op can leave a stale block with no
   visible explanation.** Asks that the best-effort report explicitly say no
   dismissal occurred because the just-posted anchor was absent from the listing.

5. **security / low — a write-capable path driven by API-returned data.** Asks
   that subprocess invocation stay argument-based, that review IDs be validated
   as numeric before building the dismissal path, that display sanitisation cover
   every untrusted value reaching logs, and that a test carry ANSI/control
   characters.

> Overall, the split between pure selection, GitHub boundary, and best-effort
> orchestration is sound and appropriately avoids a broad re-vendor. The main
> changes needed are to make the ownership claim match AC3 and to tighten and
> document the unavoidable head-movement race around irreversible dismissals.

## Responses

**The governing constraint is that these files are VENDORED.** The card is
explicit: *"DO NOT SIMPLIFY THE OWNERSHIP RULE — three review rounds narrowed it
and each guard exists for a measured reason."* The inverse holds with equal
force: **hardening it locally is also drift.** A safety rule that exists in two
implementations, differing, is worse than one that is uniformly imperfect —
canonical stays weak, this copy stops being re-vendorable, and the next
re-vendor silently reverts the local hardening without anyone noticing. So a
finding about the *rule* is answered by filing it upstream, and only *additive,
repo-local* guards are added here.

**F1 — accepted as a known residual; NOT changed here.** Upstream reasoned this
exact case and named it: *"The irreducible residual is a force-push landing
inside the dismissal loop; that is bounded by the `PR Review` status being
recorded per commit SHA."* The suggested per-dismissal re-read narrows the window
from N mutations to one but cannot close it (the reviewer says so), costs one API
call per candidate, and introduces a new partial-sweep failure mode when a
mid-loop read fails transiently. Filed as a cross-repo follow-up against
canonical rather than diverged here.

**F2 — the underlying concern is accepted, and it is answered ADDITIVELY.**
The threat requires another `Bot` under the *same login in this same repository*
emitting a whole `<!-- shipwright-pr-review:{32 hex} -->` token as the **last
line** of a review body. Reviews do not cross repositories, so the monorepo's
reviewer and this vendored one can never appear on the same pull request despite
sharing the namespace. The reviewer's own alternative is taken: *"If the existing
marker is already intended to be a repository-wide exclusive namespace, state and
test that exclusivity explicitly."* A new repo-local test
(`test_the_marker_namespace_has_exactly_one_producer`) asserts that exactly one
file under `scripts/ci/` writes the marker. That is a real guard against a second
producer being added later, and it changes no ownership logic.

**F3 — not reachable; no change.** Two anchors requires two reviews carrying the
same 128-bit nonce. The nonce is minted once per run and posted once
(`_post_verdict` calls `post_pr_review_state` a single time), so a duplicate
means either a guessed 128-bit secret or a second post that does not exist. A
"refuse unless exactly one" rule would be a divergence bought with no reachable
case. Recorded, not built.

**F4 — already satisfied; no change.** `select_stale_verdicts` returns the reason
*"this run's own review is not visible on the pull request yet — no verdict was
cleared"*, and `dismiss_own_stale_verdicts` prints it through `_describe` on
every path including the no-op one (pinned by
`test_it_says_why_when_it_dismisses_nothing`). AC8 asks the run to name what it
did and why; it does. Printing the SHAs as well would be a message-string
divergence for no additional diagnosis.

**F5 — already satisfied by the ported design; the tests it asks for are ported
rather than invented.** Every `gh` call is argument-list form with no shell
(`subprocess.run([...])`). Review IDs are coerced through `int()` *inside the
selector* before a candidate is admitted, and a non-integer id is skipped as
`unreadable` — so the value interpolated into the dismissal path is always an
`int`. Sanitisation has one choke point (`_describe` → `strip_display_unsafe`),
and the ANSI/control-character tests the finding asks for are exactly
`test_every_reported_line_is_scrubbed_wherever_the_text_came_from` (both
producers) and `test_control_characters_from_gh_are_made_inert`. Note also that
review *bodies* never reach the log at all — only ids and skip counts do.

## Net effect on the plan

One additive test (F2's namespace-exclusivity guard). No change to the ownership
rule, which is the outcome the card required. F1 and F3 are recorded as upstream
follow-ups.

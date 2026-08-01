# Self-review — iterate-2026-08-01-pr-review-stale-verdict

Seven-point checklist. Findings I raised against my own diff are marked
**[fixed]** where I acted on them before Stage 1.

## 1. Correctness

The ownership rule is a byte-identical port (`sha256` of the canonical LF blob
verified: `5cc9aea3…`), so its correctness is inherited rather than re-derived.
What is genuinely NEW here is the wiring, and its two failure modes are:

- **the anchor never lands** → cleanup looks for a review it did not post. Closed
  by `state_posted`, which is only meaningful because `post_pr_review_state` now
  raises. **[fixed]** — I found mid-build that this wrapper silently discarded
  its `CompletedProcess`, which had also left the pre-existing `except` around it
  dead. Without that fix the whole feature would have been a green-tested no-op.
- **`reviewed_sha` degenerates into "the head just now"** → the three-term guard
  collapses to the two terms that were the original defect. Closed by the
  ordering test, mutation-verified (P-W5.1).

## 2. Spec compliance

AC1–AC9 map to ledger rows 1–28. AC7 initially had **no** row and its
"the run says so" clause had no assertion anywhere — caught by Stage 1, now row
25 plus a new test. Spec Impact NONE is correct: `spec.md` carries no criterion
about the reviewer; the contract lives in CLAUDE.md rule 30.

## 3. Tests

402 pass. Three mutations attempted; **two caught, one NOT** — deleting the
`.strip()` in `_own_marker` failed no behavioural test. I recorded that as a
negative result and did not restate canonical's "load-bearing" claim, because I
could not reproduce it (the preceding `.rstrip()` already absorbs trailing CRLF).
The ledger's citations were also converted to the `alias::test` form the repo's
own citation guard can resolve — before that it matched none of them and passed
having verified nothing.

## 4. Security

The new surface is one **irreversible** mutating call. Reviewed specifically:
- every `gh` invocation is an argument list, never a shell string;
- `review_id` is coerced through `int()` in the selector *before* a candidate is
  admitted, so nothing attacker-shaped reaches the URL path;
- log output has one sanitising choke point, pinned on both producers;
- review **bodies** never reach the log at all — only ids and skip counts;
- the marker is matched `fullmatch` and positionally, so PR-authored text echoed
  by the model cannot manufacture ownership.

Blast radius on merge day is zero: ownership requires our marker and no review in
this repository carries one (P-W2).

## 5. Performance

Two extra `gh` reads on the passing path, a third only when there is something to
dismiss, one `PUT` per stale verdict. Nothing on the blocking path. The
"skipped when nothing to dismiss" behaviour is asserted rather than assumed.

## 6. Conventions

Every module ≤ 300 lines with no baseline exception (AC9), enforced by a new test
because nothing else in CI enforces a *new* crossing here. All files normalised to
LF — the `cp` from the monorepo had carried CRLF into every ported file (P-W6),
which git would have hidden by normalising on commit. Provenance headers state
divergence honestly; the `pr_review.py` header no longer claims byte-identity it
does not have.

## 7. Affected Boundaries

- **`gh` CLI / GitHub REST** — one new mutating endpoint, two new reads.
- **The `PR Review` required status** — unchanged by construction; the dismissal
  runs after the verdict is posted and never reaches the exit code.
- **`scripts/ci/` module boundary** — six functions changed import site; every
  displaced test moved with its assertions unchanged.
- **The repo's vendor-drift guards** — two new entries in `_NOT_HASH_PINNED`,
  paired with real pins in a new module so "not in the manifest" does not quietly
  mean "not pinned". I also discovered the guard keys on a literal marker string,
  so mentioning it in prose enrols the file; recorded in-place.

## Known-weak, stated rather than hidden

The live `PUT …/dismissals` is verified as well-formed and as permitted, never as
effective in this repository — the one untestable ledger row. And per P-W2 this
change does **not** unblock the single PR currently stuck here (#329): its
verdict is unmarked and stamped at the current head, so it needs a manual
dismiss. The benefit is forward-looking only, which is a weaker claim than the
upstream ADR makes and is stated that way deliberately.

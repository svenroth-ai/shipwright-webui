"""The `gh`-CLI boundary for the Tier-3 PR reviewer.

Thin subprocess wrappers only: fetch the PR's diff, post the review comment,
post the review state, and — for clearing this reviewer's superseded verdicts —
read the PR's reviews, read its head SHA, dismiss one review. Split out of
``pr_review.py`` so the tool script keeps to the source-size guideline and the
subprocess surface — the one place where attacker-controlled bytes enter the
process — is its own reviewable module.

The rules about WHICH review may be dismissed are policy and live in
``pr_review_dismiss_select``; this module only makes the calls.

# canonical-source-repo: https://github.com/svenroth-ai/shipwright
# canonical-source-commit: 4146a610295e900d01af3865228a0ec9af028918
# canonical-source-paths:
#   plugins/shipwright-security/scripts/lib/pr_review_gh.py
# canonical-source-version: iterate-2026-07-31-it7a-pr-review-stale-verdict (ADR-117)
#   + iterate-2026-07-27-pr-review-forged-boundary (fetch_pr_diff, post_pr_comment,
#   post_pr_review_state)
# adaptation: PARTIAL VENDOR — deliberately NOT byte-identical, so it carries no
#   canonical-source-hash line (spelled without the leading marker on purpose:
#   `tests/test_accepted_risks_vendored.py` scans for that literal string, so
#   writing it here even in prose would enrol this file in the guard — verified
#   by doing exactly that and watching the reverse-drift test go red). This
#   module is therefore invisible to that guard, which is correct rather than an
#   oversight: this file is
#   webui-SHAPED (it is not a copy of anything, it merges this repo's three
#   pre-existing wrappers with three ported ones), so there is no upstream blob
#   for a pin to compare against. The two files that ARE copies —
#   `pr_review_dismiss_select.py` and `pr_review_dismiss.py` — are pinned in
#   `tests/test_pr_review_vendor_pins.py`.
#
#   The two forged-diff-boundary behaviours the ADR-117 port had left as
#   follow-up are CLOSED here (iterate-2026-07-28-pr-review-parity, merged
#   forward past the ADR-117 port):
#     (a) `fetch_pr_diff` now reads BYTES and decodes without the universal-
#         newline pass, so a lone CR inside a diff hunk can no longer forge a
#         `diff --git` boundary at column 0 and split one file section into two.
#     (b) `post_pr_comment` / `post_pr_review_state` now use `_TEXT`
#         (`encoding="utf-8", errors="replace"`) instead of `text=True`, for the
#         same locale-independence reason the ADR-117 additions below already
#         used it — one `_TEXT` dict now covers every call that carries a body.
"""

from __future__ import annotations

import json
import subprocess

__all__ = ["dismiss_pr_review", "fetch_pr_diff", "fetch_pr_head_sha",
           "list_pr_reviews", "post_pr_comment", "post_pr_review_state"]


# `encoding=` rather than `text=True` on every call that carries a body: a
# review body is model output and always carries non-ASCII (the decision
# badges), and `text=True` decodes with the locale's preferred encoding. On a
# runner whose LC_CTYPE is not UTF-8 that raises, and the caller would then
# report a failure that has nothing to do with the pull request itself.
_TEXT = {"encoding": "utf-8", "errors": "replace"}


def fetch_pr_diff(pr_number: int, repo: str) -> str:
    """Fetch the unified diff for a PR via the `gh` CLI.

    Read as BYTES and decode without newline translation. `text=True` would run
    CPython's universal-newline pass, which rewrites a lone CR to LF **before any
    parser sees it** — and git ends a diff line at LF only. A PR whose own
    content carries a CR could therefore manufacture a line break, and with it a
    counterfeit `diff --git` header at column 0, splitting one real file section
    into two. Everything downstream — the generated-artifact filter, the size
    cap, the file lists shown to the model and to humans — trusts that boundary.
    """
    proc = subprocess.run(
        ["gh", "pr", "diff", str(pr_number), "--repo", repo],
        capture_output=True,
        timeout=120,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(f"`gh pr diff` failed ({proc.returncode}): {err}")
    return proc.stdout.decode("utf-8", "replace")


def post_pr_comment(pr_number: int, repo: str, body: str) -> None:
    """Post the review comment to the PR via `gh pr comment` (stdin body)."""
    proc = subprocess.run(
        ["gh", "pr", "comment", str(pr_number), "--repo", repo, "--body-file", "-"],
        input=body,
        capture_output=True,
        timeout=60,
        **_TEXT,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"`gh pr comment` failed ({proc.returncode}): {proc.stderr.strip()}")


def post_pr_review_state(pr_number: int, repo: str, decision: str, summary: str) -> None:
    """Post a review state (best-effort): block -> request-changes, else -> comment.

    Deliberately never `--approve` (a bot approving its own org's PR is noise and
    can fail). The merge gate is the workflow job's exit code, not this state.
    Never approving is also what makes the stale-verdict cleanup necessary rather
    than optional: an approval WOULD retract an earlier change-request for free,
    and ADR-117 rejected buying the unblock that way.

    THE ONE BEHAVIOUR CHANGE IN THE ADR-117 MOVE, and it is load-bearing. This
    wrapper used to discard the `CompletedProcess` entirely, so it could not
    fail — which left the caller's `except` clause around it dead, and a
    rate-limited or forbidden post looked exactly like a successful one.
    ADR-117 gates the stale-verdict cleanup on whether this reviewer's own
    review actually LANDED (it is the anchor the whole ownership rule is read
    from), so silence here would make that gate a lie: the run would go looking
    for an anchor it never posted. Raising is what lets the caller record
    `state_posted = False` and decline to clear anything.
    """
    norm = (decision or "").strip().lower()
    flag = "--request-changes" if norm == "block" else "--comment"
    body = summary or "Automated Tier-3 review."
    proc = subprocess.run(
        ["gh", "pr", "review", str(pr_number), "--repo", repo, flag, "--body", body],
        capture_output=True,
        timeout=60,
        **_TEXT,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"`gh pr review` failed ({proc.returncode}): {proc.stderr.strip()}")


# ---------------------------------------------------------------------------
# Added by the ADR-117 port — the stale-verdict cleanup's three calls
# ---------------------------------------------------------------------------

def _decode_pages(raw: str) -> list[dict]:
    """Read `gh api --paginate` output, whichever shape it arrives in.

    gh 2.92 merges the pages into ONE array (measured upstream); older releases
    emit one array per page, concatenated. `raw_decode` in a loop reads both.

    `--jq` is not the shorter route here, despite `fetch_pr_head_sha` using it
    below: gh applies the filter PER PAGE, so `--jq '.[]'` returns NDJSON that
    still has to be reassembled line by line. Same amount of parsing, one more
    thing that can be wrong.

    A page that is not an array RAISES. `gh` can exit 0 and hand back an error
    object (`{"message": "Not Found"}`); reading that as "no reviews" is not
    failing safe, it is reporting a PR we could not read as a clean one — and
    the caller would then say "this run's own review is not visible yet", which
    sends the reader looking in the wrong place entirely.

    EMPTY output raises for exactly the same reason, and this is a DELIBERATE
    divergence from canonical (external code review, medium). A pull request
    with no reviews yields the two bytes `[]`, never nothing at all -- so a
    zero-exit, zero-byte answer means `gh` did not tell us what is on the pull
    request, and decoding it to `[]` would land the run in the same wrong-cause
    failure the paragraph above exists to prevent. AC6 asks that an unreadable
    listing be NAMED; "your own review is not visible yet" names the wrong
    thing. Filed upstream rather than kept local-only.
    """
    decoder = json.JSONDecoder()
    items: list[dict] = []
    decoded_any = False
    index, end = 0, len(raw)
    while index < end:
        while index < end and raw[index].isspace():
            index += 1
        if index >= end:
            break
        page, index = decoder.raw_decode(raw, index)
        decoded_any = True
        if not isinstance(page, list):
            raise ValueError(
                f"expected a JSON array of reviews, got {type(page).__name__}")
        items.extend(entry for entry in page if isinstance(entry, dict))
    if not decoded_any:
        raise ValueError(
            "`gh api …/reviews` exited 0 but returned no JSON at all; a pull "
            "request with no reviews returns `[]`, so this is an unreadable "
            "listing rather than an empty one")
    return items


def list_pr_reviews(pr_number: int, repo: str) -> list[dict]:
    """Every review on the PR: `id`, `state`, `commit_id`, `body`, `user`."""
    proc = subprocess.run(
        ["gh", "api", "--paginate", f"repos/{repo}/pulls/{pr_number}/reviews?per_page=100"],
        capture_output=True,
        timeout=60,
        **_TEXT,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"`gh api …/reviews` failed ({proc.returncode}): {proc.stderr.strip()}")
    return _decode_pages(proc.stdout)


def fetch_pr_head_sha(pr_number: int, repo: str) -> str:
    """The PR's CURRENT head. Read fresh: a verdict about a commit that is no
    longer the head has no standing to retract one that might be."""
    proc = subprocess.run(
        ["gh", "api", f"repos/{repo}/pulls/{pr_number}", "--jq", ".head.sha"],
        capture_output=True,
        timeout=60,
        **_TEXT,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"`gh api …/pulls` failed ({proc.returncode}): {proc.stderr.strip()}")
    return proc.stdout.strip()


def dismiss_pr_review(pr_number: int, repo: str, review_id: int, message: str) -> None:
    """Dismiss one review.

    `message` is REQUIRED by the endpoint — probed live upstream: omitting it
    answers `422 "message" wasn't supplied` before any other validation, so a
    wrapper without it would fail every single time. `event=DISMISS` is accepted
    but is not part of the documented request, and the same probe shows the call
    behaves identically without it, so it is not sent.

    `review_id` reaches the URL path, so it must never be attacker-shaped text:
    it is coerced through `int()` in `select_stale_verdicts` before a candidate
    is admitted, and a row whose id will not coerce is skipped as `unreadable`.
    """
    proc = subprocess.run(
        ["gh", "api", "--method", "PUT",
         f"repos/{repo}/pulls/{pr_number}/reviews/{review_id}/dismissals",
         "-f", f"message={message}"],
        capture_output=True,
        timeout=60,
        **_TEXT,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"`gh api …/dismissals` failed ({proc.returncode}): {proc.stderr.strip()}")

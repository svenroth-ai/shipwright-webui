"""Stage 2 posts the right verdict — executed, not string-matched.

Local addition, no upstream counterpart. Sibling of
``test_pr_review_stage2_decide.py`` (resolve + tier); harness in
``_pr_review_shell.py``.

The verdict step is the gate. Everything else in the workflow only decides what
to tell it, and this is the one place where getting it wrong produces a green
status on an unreviewed change — so every branch is executed, including the two
that only occur when an earlier step failed.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pr_review_shell import (  # noqa: E402
    HEAD,
    OTHER,
    REPO,
    RUN_STARTED_AT,
    STAGE2,
    check_runs,
    force_pushes,
    posted_state,
    requires_shell,
    run,
    verdict_body,
)


def _verdict(
    tmp_path,
    *,
    now_sha: str = HEAD,
    timeline: str | None = None,
    checks: str | None = None,
    **env,
):
    base = {
        "REPO": REPO,
        "HEAD_SHA": HEAD,
        "GH_TOKEN": "x",
        "RUN_URL": "https://example.invalid/run/1",
        "RUN_STARTED_AT": RUN_STARTED_AT,
        "PR_NUMBER": "7",
        "STAGE1_CONCLUSION": "success",
        "NEEDS_REVIEW": "true",
        "TIER_REASON": "sensitive path touched",
        "TIER_OUTCOME": "success",
        "REVIEW_OUTCOME": "success",
    }
    base.update(env)
    return run(
        verdict_body(),
        tmp_path,
        base,
        head_sha__txt=now_sha + "\n",
        timeline__json=timeline if timeline is not None else force_pushes(),
        check_runs__json=checks if checks is not None else check_runs("CI", "CodeQL"),
    )


@pytest.mark.parametrize(
    "env, expect_state, expect_rc",
    [
        ({}, "success", 0),
        ({"REVIEW_OUTCOME": "failure"}, "failure", 1),
        ({"REVIEW_OUTCOME": "skipped"}, "failure", 1),
        ({"NEEDS_REVIEW": "false", "REVIEW_OUTCOME": "skipped"}, "success", 0),
        ({"STAGE1_CONCLUSION": "failure"}, "failure", 1),
        ({"TIER_OUTCOME": "failure", "NEEDS_REVIEW": ""}, "failure", 1),
        # The resolve step refused: no PR number, so the head re-check is
        # skipped and the tier never ran — this must still post failure, not
        # crash on the unset variable.
        ({"PR_NUMBER": "", "TIER_OUTCOME": "skipped", "NEEDS_REVIEW": ""}, "failure", 1),
    ],
)
def test_verdict_branches(tmp_path, env, expect_state, expect_rc):
    requires_shell()
    rc, _, console, statuses = _verdict(tmp_path, **env)
    assert statuses, f"nothing posted — the gate would sit pending. console={console}"
    assert posted_state(statuses) == expect_state
    assert "context=PR Review" in " ".join(statuses).replace('"', "")
    assert rc == expect_rc


def test_verdict_says_nothing_when_stage1_was_cancelled(tmp_path):
    """A superseded run must not speak at all — not even to fail.

    `cancel-in-progress` cancels only OVERLAPPING runs. A superseded stage-2
    run whose `workflow_run` event is delivered after its successor has already
    finished is never cancelled, so `!cancelled()` does not silence it, and it
    would post `failure` over the live `success` on the same SHA — a spurious
    permanent red that only a manual re-run clears. Silence is safe here for
    the same reason it is safe everywhere else in this workflow: an absent
    context is `pending`, which blocks, and the successor is already speaking.
    """
    requires_shell()
    rc, _, console, statuses = _verdict(tmp_path, STAGE1_CONCLUSION="cancelled")
    assert rc == 0
    assert statuses == [], "a superseded run must post nothing at all"
    assert "superseded" in console


def test_verdict_fails_closed_when_the_head_moved(tmp_path):
    """A force-push mid-run means the review describes different code.

    The diff was fetched by PR number (a moving target); the verdict lands on
    the immutable event SHA. Without this re-check a later restore of that SHA
    would inherit a green earned by code that is no longer there.
    """
    requires_shell()
    rc, _, console, statuses = _verdict(tmp_path, now_sha=OTHER)
    assert rc == 1
    assert posted_state(statuses) == "failure"
    assert "head moved during the run" in console
    assert "re-run required" in " ".join(statuses)


def test_verdict_fails_closed_on_an_a_b_a_force_push(tmp_path):
    """The race a SHA comparison cannot see, and the reason the timeline is read.

    Force-push A -> B -> A: the reviewer fetches by PR NUMBER and is served B's
    diff, the head is back at A by the time the verdict re-reads it, and a
    head-equality check therefore passes while the review describes different
    code. Upstream stops at that check; this asks whether the branch was
    force-pushed AT ALL since stage 1 began.
    """
    requires_shell()
    rc, _, console, statuses = _verdict(
        tmp_path,
        now_sha=HEAD,  # restored — equality alone would bless it
        timeline=force_pushes("2026-07-31T10:04:00Z"),
    )
    assert rc == 1, "an A->B->A force-push must not collect a green"
    assert posted_state(statuses) == "failure"
    assert "force-push" in console


def test_verdict_ignores_a_force_push_from_before_this_run(tmp_path):
    """Only movement DURING the run invalidates it.

    Every PR that was ever force-pushed carries a timeline entry; treating those
    as disqualifying would fail such a PR forever.
    """
    requires_shell()
    rc, _, _, statuses = _verdict(
        tmp_path, timeline=force_pushes("2026-07-31T09:00:00Z")
    )
    assert rc == 0
    assert posted_state(statuses) == "success"


@pytest.mark.parametrize(
    "failing_call, expect_description",
    [
        ("pulls/7", "could not verify head"),
        ("timeline", "could not verify branch history"),
    ],
)
def test_verdict_distinguishes_unreadable_from_moved(
    tmp_path, failing_call, expect_description
):
    """A transient API failure is not a force-push.

    Both fail closed, but reporting "head moved during review" for a 502 sends
    the maintainer hunting a force-push that never happened.
    """
    requires_shell()
    rc, _, _, statuses = _verdict(tmp_path, GH_FAIL=failing_call)
    assert rc == 1
    assert posted_state(statuses) == "failure"
    assert expect_description in " ".join(statuses)


def test_verdict_lands_on_the_immutable_event_sha(tmp_path):
    """Never on whatever the head happens to be at posting time."""
    requires_shell()
    _, _, _, statuses = _verdict(tmp_path)
    assert HEAD in " ".join(statuses)
    assert OTHER not in " ".join(statuses)


def test_verdict_step_is_silent_when_cancelled():
    """`always()` would let a SUPERSEDED run overwrite the live one's verdict.

    **A SHAPE guard**: the harness runs `run:` bodies and never evaluates an
    `if:`, so this only reads the expression — `${{ success() || cancelled() }}`
    would pass it and still post from a cancelled run. It catches the realistic
    regression (`always()` returning); the behavioural half is
    `test_verdict_says_nothing_when_stage1_was_cancelled`.

    `always()` evaluates true even for a cancelled job, so the concurrency
    group would stop the older run doing more WORK but not stop it POSTING —
    and a waiver-granted `success` from run A could land after run B replaced
    it. `!cancelled()` keeps every diagnostic branch (a stage 1 that merely
    FAILED does not cancel this job) while making the superseded run silent,
    which leaves the context absent, which blocks.
    """
    body = STAGE2.read_text(encoding="utf-8")
    condition = re.search(r"name: Post the PR Review verdict\s*\n\s*if:\s*(.+)", body)
    assert condition, "verdict step must carry an explicit `if:`"
    assert "cancelled()" in condition.group(1), (
        f"verdict step must not post from a cancelled run; got {condition.group(1)!r}"
    )
    assert not re.fullmatch(r"always\(\)", condition.group(1).strip()), (
        "bare `always()` posts from a cancelled run — use `${{ !cancelled() }}`"
    )


def test_stage2_has_exactly_two_status_producers():
    """One producer of the context, or it is ambiguous.

    **A SHAPE guard reading RAW text** — the anti-pattern
    `_pr_review_workflows.py` warns about, accepted here because counting call
    sites is what it must do. Cost: `/statuses/` in one more COMMENT fails the
    build. If it false-fails, reword the comment, do not loosen the count.

    Two call sites are expected and both are the same verdict: the stale-head
    early exit and the normal post. A third would be a second opinion racing
    the first.
    """
    posts = re.findall(r"/statuses/", STAGE2.read_text(encoding="utf-8"))
    assert len(posts) == 2, (
        "expected exactly the stale-head post and the verdict post; another "
        f"producer of `PR Review` makes the context ambiguous (found {len(posts)})"
    )


def test_verdict_refuses_when_a_second_producer_claims_the_context(tmp_path):
    """Stage 1 runs from the PR head, so its job names are contributor-chosen.

    Renaming one to `PR Review` mints a passing CHECK RUN under the required
    name — a second producer of the context whose result the reviewee controls.
    Whether branch protection would prefer that check run or this workflow's
    commit status is precisely the ambiguity not to depend on, so the presence
    of any other claimant is itself disqualifying. The vendored
    `test_stage1_owns_no_pr_review_context` guard cannot be the last line here:
    it runs from the contributor's head too.
    """
    requires_shell()
    rc, _, console, statuses = _verdict(
        tmp_path, checks=check_runs("CI", "PR Review", "CodeQL")
    )
    assert rc == 1, "a competing `PR Review` check run must not be blessed"
    assert posted_state(statuses) == "failure"
    assert "second producer" in " ".join(statuses)
    assert "only permitted producer" in console


def test_verdict_is_unbothered_by_other_check_runs(tmp_path):
    """Only the required name is policed — every other check is none of our business."""
    requires_shell()
    rc, _, _, statuses = _verdict(
        tmp_path, checks=check_runs("CI", "Reviewer Selftest", "Prepare review request")
    )
    assert rc == 0
    assert posted_state(statuses) == "success"



def test_verdict_fails_closed_when_the_force_push_count_is_not_a_number(tmp_path):
    """`[ "$forced" -ne 0 ]` failed OPEN, in the step whose job is to fail closed.

    Reachable, not theoretical: `jq` given empty input exits 0 and prints
    NOTHING, so `forced=""` while the `elif !` guard above sees a clean exit.
    `[ "" -ne 0 ]` then exits 2 with "integer expression expected", which inside
    `A || B` reads as FALSE — control falls through and blesses a commit whose
    branch history was never established. A string comparison rejects the same
    input. Same class as the command-substitution finding, opposite corner.
    """
    requires_shell()
    rc, _, _, statuses = _verdict(tmp_path, timeline="")
    assert rc == 1, "an unreadable force-push count must not be blessed"
    assert posted_state(statuses) == "failure"


def test_verdict_refuses_without_a_force_push_lower_bound(tmp_path):
    """An empty `run_started_at` would red every force-pushed PR, silently.

    `created_at >= ""` is true for EVERY timeline entry, so the guard would
    report a mid-run force-push on any branch that was ever force-pushed —
    which, in this repo, is every iterate branch. Fail on the missing input
    instead: loud and once, rather than quiet and forever.
    """
    requires_shell()
    rc, _, console, statuses = _verdict(tmp_path, RUN_STARTED_AT="")
    assert rc != 0
    assert statuses == [], "must not post a verdict it cannot justify"
    assert "run_started_at" in console

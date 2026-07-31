"""The review gate cannot be bypassed by size, by crash, or by waiver.

Vendored from the canonical monorepo (``shared/tests/test_pr_review_fail_closed.py``,
shipwright#437) and re-pointed at this repo's two workflows.

Sibling module: ``test_pr_review_fork_trust.py`` covers the other half — that a
credentialed stage 2 trusts nothing the contributor controls. Shared readers
live in ``_pr_review_workflows.py``; assertions here read parsed structure, not
raw text, because these workflows document the holes they close.

Three fail-open paths are pinned shut, each of which let a change reach ``main``
with the required ``PR Review`` context green and no review performed:

1. **Size.** A reviewer that skips above a diff threshold and *succeeds* means
   the largest changes pass by not being reviewed. The vendored reviewer here
   already fails closed (``pr_review.py`` forces ``block`` on a truncated diff
   and returns ``EXIT_BLOCK``); these tests stop that regressing.
2. **Crash.** The reviewer's exit code discarded (``|| true``), or output that
   would not parse returning normally.
3. **Waiver.** ``skip-pr-review`` waiving review on any PR, including one
   editing the checks themselves — whoever unlocks a door is not the one who
   decides it may be unlocked.

Stage 1 owning no verdict is what makes the whole thing fail closed: the
required context is a commit status posted by stage 2, so an absent verdict
leaves it ``pending``, which blocks. Silence counts as not passing. (GitHub
scores a *skipped* job as a *successful* required check, which is why a guarded
job could never be the producer — and was exactly this repo's bug.)
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pr_review_workflows import (  # noqa: E402
    ALL_STAGE1,
    ALL_STAGE2,
    job_conditions,
    jobs,
    load,
    run_bodies,
    shell_code,
    text,
)

# --------------------------------------------------------------------------
# 1. Size / crash / unparseable output — the gate fails closed
# --------------------------------------------------------------------------


@pytest.mark.parametrize("path", ALL_STAGE1 + ALL_STAGE2)
def test_reviewer_exit_code_is_never_discarded(path: Path) -> None:
    """``|| true`` after the reviewer turns a crash into a green gate."""
    assert "|| true" not in shell_code(path), (
        f"{path.name}: `|| true` discards the reviewer's exit code, so a "
        f"crashed review reports as a pass. Let it fail."
    )


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_oversize_diff_fails_instead_of_skipping(path: Path) -> None:
    """The largest changes are exactly the ones that must not skip.

    **This is a WORKFLOW-shape guard, not the behavioural test**, and external
    review was right to call the assertion weak on its own: it only proves the
    workflow can still fail, which stops a `continue-on-error` or a
    skip-and-succeed step being reintroduced around the reviewer.

    The BEHAVIOUR — an over-threshold diff is reviewed truncated and then
    blocks — lives in the reviewer, and is tested there against a real
    over-limit diff: `test_pr_review_script.py::test_truncation_fails_closed_needs_human`
    asserts `rc == EXIT_BLOCK` and a forced `block` state, and
    `test_pr_review_lib.py::TestTruncateDiff` covers the boundary. Do not read
    this test as covering that; read the two together.
    """
    body = run_bodies(path)
    assert "exit 1" in body, (
        f"{path.name}: no failing exit anywhere — an over-threshold diff must "
        f"fail the job, not skip the review and succeed."
    )
    lowered = body.lower()
    if "diff_size" in lowered or "max_diff" in lowered:
        assert "exit 1" in body, f"{path.name}: size check does not fail closed"


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_unparseable_review_output_fails_closed(path: Path) -> None:
    """'No valid output' is an absent review, not a passing one.

    Same division of labour as the oversize guard above: this pins the
    WORKFLOW (no step that logs a message about unparseable output and returns
    normally). The behaviour is tested where it lives —
    `test_pr_review_script.py::test_json_parse_fail_exits_2_and_dumps_raw`
    (exit 2 on a response that will not parse) and
    `test_pr_review_lib.py::test_invalid_json_raises` — and stage 2 maps that
    non-zero outcome to `PR Review = failure`, which
    `test_pr_review_stage2_verdict.py::test_verdict_branches` executes.
    """
    assert "skipping comment" not in text(path).lower(), (
        f"{path.name}: unparseable review output must fail the job, not log "
        f"a message and return normally."
    )


# --------------------------------------------------------------------------
# 2. Stage 1 — runs everywhere, holds nothing, owns no verdict
# --------------------------------------------------------------------------


@pytest.mark.parametrize("path", ALL_STAGE1)
def test_stage1_holds_no_secret(path: Path) -> None:
    """An untrusted change is never handed the keys."""
    assert "secrets." not in text(path), (
        f"{path.name}: stage 1 runs on fork PRs and must reference no secret. "
        f"Credentials belong to stage 2, which never runs contributor code."
    )


@pytest.mark.parametrize("path", ALL_STAGE1)
def test_stage1_is_not_fork_guarded(path: Path) -> None:
    """The fork guard is what made the gate skip, and skip means pass."""
    assert "head.repo.full_name" not in job_conditions(path), (
        f"{path.name}: a fork guard here skips the job, and GitHub scores a "
        f"skipped job as a successful required check — the exact hole."
    )


@pytest.mark.parametrize("path", ALL_STAGE1)
def test_stage1_records_the_change_for_audit(path: Path) -> None:
    """Stage 1 still captures what it saw — as evidence, not as input."""
    assert "upload-artifact" in text(path), (
        f"{path.name}: stage 1 must record the change as an artifact"
    )
    assert "pr-review-request/pr.diff" in shell_code(path), (
        f"{path.name}: stage 1 must record the diff it saw"
    )


@pytest.mark.parametrize("path", ALL_STAGE1)
def test_stage1_owns_no_pr_review_context(path: Path) -> None:
    """Two producers of one context is the documented ambiguity."""
    for job_id, job in jobs(path).items():
        name = (job.get("name") or job_id).strip()
        assert name.lower() not in ("pr review", "claude code review"), (
            f"{path.name}: job {job_id!r} is named {name!r}, which re-creates "
            f"the required context in stage 1. The verdict is stage 2's "
            f"commit status; stage 1 must not emit a check under that name."
        )


@pytest.mark.parametrize("path", ALL_STAGE1)
def test_stage1_carries_no_policy(path: Path) -> None:
    """Policy in stage 1 is policy the contributor can edit.

    Stage 1 runs from the PR head. A tier or waiver rule living here reads as
    enforcement while being entirely under the reviewee's control — worse than
    no rule, because it looks like one.
    """
    assert "skip-pr-review" not in shell_code(path), (
        f"{path.name}: the waiver rule must live in stage 2, which runs from "
        f"the default branch — a contributor cannot edit that."
    )


@pytest.mark.parametrize("path", ALL_STAGE1)
def test_stage1_re_decides_when_a_label_is_removed(path: Path) -> None:
    """A waiver that cannot be revoked is not a waiver, it is a hole.

    Local addition, not in the upstream shape. ``labeled`` re-runs the gate
    when ``skip-pr-review`` is APPLIED; without ``unlabeled`` nothing re-runs
    when it is taken away, so the green status earned under the waiver simply
    stays and the change merges unreviewed.
    """
    on = load(path).get(True) or load(path).get("on") or {}
    types = ((on.get("pull_request") or {}).get("types")) or []
    assert "labeled" in types and "unlabeled" in types, (
        f"{path.name}: pull_request types must include BOTH `labeled` and "
        f"`unlabeled`; got {types!r}"
    )


# --------------------------------------------------------------------------
# 3. Least privilege — only the posting job may widen
# --------------------------------------------------------------------------


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_stage2_top_level_token_is_read_only(path: Path) -> None:
    top = load(path).get("permissions")
    assert isinstance(top, dict) and top, f"{path.name}: no top-level permissions"
    writes = [k for k, v in top.items() if str(v) == "write"]
    assert not writes, (
        f"{path.name}: top-level must stay read-only; found writes {writes}"
    )


# --------------------------------------------------------------------------
# 4. The gate cannot exempt itself
# --------------------------------------------------------------------------


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_waiver_cannot_cover_a_change_to_the_checks(path: Path) -> None:
    """Whoever unlocks a door is not the one who decides it may be.

    Checked on STAGE 2, because that is where the waiver is now evaluated. In
    stage 1 the rule would be worthless: the contributor owns that file.
    """
    body = text(path)
    if "skip-pr-review" not in body:
        pytest.skip("no waiver label in this workflow")
    assert ".github/workflows/" in body, (
        f"{path.name}: `skip-pr-review` must not waive review on a change that "
        f"edits the checks themselves — the waiver has to be qualified by the "
        f"sensitive paths."
    )

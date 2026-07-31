"""A credentialed stage 2 trusts nothing the contributor controls.

Vendored from the canonical monorepo (``shared/tests/test_pr_review_fork_trust.py``,
shipwright#437) and re-pointed at this repo's two workflows.

Sibling module: ``test_pr_review_fail_closed.py`` covers the other half — that
the gate cannot be bypassed by size, crash or waiver. Shared readers live in
``_pr_review_workflows.py``.

``workflow_run`` grants secrets and a writable token to a run whose input is
attacker-influenced, which is the only way a pull request raised from a fork can
be reviewed at all (GitHub withholds secrets from fork-raised ``pull_request``
runs). That trust is also the danger, and the rules below are what make it safe:

1. never check out the PR head — the contributor's code is read, never run;
2. nothing stage 1 emitted is authoritative. ``pull_request`` runs stage 1 FROM
   THE PR HEAD, so the contributor controls its metadata and the diff it
   uploads;
3. identity comes from the trusted ``workflow_run`` event, not the artifact;
4. an ambiguous or moved head fails closed rather than being guessed at.

Rules 2 and 4 are here because the first upstream draft got them wrong. It
honoured an artifact-supplied ``needs_review`` flag — letting a pull request
declare itself exempt and collect a green status — and reviewed the artifact's
diff, so a forged upload would have had benign code reviewed while different
code merged. It also resolved the PR with ``[0]`` from the commit's PR list, and
never re-checked the head before posting. All four were caught in external
review before merge. These tests are what stop them coming back.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pr_review_workflows import (  # noqa: E402
    ALL_STAGE2,
    jobs,
    load,
    shell_code,
    text,
)

# --------------------------------------------------------------------------
# 1. Chained to stage 1, and never running the contributor's code
# --------------------------------------------------------------------------


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_stage2_is_triggered_by_workflow_run(path: Path) -> None:
    on = load(path).get(True) or load(path).get("on") or {}
    assert "workflow_run" in on, (
        f"{path.name}: stage 2 must be triggered by the completion of stage 1, "
        f"which is what grants it credentials the fork run never had."
    )


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_stage2_names_stage1_exactly(path: Path) -> None:
    """A renamed stage 1 would silently never trigger the review."""
    on = load(path).get(True) or load(path).get("on") or {}
    named = ((on.get("workflow_run") or {}).get("workflows")) or []
    assert "PR Review Prepare" in named, (
        f"{path.name}: workflow_run must name stage 1 exactly; got {named!r}"
    )


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_stage2_never_checks_out_contributor_code(path: Path) -> None:
    """The pwn-request rule: read the diff, never run the code."""
    for job in jobs(path).values():
        for step in job.get("steps") or []:
            if not isinstance(step, dict):
                continue
            if "actions/checkout" not in str(step.get("uses") or ""):
                continue
            ref = str((step.get("with") or {}).get("ref") or "")
            assert "workflow_run" not in ref and "head" not in ref.lower(), (
                f"{path.name}: checkout pins {ref!r} — stage 2 holds secrets "
                f"and must check out the base repo only, never the PR head."
            )


# --------------------------------------------------------------------------
# 2. Identity and content come from trusted sources, never the artifact
# --------------------------------------------------------------------------


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_stage2_checkout_does_not_persist_credentials(path: Path) -> None:
    """This job holds an LLM key and a token that can write the verdict.

    A default `actions/checkout` leaves the Actions token in the local git
    credential helper. Nothing here uses it — `gh` authenticates from
    ``GH_TOKEN`` — so persisting it only widens the blast radius of a future
    edit to the reviewer.
    """
    checkouts = [
        step
        for job in jobs(path).values()
        for step in (job.get("steps") or [])
        if isinstance(step, dict) and "actions/checkout" in str(step.get("uses") or "")
    ]
    assert checkouts, f"{path.name}: expected a checkout step"
    for step in checkouts:
        assert (step.get("with") or {}).get("persist-credentials") is False, (
            f"{path.name}: checkout must set `persist-credentials: false`"
        )


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_stage2_serialises_runs_for_one_head(path: Path) -> None:
    """An older run must not overwrite a newer verdict for the same commit.

    Label churn, a re-run, or a rapid synchronize can put two stage-2 runs in
    flight for one SHA. Without a concurrency group keyed on the trusted head
    SHA, the slower one posts last and its stale verdict becomes the effective
    status — the gate would then reflect whichever run happened to finish
    second, not the current policy.
    """
    group = str((load(path).get("concurrency") or {}).get("group") or "")
    assert "workflow_run.head_sha" in group, (
        f"{path.name}: concurrency group must key on the trusted head SHA; "
        f"got {group!r}"
    )
    assert (load(path).get("concurrency") or {}).get("cancel-in-progress") is True, (
        f"{path.name}: an in-flight older run for the same head must be cancelled"
    )


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_stage2_takes_identity_from_the_trusted_event(path: Path) -> None:
    """A forged artifact must not redirect a verdict onto another PR."""
    assert "github.event.workflow_run" in text(path), (
        f"{path.name}: the PR number and head SHA must come from the trusted "
        f"workflow_run event, never from the downloaded artifact."
    )


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_stage2_never_reviews_the_artifact(path: Path) -> None:
    """The trust rule, and the reason this module exists.

    If stage 2 reviewed the uploaded diff, a fork could upload a benign diff,
    have that reviewed, and collect a green status for entirely different code.
    """
    code = shell_code(path)
    assert "pr-review-request/pr.diff" not in code, (
        f"{path.name}: reviews the artifact diff — a contributor controls "
        f"stage 1 and can forge it. Fetch the diff from the API instead."
    )
    assert "needs_review" not in code or "gh api" in code, (
        f"{path.name}: a tier decision must be derived from API data here, "
        f"never read from stage 1's artifact."
    )


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_stage2_reads_changed_paths_from_the_api(path: Path) -> None:
    """The sensitive-path rule is only as trustworthy as its input.

    Paginated on purpose: a sensitive file beyond the first page of
    ``pulls/{n}/files`` would otherwise be invisible to the tier rule, and the
    change would classify as Tier 1/2 and skip review.
    """
    code = shell_code(path)
    assert "/files" in code, (
        f"{path.name}: changed paths must be read from the API, not from stage 1"
    )
    assert "--paginate" in code, (
        f"{path.name}: the changed-file list must be paginated — a sensitive "
        f"path on page 2 would silently fail to trigger a review"
    )


# --------------------------------------------------------------------------
# 3. Ambiguity and movement fail closed
# --------------------------------------------------------------------------


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_stage2_refuses_an_ambiguous_pull_request(path: Path) -> None:
    """One commit can belong to several open PRs.

    Taking the first would let stage 2 review PR A's diff and post a green
    status onto a SHA that satisfies PR B's gate. Ambiguity is
    indistinguishable from an attack, so it must fail closed rather than pick.
    """
    code = shell_code(path)
    assert "head.sha == $sha" in code, (
        f"{path.name}: the resolved PR's head must equal the trusted event SHA"
    )
    assert "-ne 1 " in code, (
        f"{path.name}: must require EXACTLY one match and fail closed on zero "
        f"or many, rather than selecting one"
    )


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_stage2_paginates_the_associated_pull_requests(path: Path) -> None:
    """Local hardening over upstream, and the reason it matters.

    Upstream reads only page 1 of ``commits/{sha}/pulls``. A second matching
    open PR beyond the page boundary would collapse a TWO-match ambiguity into
    an apparent unique match — defeating the check above in precisely the case
    it exists to refuse. ``--slurp`` wraps the pages, so the jq filter must
    flatten them.
    """
    code = shell_code(path)
    assert re.search(r"--paginate\s+--slurp", code), (
        f"{path.name}: the associated-PR lookup must be paginated and slurped"
    )
    assert ".[][]" in code, (
        f"{path.name}: `--slurp` yields an array of PAGES; the filter must "
        f"flatten with `.[][]` or it will count pages, not pull requests"
    )


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_stage2_rechecks_the_head_before_blessing_it(path: Path) -> None:
    """A force-push mid-run means the review describes different code.

    The diff is fetched by PR number (a moving target) while the verdict lands
    on the immutable event SHA. Without a re-check, a later restore of that SHA
    would inherit a green status earned by code that is no longer there.
    """
    assert "head moved during the run" in shell_code(path), (
        f"{path.name}: must re-verify the head SHA before posting success"
    )


# --------------------------------------------------------------------------
# 4. The verdict reaches the humans who decide
# --------------------------------------------------------------------------


@pytest.mark.parametrize("path", ALL_STAGE2)
def test_stage2_posts_the_verdict_onto_the_change(path: Path) -> None:
    """Not left in the log of a run nobody opens."""
    body = text(path)
    assert "statuses" in body, f"{path.name}: must post the commit status"
    assert re.search(r'context="(PR Review|Claude Code Review)"', body), (
        f"{path.name}: must post the required context by name — it is the sole "
        f"producer, and an absent status blocks the merge"
    )

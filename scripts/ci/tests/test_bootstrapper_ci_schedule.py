"""The weekly schedule on ci.yml — policy guard, BOTH directions.

The cron exists for ONE reason: the marketplace-manifest contract drifts without
any pull request in THIS repo, so a PR-only gate would surface the breakage only
by coincidence. That makes two things worth ratcheting, and the reverse one is
the easily-forgotten half.

FORWARD — the schedule exists, and the bootstrapper job is reachable on it.
REVERSE — every OTHER job opts out. Without this half, the "bootstrapper only,
weekly" decision rots the first time someone adds a job: the schedule silently
widens to the whole suite, including the visual-regression gate, whose baselines
drift with the pinned browser image and would mail a red result every Monday for
reasons unrelated to the installer.

Three distinct ways to leave a weekly run that executes NOTHING and reports
success are covered here, because each was found separately and none is visible
in review: an `if:` on the exempt job, a `needs:` on it (a job whose dependency
skipped is itself skipped), and — in the sibling module — `continue-on-error`.

See ``bootstrapper_ci_shape.py`` for the shared reader and the deliberately
conservative ``excludes_schedule`` policy.
"""

from __future__ import annotations

import pytest

from bootstrapper_ci_shape import (
    CI_YML,
    JOB_ID,
    PR_ONLY_JOBS,
    SCHEDULE_ELIGIBLE,
    excludes_schedule,
    triggers,
    workflow,
)


@pytest.fixture(scope="module")
def doc() -> dict:
    return workflow(CI_YML)


@pytest.fixture(scope="module")
def jobs(doc: dict) -> dict:
    return doc["jobs"]


def test_ci_runs_on_a_weekly_schedule(doc: dict) -> None:
    schedule = triggers(doc).get("schedule")
    assert schedule, (
        "ci.yml has no `schedule:` trigger. The marketplace-manifest contract "
        "drifts without any PR in this repo, so a PR-only gate would surface it "
        "only by coincidence."
    )
    crons = [entry.get("cron") for entry in schedule if isinstance(entry, dict)]
    assert any(isinstance(c, str) and c.strip() for c in crons), f"no usable cron in {schedule!r}"


def test_the_bootstrapper_job_is_the_one_that_runs_on_the_schedule(jobs: dict) -> None:
    """The exempt job must NOT gate itself out — else the weekly run does nothing.

    Asserted as "carries no `if:` at all" rather than "carries a safe `if:`",
    because an innocent-looking condition (`== 'push'`) excludes the cron just as
    effectively as an explicit `!= 'schedule'`. If a condition is ever genuinely
    needed here, that is a deliberate decision and this test should be updated
    with it. (Stage-2 review: the old substring form passed on `== 'push'`.)
    """
    job = jobs[JOB_ID]
    assert "if" not in job, (
        f"`{JOB_ID}` grew an `if:` ({job.get('if')!r}). It is the ONLY job the "
        "weekly cron runs — any condition risks a green weekly run that executed "
        "nothing. Update this test deliberately if the condition is intended."
    )


def test_the_bootstrapper_job_cannot_be_skipped_by_a_dependency(jobs: dict) -> None:
    """`needs:` is the other way to empty the weekly run, and it is silent.

    On a `schedule` event every other job is skipped by its `if:`. A job whose
    `needs:` target skipped is itself skipped — so `needs: [server-checks]` here
    would make the cron run ZERO jobs and report success. ci.yml's comment claims
    "no job here uses needs:"; this is what keeps that claim true.
    (Stage-2 review finding.)
    """
    job = jobs[JOB_ID]
    assert "needs" not in job, (
        f"`{JOB_ID}` declares needs: {job.get('needs')!r}. Every other job is "
        "schedule-gated, so a dependency makes this one skip on the cron too and "
        "the weekly run silently does nothing."
    )


def test_every_other_job_opts_out_of_the_weekly_schedule(jobs: dict) -> None:
    unguarded = []
    for job_id, body in jobs.items():
        if job_id in SCHEDULE_ELIGIBLE:
            continue
        condition = str(body.get("if", ""))
        if not excludes_schedule(condition, pr_only_ok=job_id in PR_ONLY_JOBS):
            unguarded.append(job_id)

    assert not unguarded, (
        "These ci.yml jobs would also run on the weekly cron: "
        + ", ".join(sorted(unguarded))
        + ". The schedule exists only to re-probe the live marketplace manifest. "
        "Add `if: github.event_name != 'schedule'` to each (or, if the job is "
        "genuinely meant to run weekly, add it to SCHEDULE_ELIGIBLE and say why "
        "in the workflow)."
    )


def test_the_pr_only_exemption_is_still_earned(jobs: dict) -> None:
    """A job exempted as PR-only must actually still be PR-only.

    `PR_ONLY_JOBS` grants `== 'pull_request'` as a schedule exclusion for named
    jobs. If such a job later drops that condition, the grant must not keep
    covering it silently.
    """
    for job_id in PR_ONLY_JOBS:
        if job_id not in jobs:
            continue
        condition = " ".join(str(jobs[job_id].get("if", "")).split())
        assert "pull_request" in condition, (
            f"`{job_id}` is listed in PR_ONLY_JOBS but its `if:` is {condition!r}. "
            "Either restore the pull_request condition or remove the exemption."
        )


def test_the_schedule_cannot_cancel_a_push_to_main_run(doc: dict) -> None:
    """`github.ref` is `refs/heads/main` for BOTH a push to main and the cron.

    With `cancel-in-progress: true` and a ref-only concurrency group the two
    share a slot and cancel each other — a Monday cron killing an in-flight
    push-to-main CI run, or being killed by one and quietly skipping the manifest
    probe for a week. Found by the Stage-1 spec review of the change that
    introduced the schedule.
    """
    concurrency = doc.get("concurrency", {})
    group = str(concurrency.get("group", ""))
    if not concurrency.get("cancel-in-progress"):
        return  # no cancellation, no collision
    assert "github.event_name" in group, (
        f"concurrency group {group!r} keys only on the ref, so the weekly "
        "schedule and a push to main share a slot and cancel each other."
    )


def test_the_exempt_sets_are_not_vacuous(jobs: dict) -> None:
    """Guards the guards: a renamed job must not silently empty an exempt set."""
    missing = SCHEDULE_ELIGIBLE - set(jobs)
    assert not missing, f"SCHEDULE_ELIGIBLE names jobs that do not exist: {sorted(missing)}"
    stale = PR_ONLY_JOBS - set(jobs)
    assert not stale, f"PR_ONLY_JOBS names jobs that do not exist: {sorted(stale)}"

"""Shared reading + schedule policy for the bootstrapper CI guards.

NOT a test module and NOT vendored — it carries no provenance header, so
``test_accepted_risks_vendored.py``'s reverse-drift guard ignores it (that guard
also skips ``tests/`` outright). Mirrors the role ``accepted_risks_paths.py``
plays for the accepted-risk guards, and imports that module's workflow reader
rather than re-writing it: it carries the YAML-1.1 ``on:``-becomes-``True``
normalisation and the bare-``!expr`` ConstructorError explanation, both of which
are easy to rediscover the hard way.

Split out of ``test_bootstrapper_ci_job.py`` in the same iterate that wrote it,
when the review-driven additions pushed that module past the 300-line cap. The
seam is the one its own sections already drew: the JOB's shape
(``test_bootstrapper_ci_job.py``) versus the SCHEDULE's policy
(``test_bootstrapper_ci_schedule.py``).
"""

from __future__ import annotations

from accepted_risks_paths import REPO_ROOT, triggers, workflow

__all__ = [
    "CI_YML",
    "JOB_ID",
    "JOB_NAME",
    "PR_ONLY_JOBS",
    "REPO_ROOT",
    "SCHEDULE_ELIGIBLE",
    "WORKDIR",
    "excludes_schedule",
    "runs",
    "steps",
    "triggers",
    "workflow",
]

CI_YML = REPO_ROOT / ".github" / "workflows" / "ci.yml"

JOB_ID = "bootstrapper-checks"
JOB_NAME = "Bootstrapper (type + lint + test)"
WORKDIR = "bootstrapper"

#: Jobs allowed to run on the weekly cron. Exactly one, by decision.
SCHEDULE_ELIGIBLE = {JOB_ID}

#: Jobs excluded from the cron by being PR-ONLY rather than by `!= 'schedule'`.
#:
#: Listed by job id rather than blessing `== 'pull_request'` for everyone
#: (Stage-3 doubt review): a "cleanup" that rewrote `server-checks` to
#: `== 'pull_request'` would otherwise pass this guard while silently stopping
#: the server suite from running on pushes to main. Adding a job here is a
#: deliberate act with a visible diff.
PR_ONLY_JOBS = {"diff-coverage"}

#: The only `if:` form that excludes the schedule without narrowing anything else.
_EXCLUDING_FRAGMENTS = ("!= 'schedule'", '!= "schedule"')

#: A positive mention of `schedule` re-admits it no matter what else is present.
_ADMITS_SCHEDULE = ("== 'schedule'", '== "schedule"')

_PR_ONLY_FRAGMENTS = ("== 'pull_request'", '== "pull_request"')


def steps(job: dict) -> list[dict]:
    return [s for s in job.get("steps", []) if isinstance(s, dict)]


def runs(job: dict) -> list[str]:
    return [s["run"].strip() for s in steps(job) if isinstance(s.get("run"), str)]


def excludes_schedule(condition: str, *, pr_only_ok: bool = False) -> bool:
    """Does this `if:` provably not fire on a `schedule` event?

    Conservative on purpose — it answers False whenever it cannot be sure, so an
    unrecognised condition fails the guard loudly instead of passing quietly:

    * an explicit `== 'schedule'` anywhere re-admits the schedule;
    * a disjunction (`||`) can re-admit it through the other branch, so any `||`
      is treated as unsafe even when one side excludes;
    * otherwise `!= 'schedule'` must be present — or, only for a job listed in
      ``PR_ONLY_JOBS``, `== 'pull_request'`.

    A conjunction (`&&`) IS permitted, and deliberately so: `&&` can only ever
    NARROW an already-excluding condition, so it cannot re-admit the schedule.
    Only `||` can. (Asymmetry raised by the Tier-3 PR review.)
    """
    normalized = " ".join(condition.split())
    if not normalized:
        return False
    if any(token in normalized for token in _ADMITS_SCHEDULE):
        return False
    if "||" in normalized:
        return False
    accepted = _EXCLUDING_FRAGMENTS + (_PR_ONLY_FRAGMENTS if pr_only_ok else ())
    return any(token in normalized for token in accepted)

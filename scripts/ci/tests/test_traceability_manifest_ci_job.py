"""The `Traceability manifest (gate)` job's shape — guard.

Sub-iterate w1 (campaign req3-06-mechanics-webui). Mirrors
`test_bootstrapper_ci_job.py`'s pattern: workflows are PARSED, never
substring-scanned, so a commented-out step or a stray `continue-on-error`
cannot hide from these tests the way it can from a human skim.

Two things are worth ratcheting here, same split as the bootstrapper guard:

* the job's shape (this module) — does it run the right steps, with no silent
  escape hatch (`continue-on-error`, a step-level `if:`)?
* the schedule policy — covered by the EXISTING
  `test_bootstrapper_ci_schedule.py::test_every_other_job_opts_out_of_the_weekly_schedule`,
  which already asserts every job not in `SCHEDULE_ELIGIBLE` excludes
  `schedule`. No new module needed for that half; this job's `if:` was written
  specifically to satisfy that guard (see the inline comment in ci.yml).
"""

from __future__ import annotations

import pytest

from accepted_risks_paths import REPO_ROOT, workflow

CI_YML = REPO_ROOT / ".github" / "workflows" / "ci.yml"
JOB_ID = "traceability-manifest"
JOB_NAME = "Traceability manifest (gate)"

#: Pinned upstream commit for the second, cross-repo checkout. Not asserted
#: against a specific value here (that would make every re-pin a failing test
#: for no safety gain) — only that it IS a 40-char hex SHA, never a mutable ref.
_HEX40 = frozenset("0123456789abcdef")


def _steps(job: dict) -> list[dict]:
    return [s for s in job.get("steps", []) if isinstance(s, dict)]


@pytest.fixture(scope="module")
def job() -> dict:
    jobs = workflow(CI_YML)["jobs"]
    assert JOB_ID in jobs, (
        f"ci.yml has no `{JOB_ID}` job — the traceability manifest has no CI "
        "enforcement at all without it."
    )
    return jobs[JOB_ID]


def test_the_job_is_named_exactly_what_a_future_ruleset_would_need(job: dict) -> None:
    assert job.get("name") == JOB_NAME


def test_the_job_excludes_pull_request_and_schedule(job: dict) -> None:
    """PUSH-only by design: iterate PRs never carry a regenerated manifest
    (`derived_snapshots.py`'s `TEST_TRACEABILITY`), so gating `pull_request` on
    it would make every ordinary iterate PR red for a reason it structurally
    cannot fix. See the comment above this job in ci.yml for the full rationale.

    Asserts the EXACT expected form, not just substring presence (external
    code review, 2026-09-06, medium severity): a condition using `||` instead
    of `&&` between the two negations — e.g.
    `event_name != 'schedule' || event_name != 'pull_request'` — is a tautology
    (always true, since no single event can equal both), so it would silently
    re-admit BOTH excluded triggers while still containing both substrings.
    """
    condition = " ".join(str(job.get("if", "")).split())
    assert condition == (
        "github.event_name != 'schedule' && github.event_name != 'pull_request'"
    ), f"unexpected `if:` on `{JOB_ID}`: {condition!r}"


def test_nothing_makes_the_job_green_regardless_of_its_steps(job: dict) -> None:
    assert job.get("continue-on-error") in (None, False), (
        f"`{JOB_ID}` sets continue-on-error; a stale manifest would then never "
        "fail the build, which is the entire point of this job."
    )
    swallowing = [s.get("name", "<unnamed>") for s in _steps(job) if s.get("continue-on-error")]
    assert not swallowing, f"steps swallow their own failure: {swallowing}"
    conditional = [s.get("name", "<unnamed>") for s in _steps(job) if "if" in s]
    assert not conditional, (
        f"steps carry an `if:` and could skip while the job stays green: {conditional}"
    )


def test_the_pinned_checkout_targets_a_full_commit_sha(job: dict) -> None:
    """A version tag (`@v1`, `ref: main`) is still mutable — only a 40-char SHA
    clears the `github-actions-mutable-action-tag` posture this repo otherwise
    holds every third-party reference to (CLAUDE.md DO-NOT #25)."""
    checkouts = [
        s for s in _steps(job)
        if str(s.get("uses", "")).startswith("actions/checkout@")
        and s.get("with", {}).get("repository")
    ]
    assert checkouts, f"`{JOB_ID}` never checks out the shipwright-compliance plugin"
    ref = str(checkouts[0]["with"].get("ref", ""))
    assert len(ref) == 40 and set(ref.lower()) <= _HEX40, (
        f"pinned `ref:` {ref!r} is not a full 40-char commit SHA"
    )
    assert checkouts[0]["with"].get("repository") == "svenroth-ai/shipwright"


def test_the_pinned_checkout_is_sparse_to_the_needed_paths(job: dict) -> None:
    checkouts = [
        s for s in _steps(job)
        if str(s.get("uses", "")).startswith("actions/checkout@")
        and s.get("with", {}).get("repository")
    ]
    sparse = str(checkouts[0]["with"].get("sparse-checkout", ""))
    assert "plugins/shipwright-compliance" in sparse
    assert "shared/scripts" in sparse


def test_setup_uv_is_sha_pinned(job: dict) -> None:
    uv_steps = [s for s in _steps(job) if str(s.get("uses", "")).startswith("astral-sh/setup-uv@")]
    assert uv_steps, f"`{JOB_ID}` never installs uv"
    ref = str(uv_steps[0]["uses"]).split("@", 1)[1]
    assert len(ref) == 40 and set(ref.lower()) <= _HEX40, f"setup-uv ref {ref!r} is not SHA-pinned"


def test_the_job_runs_the_gate_script(job: dict) -> None:
    """A SINGLE step's `run:` must invoke the gate script via `uv run`/`python`
    with both required flags — external code review, 2026-09-06, low
    severity: concatenating every step's `run:` before matching would let an
    unrelated step's substrings (or a step replaced with `echo ...` echoing
    the same text) satisfy this test without the script ever executing."""
    gate_steps = [
        s["run"] for s in _steps(job)
        if isinstance(s.get("run"), str) and "scripts/ci/traceability_manifest_gate.py" in s["run"]
    ]
    assert gate_steps, f"`{JOB_ID}` never runs the gate script"
    assert len(gate_steps) == 1, f"`{JOB_ID}` runs the gate script in more than one step: {gate_steps}"
    run_text = gate_steps[0]
    assert "uv run" in run_text and "python" in run_text, (
        f"gate script step does not invoke it via `uv run ... python`: {run_text!r}"
    )
    assert "--plugin-root" in run_text
    assert "--project-root" in run_text

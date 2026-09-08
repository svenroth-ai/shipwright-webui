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

iterate-2026-09-08-manifest-regen-finalization split the original single job
into TWO (doubt-reviewer, 2026-09-08, medium severity): this module covers
only `traceability-manifest`, the read-only job that checks out the pinned
third-party plugin and computes the regen. The sibling write-scoped job
(`traceability-manifest-regen-pr`) is covered by
`test_traceability_manifest_regen_pr_ci_job.py`.
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


#: The one step allowed to swallow its own failure (iterate-2026-09-08-manifest-
#: regen-finalization, trg-1324dfc4) — see the job's own `ADVISORY, not a hard
#: fail` comment in ci.yml for why. Named explicitly so a SECOND, unnoticed
#: `continue-on-error` elsewhere in this job still fails this test.
_ADVISORY_STEP = "Regenerate + diff the traceability manifest"

#: This job's only conditional step — uploads the fresh regen for the sibling
#: `traceability-manifest-regen-pr` job to pick up, gated on the advisory
#: step's own (pre-swallow) outcome.
_UPLOAD_STEP = "Upload fresh regen for the regen-PR job"


def test_the_job_no_longer_hard_fails_main_but_nothing_else_is_silent(job: dict) -> None:
    """Reversed from this job's original "nothing makes the job green
    regardless of its steps" guard: five, then seven, "regenerate stale
    traceability manifest" repair commits proved a hard `push` gate on this
    exact class fires on nearly every PR that adds a test, manufacturing
    traffic instead of catching defects (trg-1324dfc4). The `Regenerate +
    diff` step is now DELIBERATELY allowed to swallow its own failure via
    `continue-on-error` — but that must stay the ONLY escape hatch in this
    job, named exactly, with the upload step's `if:` wired to its (pre-
    swallow) `outcome`, not a free-floating condition."""
    assert job.get("continue-on-error") in (None, False), (
        f"`{JOB_ID}` sets continue-on-error at the JOB level; the advisory "
        "behaviour is scoped to one named step, never the whole job."
    )

    by_name = {s.get("name", "<unnamed>"): s for s in _steps(job)}

    swallowing = [name for name, s in by_name.items() if s.get("continue-on-error")]
    assert swallowing == [_ADVISORY_STEP], (
        f"expected exactly the advisory step {_ADVISORY_STEP!r} to swallow its own "
        f"failure, found: {swallowing}"
    )
    assert by_name[_ADVISORY_STEP].get("id") == "gate", (
        f"{_ADVISORY_STEP!r} must carry `id: gate` — the upload step's `if:` (and "
        "the sibling job's own `if:`) reads `steps.gate.outcome`"
    )

    conditional = [name for name, s in by_name.items() if "if" in s]
    assert conditional == [_UPLOAD_STEP], (
        f"expected exactly {_UPLOAD_STEP!r} to carry an `if:`, found: {conditional}"
    )
    condition = " ".join(str(by_name[_UPLOAD_STEP]["if"]).split())
    assert condition == "steps.gate.outcome == 'failure'", (
        f"unexpected `if:` on {_UPLOAD_STEP!r}: {condition!r} — must read the RAW "
        "`outcome`, not `conclusion` (continue-on-error forces conclusion to "
        "'success' regardless, which would make this condition never fire)"
    )


def test_the_job_exposes_the_gate_outcome_as_a_job_output(job: dict) -> None:
    """The sibling `traceability-manifest-regen-pr` job gates its own `if:` on
    this, since a downstream job cannot read another job's `steps.*`
    directly."""
    assert job.get("outputs") == {"gate_outcome": "${{ steps.gate.outcome }}"}, (
        f"`{JOB_ID}` must expose `steps.gate.outcome` as a job output exactly "
        f"named `gate_outcome` — got: {job.get('outputs')}"
    )


def test_the_job_has_no_write_permissions(job: dict) -> None:
    """The job that checks out and imports the pinned third-party plugin must
    never also hold write scopes (doubt-reviewer, 2026-09-08, medium
    severity) — it should inherit the workflow's read-only top-level default,
    not carry its own `permissions:` override. The write scopes live only on
    the sibling job, which never touches the pinned plugin."""
    assert job.get("permissions") is None, (
        f"`{JOB_ID}` must not set its own `permissions:` — it should stay on "
        f"the read-only top-level default. Got: {job.get('permissions')}"
    )


def test_the_advisory_step_writes_a_fresh_manifest_for_the_upload_step(job: dict) -> None:
    run_text = str(next(
        s["run"] for s in _steps(job) if s.get("name") == _ADVISORY_STEP
    ))
    assert "--write-fresh" in run_text


def test_the_upload_step_uploads_the_gate_steps_own_written_artifact(job: dict) -> None:
    step = next(s for s in _steps(job) if s.get("name") == _UPLOAD_STEP)
    assert str(step.get("uses", "")).startswith("actions/upload-artifact@")
    assert step.get("with", {}).get("name") == "fresh-traceability-manifest"


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


def test_both_checkouts_do_not_persist_credentials(job: dict) -> None:
    """Neither checkout step performs a git operation, and third-party Python
    from the pinned checkout runs in this same job — no reason for
    GITHUB_TOKEN to sit in either checkout's `.git/config` (external code
    review, 2026-09-06, low severity)."""
    checkouts = [s for s in _steps(job) if str(s.get("uses", "")).startswith("actions/checkout@")]
    assert len(checkouts) == 2, f"expected exactly 2 checkout steps, found {len(checkouts)}"
    for step in checkouts:
        assert step.get("with", {}).get("persist-credentials") is False, (
            f"checkout step {step.get('name', '<unnamed>')!r} does not set "
            "persist-credentials: false"
        )


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
    assert "--locked" in run_text, (
        "`uv run` should be `--locked` — the pinned plugin ships a uv.lock; "
        "without this flag, a lock/pyproject drift at the pinned commit "
        "silently re-resolves fresh third-party dependencies instead of "
        "failing the step (external code review, 2026-09-06 round 2, low "
        "severity)"
    )

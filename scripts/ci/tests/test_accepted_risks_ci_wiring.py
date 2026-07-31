"""Is the accepted-risk gate wired, armed, and disarmed by nothing?

Split out of `test_accepted_risks_repo_invariants.py` when it crossed the
300-line cap (iterate-2026-07-31-revendor-accepted-risk-gate). Siblings:
`test_accepted_risks_repo_invariants.py` (the suppression channels this repo
uses) and `test_accepted_risks_ignorefile_shape.py` (will Trivy apply the ignore
file). Shared helpers live in `accepted_risks_paths.py`.

AC-4 was originally recorded as covered by `test_workflow_token_permissions` /
the workflow-shape tests. It was not: the former asserts only security.yml's
TOP-LEVEL permissions block, the latter reads only pr-review.yml. (S1-4.)
"""

from __future__ import annotations

from pathlib import Path

from accepted_risks_paths import (
    PR_REVIEW_YML,
    SECURITY_YML,
    commands,
    runs,
    steps,
    triggers,
    workflow,
)

#: `if:` values GitHub evaluates that are legal to leave on a gate step.
_ALLOWED_STEP_IF = {"${{ !cancelled() }}"}

#: Every test module the gate job must execute. Derived from disk rather than
#: hardcoded, so a FOURTH module cannot be silently left off the way the split
#: in iterate-2026-07-31-revendor-accepted-risk-gate could have left two off.
_TESTS_DIR = Path(__file__).resolve().parent


def _required_test_files() -> set[str]:
    return {p.name for p in _TESTS_DIR.glob("test_accepted_risks*.py")}


def test_the_gate_job_is_wired_and_runs_both_subcommands() -> None:
    doc = workflow(SECURITY_YML)
    cmds = commands(doc, "accepted-risks")
    for cmd in (
        "python scripts/ci/accepted_risks_cli.py check --project-root .",
        "python scripts/ci/accepted_risks_cli.py expire --project-root .",
    ):
        assert any(ln.startswith(cmd) for ln in cmds), (
            f"the accepted-risks job no longer runs: {cmd}\n"
            f"command lines found: {cmds}"
        )
    assert any(
        ln.startswith("pip install") and "pyyaml" in ln.lower() for ln in cmds
    ), "the gate job must install PyYAML, or every path exits 2"

    # A gate whose failure does not fail the run is not a gate. `continue-on-error`
    # appears three times elsewhere in this same file, so it is the local idiom
    # for "do not let this block" - which makes it the likeliest disarm.
    # (Stage-3 doubt review, D-3.)
    job = doc["jobs"]["accepted-risks"]
    assert not job.get("continue-on-error"), (
        "the accepted-risks job must not set continue-on-error - it would run "
        "both subcommands, report success, and leave every test here green"
    )
    for step in steps(doc, "accepted-risks"):
        assert not step.get("continue-on-error"), (
            f"gate step {step.get('name')!r} must not set continue-on-error"
        )
        cond = step.get("if")
        assert cond is None or cond in _ALLOWED_STEP_IF, (
            f"gate step {step.get('name')!r} carries an unexpected `if: {cond!r}`. "
            "A step-level `if: github.event_name == ...` disarms the gate on the "
            f"scheduled run exactly as a job-level one would. Allowed: {_ALLOWED_STEP_IF}"
        )


def test_the_gate_job_also_runs_these_invariants() -> None:
    """The gate must carry its own backstops on EVERY trigger it runs on.

    `pytest scripts/ci/tests` otherwise runs only in pr-review.yml's selftest
    job, which is `pull_request`-only - so on the weekly scheduled run, the
    trigger the whole design turns on, none of the fail-open invariants would
    execute. `main` is not branch-protected, so a direct push deleting the
    register never passes through selftest either. (Stage-2 review, CR-3.)

    The same argument one level down covers `test_accepted_risks_vendored.py`:
    the next steps EXECUTE the vendored modules, so the guards proving those
    bytes are the vendored bytes must run on the same triggers, or a scheduled
    run executes code whose integrity was last checked whenever the last PR
    landed. (Stage-3 doubt review, D-5.)

    Satisfied by running the whole `scripts/ci/tests` directory — which is what
    the job does, and is drift-proof: a new module is covered on the day it is
    written, with no list to remember to update.
    """
    job_runs = runs(workflow(SECURITY_YML), "accepted-risks")
    pytest_runs = [r for r in job_runs if "pytest" in r]
    assert pytest_runs, (
        "the accepted-risks job runs no pytest step, so none of this repo's "
        "fail-open invariants are enforced on the scheduled trigger - the one "
        "this job lives in security.yml for."
    )
    blob = "\n".join(pytest_runs)
    if "scripts/ci/tests" in blob and not any(
        n in blob for n in _required_test_files()
    ):
        return  # whole-directory run: covers every module, present and future
    missing = sorted(n for n in _required_test_files() if n not in blob)
    assert not missing, (
        "the accepted-risks job does not run these accepted-risk test modules: "
        f"{missing}.\nEither name them, or (preferred) run the whole directory:\n"
        "    python -m pytest scripts/ci/tests -q\n"
        "Otherwise they are enforced on pull_request only, and the scheduled run "
        "has none of them."
    )


def test_the_gate_job_runs_on_a_schedule_and_is_not_event_gated() -> None:
    """Pinned as BEHAVIOUR: a job-level `if:` would silently un-schedule it."""
    doc = workflow(SECURITY_YML)
    assert "schedule" in triggers(doc), (
        "security.yml lost its schedule trigger - `expire` is time-based, so a "
        "PR-only gate would never fire on an entry that lapses during a quiet week"
    )
    job = doc["jobs"]["accepted-risks"]
    assert "if" not in job, (
        "the accepted-risks job must not carry a job-level `if:` - an "
        "`if: github.event_name == 'pull_request'` would leave the workflow's "
        f"schedule intact while disarming the gate on it. Found: {job.get('if')!r}"
    )


def test_the_gate_job_does_not_inherit_write_scopes() -> None:
    """It reads a checked-out tree; it must not carry the SARIF job's writes."""
    perms = workflow(SECURITY_YML)["jobs"]["accepted-risks"].get("permissions")
    assert perms == {"contents": "read"}, (
        "the accepted-risks job must declare `permissions: {contents: read}`; "
        "security.yml's top-level block grants security-events: write and "
        f"pull-requests: write for the SARIF job. Found: {perms!r}"
    )


def test_the_selftest_job_installs_pyyaml() -> None:
    """`Reviewer Selftest` runs the drift guard, which needs PyYAML.

    Without it, five contract tests get exit 2 instead of 0/1 and the job is RED
    unconditionally - at which point it can no longer distinguish a real
    vendored-file edit from baseline. Verified by running that job's exact
    command with pytest alone: 5 failed. (S1-1.)
    """
    selftest_runs = runs(workflow(PR_REVIEW_YML), "selftest")
    installs = [r for r in selftest_runs if "pip install" in r and "pyyaml" in r.lower()]
    assert installs, (
        "pr-review.yml's selftest job must have a `pip install ... pyyaml` step - "
        "`pytest scripts/ci/tests` now covers the accepted-risk gate's contract "
        "tests. A comment mentioning PyYAML is not an install."
    )

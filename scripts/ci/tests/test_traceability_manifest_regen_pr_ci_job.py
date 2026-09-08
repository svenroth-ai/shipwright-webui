"""The `traceability-manifest-regen-pr` job's shape — guard.

iterate-2026-09-08-manifest-regen-finalization, trg-1324dfc4. This job holds
the write permissions (`contents: write`, `pull-requests: write`) needed to
open the drift-fix PR; the sibling `traceability-manifest` job (covered by
`test_traceability_manifest_ci_job.py`) stays read-only and computes the
regen. Split into two jobs on doubt-reviewer feedback (2026-09-08, medium
severity): a single job holding both the write scopes AND a checkout/import
of the pinned third-party `shipwright-compliance` plugin would let anything
reachable from that import graph poison `$GITHUB_ENV`/`$GITHUB_PATH` for a
later step already holding write credentials ("poisoned pipeline execution").
This job never checks out that plugin — see
`test_the_job_never_checks_out_the_pinned_third_party_plugin` below, which is
the test that would fail first if that boundary ever eroded.
"""

from __future__ import annotations

import pytest

from accepted_risks_paths import REPO_ROOT, workflow

CI_YML = REPO_ROOT / ".github" / "workflows" / "ci.yml"
JOB_ID = "traceability-manifest-regen-pr"
JOB_NAME = "Traceability manifest (open regen PR)"
GATE_JOB_ID = "traceability-manifest"

#: The step that opens/refreshes the fix PR. No longer conditional at the
#: step level (that gating moved to this job's own `if:`, since the job it
#: depends on is now a separate job whose `steps.*` are not readable here).
_FOLLOWUP_STEP = "Open a regen PR when the manifest drifted"

#: Deliberately allowed to swallow failure — "no artifact" (an infra failure
#: upstream, not real drift) is a legitimate, handled outcome inside
#: `_FOLLOWUP_STEP` itself, not something that should fail this job.
_DOWNLOAD_STEP = "Download fresh regen"


def _steps(job: dict) -> list[dict]:
    return [s for s in job.get("steps", []) if isinstance(s, dict)]


@pytest.fixture(scope="module")
def job() -> dict:
    jobs = workflow(CI_YML)["jobs"]
    assert JOB_ID in jobs, (
        f"ci.yml has no `{JOB_ID}` job — a detected drift has nothing that "
        "opens the fix PR."
    )
    return jobs[JOB_ID]


def test_the_job_is_named_exactly_what_a_future_ruleset_would_need(job: dict) -> None:
    assert job.get("name") == JOB_NAME


def test_the_job_needs_the_gate_job_and_is_gated_on_its_outcome(job: dict) -> None:
    assert job.get("needs") == GATE_JOB_ID, (
        f"`{JOB_ID}` must `needs: {GATE_JOB_ID}` — got: {job.get('needs')}"
    )
    condition = " ".join(str(job.get("if", "")).split())
    assert condition == (
        f"needs.{GATE_JOB_ID}.outputs.gate_outcome == 'failure' && "
        "github.event_name != 'schedule'"
    ), f"unexpected job-level `if:` on `{JOB_ID}`: {condition!r}"


def test_the_job_never_checks_out_the_pinned_third_party_plugin(job: dict) -> None:
    """The whole point of the job split — see the module docstring. This is
    the test that fails first if the boundary ever erodes back into one job."""
    third_party = [
        s for s in _steps(job)
        if str(s.get("uses", "")).startswith("actions/checkout@")
        and s.get("with", {}).get("repository")
    ]
    assert third_party == [], (
        f"`{JOB_ID}` must not check out any third-party repository, found: {third_party}"
    )


def test_the_job_grants_only_the_write_scopes_the_followup_step_needs(job: dict) -> None:
    assert job.get("permissions") == {"contents": "write", "pull-requests": "write"}, (
        f"`{JOB_ID}` permissions must be exactly contents+pull-requests write "
        f"(least-privilege for the auto-PR step) — got: {job.get('permissions')}"
    )


def test_the_job_has_a_concurrency_group_so_pushes_cannot_race(job: dict) -> None:
    """Doubt-reviewer, 2026-09-08, medium severity: the stale-run guard inside
    the step re-checks `main`'s remote tip immediately before pushing, but
    that check and the eventual push are still separated by several shell
    lines, and the top-level `concurrency: cancel-in-progress` only cancels
    the WORKFLOW (a run already past the check can still finish) — so two
    individually-valid checks could still race on which push lands last. A
    job-scoped `concurrency:` here serializes the whole job, closing the gap
    instead of merely narrowing it."""
    assert job.get("concurrency") == {
        "group": "traceability-regen-pr",
        "cancel-in-progress": False,
    }, f"unexpected `concurrency:` on `{JOB_ID}`: {job.get('concurrency')}"


def test_the_followup_step_never_attempts_to_merge(job: dict) -> None:
    """Auto-merging would need a PAT/App credential this repo does not
    provision (GITHUB_TOKEN-opened PRs don't trigger the other required
    `pull_request` checks) — see the step's own comment. This guards against
    that boundary quietly eroding in a later edit."""
    run_text = str(next(
        s["run"] for s in _steps(job) if s.get("name") == _FOLLOWUP_STEP
    ))
    for forbidden in ("pr merge", "--auto", "--admin"):
        assert forbidden not in run_text, (
            f"{_FOLLOWUP_STEP!r} must never attempt to merge ({forbidden!r} found) "
            "— see its own comment for why that needs a different credential"
        )


def test_the_followup_step_never_force_pushes_blind(job: dict) -> None:
    """Doubt-reviewer, 2026-09-08, low severity: a bare `git push --force`
    would silently discard a human's manual commit to the bot-owned branch.
    Must use `--force-with-lease` against a freshly re-read remote SHA (or a
    plain, non-forcing push on the branch's first creation), never a bare
    `--force`."""
    run_text = str(next(
        s["run"] for s in _steps(job) if s.get("name") == _FOLLOWUP_STEP
    ))
    assert "--force-with-lease=" in run_text, (
        f"{_FOLLOWUP_STEP!r} must force-push with `--force-with-lease=<ref>:<expect>`, "
        "not a bare --force"
    )
    assert " --force " not in f" {run_text} " and not run_text.strip().endswith("--force"), (
        f"{_FOLLOWUP_STEP!r} must not also contain a bare `--force` push"
    )


def test_the_followup_step_uses_only_the_default_token(job: dict) -> None:
    step = next(s for s in _steps(job) if s.get("name") == _FOLLOWUP_STEP)
    env = step.get("env", {})
    assert env.get("GH_TOKEN") == "${{ secrets.GITHUB_TOKEN }}", (
        f"{_FOLLOWUP_STEP!r} must authenticate with the default GITHUB_TOKEN only "
        f"— found env: {env}"
    )


def test_the_job_downloads_the_artifact_the_gate_job_uploaded(job: dict) -> None:
    step = next((s for s in _steps(job) if s.get("name") == _DOWNLOAD_STEP), None)
    assert step is not None, f"`{JOB_ID}` never downloads the gate job's artifact"
    assert str(step.get("uses", "")).startswith("actions/download-artifact@")
    assert step.get("with", {}).get("name") == "fresh-traceability-manifest"
    assert step.get("continue-on-error") is True, (
        f"{_DOWNLOAD_STEP!r} must tolerate a missing artifact (the infra-failure "
        "case, handled inside the followup step itself) rather than fail the job"
    )


def test_the_jobs_checkout_does_not_persist_credentials(job: dict) -> None:
    checkouts = [s for s in _steps(job) if str(s.get("uses", "")).startswith("actions/checkout@")]
    assert len(checkouts) == 1, f"expected exactly 1 checkout step, found {len(checkouts)}"
    assert checkouts[0].get("with", {}).get("persist-credentials") is False, (
        "this job's checkout does not set persist-credentials: false — it "
        "authenticates explicitly via `gh auth setup-git` instead"
    )

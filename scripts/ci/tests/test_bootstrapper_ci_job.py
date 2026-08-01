"""The bootstrapper CI job's shape — guard.

WHY THIS EXISTS AT ALL, AND WHY HERE (iterate-2026-08-01-bootstrapper-ci-contract).

`bootstrapper/` is the published npm package @svenroth-ai/shipwright, the widest
blast radius in this repo. Its job in ``ci.yml`` lands ADVISORY by decision
(prove first, then arm — mirroring the #205 diff-coverage rollout), which means
GitHub will happily merge a PR that deletes it. This module narrows that window:
``scripts/ci/tests`` is executed by the ``Reviewer Selftest`` job, whose failure
makes stage 1's conclusion non-success, which makes stage 2 post
``PR Review = failure`` — and ``PR Review`` is a required context (DO-NOT #30).

WHAT THAT DOES AND DOES NOT BUY (Stage-3 doubt review — do not overstate it):
an ACCIDENTAL shape regression is caught from day one. A DELIBERATE removal is
not: stage 1 runs FROM THE PR HEAD, so a PR deleting the job *and* this file
passes every deterministic check, and only the Tier-3 LLM review — forced
because ``.github/workflows/`` and ``scripts/ci/`` are sensitive paths — stands
in the way. Note also that nothing in this repo can verify ``Reviewer Selftest``
is actually listed in ``main-protection``; that is a GitHub Settings object, and
the same footnote applies to the diff-coverage gate (ci.yml).

The schedule policy lives in ``test_bootstrapper_ci_schedule.py``; shared
reading in ``bootstrapper_ci_shape.py``. Workflows are PARSED, never
substring-scanned: a commented-out `run:` line must fail these tests, and a scan
cannot tell the difference.
"""

from __future__ import annotations

import subprocess

import pytest

from bootstrapper_ci_shape import (
    CI_YML,
    JOB_ID,
    JOB_NAME,
    REPO_ROOT,
    WORKDIR,
    runs,
    steps,
    workflow,
)

#: Every file the job must actually run. Each is load-bearing and separately
#: deletable, so each is named (Stage-2 re-review): the live probe is the
#: contract, and the two offline suites are what keep the skip path from
#: quietly widening on the days the live probe cannot run.
CONTRACT_FILES = (
    "marketplace-contract.test.mjs",
    "marketplace-contract-probe.test.mjs",
    "marketplace-contract-rules.test.mjs",
)


@pytest.fixture(scope="module")
def job() -> dict:
    jobs = workflow(CI_YML)["jobs"]
    assert JOB_ID in jobs, (
        f"ci.yml has no `{JOB_ID}` job. The bootstrapper is the published npm "
        "package; without this job its whole suite runs in CI never."
    )
    return jobs[JOB_ID]


def test_the_job_is_named_exactly_what_the_ruleset_would_need(job: dict) -> None:
    """The display name IS the contract with `main-protection`'s required checks.

    Renaming it silently un-arms the check on the day someone finally arms it.
    """
    assert job.get("name") == JOB_NAME


def test_the_job_runs_in_the_bootstrapper_workspace(job: dict) -> None:
    assert job.get("defaults", {}).get("run", {}).get("working-directory") == WORKDIR


def test_the_job_runs_install_typecheck_lint_and_tests_in_order(job: dict) -> None:
    """The four checks, in this order — and `npm test` with NO trailing `--run`.

    That last detail is a live copy-paste trap: client/ and server/ script `test`
    as bare `vitest` (watch mode) and so MUST append `-- --run`. This package
    already scripts `vitest run`; appending `--run` passes an unknown flag to the
    `run` subcommand, and the failure reads as a broken test rather than a bad
    flag. The exact-list assertion below covers it — a separate `--run` test
    would be unfalsifiable, since any such flag breaks this equality first.
    """
    observed = runs(job)
    assert observed == ["npm ci", "npx tsc --noEmit", "npm run lint", "npm test"], (
        "The four checks must run, in this order, and `npm test` must carry no "
        "`-- --run` (this package's script is already `vitest run`). Got: " + repr(observed)
    )


def test_nothing_makes_the_job_green_regardless_of_its_steps(job: dict) -> None:
    """`continue-on-error` would silently un-arm this job the day it is armed.

    ci.yml already records that REMOVING continue-on-error is necessary but not
    sufficient for a gate; this is the other direction — re-adding it must not be
    possible without a test going red. A step-level `if:` is the third member of
    the same class: `if: false` on the test step leaves the `run:` list intact
    and the job green. (Stage-2 review findings.)
    """
    assert job.get("continue-on-error") in (None, False), (
        f"`{JOB_ID}` sets continue-on-error; it would report success no matter "
        "what its steps do."
    )
    swallowing = [s.get("name", "<unnamed>") for s in steps(job) if s.get("continue-on-error")]
    assert not swallowing, f"steps swallow their own failure: {swallowing}"
    conditional = [s.get("name", "<unnamed>") for s in steps(job) if "if" in s]
    assert not conditional, (
        f"steps carry an `if:` and could skip while the job stays green: {conditional}"
    )


def test_node_is_pinned_to_the_packages_declared_floor(job: dict) -> None:
    setup = [s for s in steps(job) if str(s.get("uses", "")).startswith("actions/setup-node@")]
    assert len(setup) == 1, "expected exactly one setup-node step"
    assert str(setup[0].get("with", {}).get("node-version")) == "20"


def test_the_npm_cache_is_keyed_on_the_bootstrappers_own_lockfile(job: dict) -> None:
    """A cache-dependency-path pointing at another workspace restores the wrong
    tree and turns `npm ci` into a coin flip."""
    setup = [s for s in steps(job) if str(s.get("uses", "")).startswith("actions/setup-node@")]
    with_block = setup[0].get("with", {})
    assert with_block.get("cache") == "npm"
    assert with_block.get("cache-dependency-path") == "bootstrapper/package-lock.json"


def test_the_job_checks_out_the_WHOLE_repo(job: dict) -> None:
    """The suite is NOT self-contained, so the checkout must not be narrowed.

    `bootstrapper/test/guards.test.mjs` asserts version parity by reading
    `../server/package.json`. A `sparse-checkout:` limiting this job to
    `bootstrapper/` — an obvious-looking speed-up — fails that test with a
    confusing ENOENT. Found empirically at F0.5 by running the job's steps
    against a bootstrapper-only tree.
    """
    checkouts = [s for s in steps(job) if str(s.get("uses", "")).startswith("actions/checkout@")]
    assert checkouts, "the job never checks out the repo"
    narrowing = [k for s in checkouts for k in s.get("with", {}) if "sparse" in k]
    assert not narrowing, (
        f"checkout is narrowed by {narrowing}; the bootstrapper suite reads "
        "../server/package.json and would fail with ENOENT."
    )


# ── what the job is there to run ────────────────────────────────────────────


@pytest.mark.parametrize("filename", CONTRACT_FILES)
def test_the_contract_tests_exist(filename: str) -> None:
    """The job (and the weekly cron) are only worth their minutes with these."""
    path = REPO_ROOT / "bootstrapper" / "test" / filename
    assert path.is_file(), f"missing {path.relative_to(REPO_ROOT)}"


def test_the_live_probe_uses_the_installers_own_url_constant() -> None:
    body = (REPO_ROOT / "bootstrapper" / "test" / CONTRACT_FILES[0]).read_text(encoding="utf-8")
    assert "MANIFEST_RAW_URL" in body, (
        "the contract test must fetch the same URL constant the installer uses, "
        "not a copy of it"
    )


def test_no_manifest_fixture_was_checked_in() -> None:
    """The deliberately-rejected alternative, ratcheted.

    A committed copy of `marketplace.json` looks like coverage, ages silently,
    and stays green exactly when users are broken. If one appears, the contract
    test has been quietly turned into a fixture test.

    Reads git's INDEX, not the working tree (Stage-2 review finding). "Checked
    in" is the actual claim, so a gitignored local artifact must not fail this,
    and an `rglob` would also walk all of `node_modules` before filtering it.

    BOTH pathspecs are load-bearing, do not "simplify" to one: without `:(glob)`
    magic git matches with wildmatch and no WM_PATHNAME, so `*` spans `/` and
    `**` is not special — meaning `bootstrapper/**/marketplace*.json` cannot
    match a TOP-LEVEL `bootstrapper/marketplace.json`, which is the likeliest
    place a fixture would land.
    """
    result = subprocess.run(
        [
            "git",
            "ls-files",
            "--",
            "bootstrapper/**/marketplace*.json",
            "bootstrapper/marketplace*.json",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, f"git ls-files failed: {result.stderr.strip()}"
    strays = [line for line in result.stdout.splitlines() if line.strip()]
    assert not strays, (
        "checked-in marketplace manifest copies found: "
        + ", ".join(strays)
        + ". The contract test reads the LIVE document on purpose."
    )

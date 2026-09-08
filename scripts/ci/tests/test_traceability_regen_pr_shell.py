"""The `Open a regen PR when the manifest drifted` step's shell body,
EXECUTED against a real local git remote and a stubbed `gh` — not
string-matched. Mirrors `test_pr_review_stage2_decide.py`'s established
pattern for this repo: a workflow's `run:` says the right thing, but only
running it proves it *does* the right thing.

iterate-2026-09-08-manifest-regen-finalization, trg-1324dfc4. Three branches
matter and are each exercised: (1) the gate step failed for an INFRA reason
(no `--write-fresh` output) — must no-op, never fabricate a PR from nothing;
(2) real drift, no PR open yet — must commit+push the fresh regen and open
one; (3) real drift, a PR is already open — must refresh the branch without
opening a second PR.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
CI_YML = REPO_ROOT / ".github" / "workflows" / "ci.yml"
JOB_ID = "traceability-manifest-regen-pr"
STEP_ID = "open-regen-pr"

_GH_STUB = """\
#!/usr/bin/env bash
set -euo pipefail
log="$STUB_DIR/gh_calls.log"
echo "$*" >> "$log"
case "$1 $2" in
  "auth setup-git")
    exit 0
    ;;
  "pr view")
    if [ -f "$STUB_DIR/pr_open" ]; then
      echo "OPEN"
    else
      exit 1
    fi
    ;;
  "pr create")
    touch "$STUB_DIR/pr_created"
    exit 0
    ;;
  *)
    echo "unstubbed gh invocation: $*" >&2
    exit 1
    ;;
esac
"""


def _posix(path: Path) -> str:
    text = str(path).replace("\\", "/")
    import re

    return re.sub(r"^([A-Za-z]):", lambda m: "/" + m.group(1).lower(), text)


def _step_body() -> str:
    parsed = yaml.safe_load(CI_YML.read_text(encoding="utf-8"))
    for step in parsed["jobs"][JOB_ID]["steps"]:
        if isinstance(step, dict) and step.get("id") == STEP_ID:
            assert isinstance(step.get("run"), str)
            return step["run"]
    raise AssertionError(f"no step with id={STEP_ID!r} in job {JOB_ID!r} of {CI_YML.name}")


def _requires_shell() -> None:
    for binary in ("bash", "git"):
        if shutil.which(binary) is not None:
            continue
        if os.environ.get("CI", "").lower() in ("true", "1"):
            pytest.fail(f"`{binary}` is missing in CI — this step's shell body went UNTESTED.")
        pytest.skip(f"`{binary}` not on PATH (local dev); runs in CI")


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    """A working clone with `origin` pointing at a local bare remote, one
    commit already on `main` carrying a stale committed manifest — the
    shape `actions/checkout@v4` leaves the job in."""
    bare = tmp_path / "origin.git"
    subprocess.run(["git", "init", "--bare", "-b", "main", str(bare)], check=True, capture_output=True)
    work = tmp_path / "work"
    subprocess.run(["git", "clone", str(bare), str(work)], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "config", "user.email", "test@example.com"], check=True)
    subprocess.run(["git", "-C", str(work), "config", "user.name", "test"], check=True)
    target = work / ".shipwright" / "compliance"
    target.mkdir(parents=True)
    (target / "test-traceability.json").write_text('{"stale": true}\n', encoding="utf-8")
    subprocess.run(["git", "-C", str(work), "add", "."], check=True)
    subprocess.run(["git", "-C", str(work), "commit", "-m", "stale manifest"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "push", "origin", "main"], check=True, capture_output=True)
    return work


def _head_sha(repo: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def _run(
    body: str, cwd: Path, stub_dir: Path, bin_dir: Path, github_sha: str = "c" * 40,
) -> subprocess.CompletedProcess:
    gh = bin_dir / "gh"
    gh.write_text(_GH_STUB, encoding="utf-8", newline="\n")
    gh.chmod(0o755)
    env = {
        **os.environ,
        "GH_TOKEN": "x",
        "GITHUB_SHA": github_sha,
        "STUB_DIR": _posix(stub_dir),
        "PATH": f"{_posix(bin_dir)}{os.pathsep}{os.environ.get('PATH', '')}",
    }
    return subprocess.run(
        ["bash", "-c", body], cwd=cwd, capture_output=True, text=True, env=env, timeout=60,
        check=False,
    )


def test_missing_fresh_file_is_a_graceful_noop(tmp_path: Path, repo: Path) -> None:
    """No `--write-fresh` output means the earlier gate step failed for an
    INFRA reason (the pin moved), not real drift — must not fabricate a
    branch/PR out of nothing, and must not error either."""
    _requires_shell()
    stub_dir = tmp_path / "stub"
    stub_dir.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fresh = tmp_path / "fresh-test-traceability.json"
    assert not fresh.is_file()

    body = _step_body().replace("/tmp/fresh-test-traceability.json", _posix(fresh))
    proc = _run(body, repo, stub_dir, bin_dir)

    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert not (stub_dir / "gh_calls.log").exists(), "must not touch gh at all when there is no fresh regen"
    branches = subprocess.run(
        ["git", "-C", str(repo), "branch", "--list", "bot/traceability-regen"],
        capture_output=True, text=True, check=True,
    ).stdout
    assert branches.strip() == ""


def test_real_drift_opens_a_pr_when_none_is_open(tmp_path: Path, repo: Path) -> None:
    _requires_shell()
    stub_dir = tmp_path / "stub"
    stub_dir.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fresh = tmp_path / "fresh-test-traceability.json"
    fresh.write_text('{"stale": false, "fresh": true}\n', encoding="utf-8")

    body = _step_body().replace("/tmp/fresh-test-traceability.json", _posix(fresh))
    proc = _run(body, repo, stub_dir, bin_dir, github_sha=_head_sha(repo))

    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert (stub_dir / "pr_created").exists(), "gh pr create was never invoked"
    log = (stub_dir / "gh_calls.log").read_text(encoding="utf-8")
    assert "auth setup-git" in log
    assert "pr create" in log
    for forbidden in ("pr merge", "--auto"):
        assert forbidden not in log

    pushed = subprocess.run(
        ["git", "show", "origin/bot/traceability-regen:.shipwright/compliance/test-traceability.json"],
        cwd=repo, capture_output=True, text=True, check=True,
    ).stdout
    assert '"fresh": true' in pushed


def test_stale_run_stands_down_without_pushing(tmp_path: Path, repo: Path) -> None:
    """External plan review (2026-09-08, high severity): a slower, older run
    must never force-push a regen computed from an EARLIER `main` over one a
    newer run already pushed. Simulated here by advancing `origin/main` to a
    second commit AFTER `GITHUB_SHA` was captured (the shape a preempted-but-
    not-yet-killed older run would see)."""
    _requires_shell()
    stale_sha = _head_sha(repo)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "--allow-empty", "-m", "a newer main"],
        check=True, capture_output=True,
    )
    subprocess.run(["git", "-C", str(repo), "push", "origin", "main"], check=True, capture_output=True)
    newer_sha = _head_sha(repo)
    assert newer_sha != stale_sha

    stub_dir = tmp_path / "stub"
    stub_dir.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fresh = tmp_path / "fresh-test-traceability.json"
    fresh.write_text('{"stale": false, "fresh": true}\n', encoding="utf-8")

    body = _step_body().replace("/tmp/fresh-test-traceability.json", _posix(fresh))
    proc = _run(body, repo, stub_dir, bin_dir, github_sha=stale_sha)

    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert not (stub_dir / "gh_calls.log").exists(), "must stand down before authenticating/pushing at all"
    branches = subprocess.run(
        ["git", "-C", str(repo), "branch", "--list", "bot/traceability-regen"],
        capture_output=True, text=True, check=True,
    ).stdout
    assert branches.strip() == ""


def test_real_drift_refreshes_without_opening_a_second_pr(tmp_path: Path, repo: Path) -> None:
    """Also exercises `--force-with-lease` for real (doubt-reviewer, 2026-09-08,
    low severity): the branch already carries a PRIOR bot commit (pushed here,
    not just implied by a stub marker) before the step runs a second time, so
    the force-with-lease push has genuine prior remote state to compare
    against and overwrite — not an empty branch a plain push would also
    handle."""
    _requires_shell()
    subprocess.run(
        ["git", "-C", str(repo), "checkout", "-B", "bot/traceability-regen"],
        check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(repo), "commit", "--allow-empty", "-m", "round 1 (prior bot commit)"],
        check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(repo), "push", "origin", "bot/traceability-regen"],
        check=True, capture_output=True,
    )
    subprocess.run(["git", "-C", str(repo), "checkout", "main"], check=True, capture_output=True)

    stub_dir = tmp_path / "stub"
    stub_dir.mkdir()
    (stub_dir / "pr_open").touch()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fresh = tmp_path / "fresh-test-traceability.json"
    fresh.write_text('{"stale": false, "fresh": true, "round": 2}\n', encoding="utf-8")

    body = _step_body().replace("/tmp/fresh-test-traceability.json", _posix(fresh))
    proc = _run(body, repo, stub_dir, bin_dir, github_sha=_head_sha(repo))

    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert not (stub_dir / "pr_created").exists(), "must not open a second PR when one is already open"
    log = (stub_dir / "gh_calls.log").read_text(encoding="utf-8")
    assert "pr view" in log

    pushed = subprocess.run(
        ["git", "show", "origin/bot/traceability-regen:.shipwright/compliance/test-traceability.json"],
        cwd=repo, capture_output=True, text=True, check=True,
    ).stdout
    assert '"round": 2' in pushed

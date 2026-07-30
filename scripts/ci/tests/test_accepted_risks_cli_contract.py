"""Behavioural contract of the vendored accepted-risk CLI, driven as CI drives it.

Split out of ``test_accepted_risks_vendored.py`` at the 300-line cap. That file
guards the VENDORING (manifest drift, provenance headers); this one guards the
GATE's behaviour, which is what actually blocks a merge.

These pin the properties an accepted-risk gate is worthless without: it must FAIL
on a past-due entry, FAIL on drift in either direction, and FAIL CLOSED - exit 2,
distinct from drift's exit 1 - whenever it cannot run at all. A gate that fails
open on a corrupt register is worse than no gate: it reports "no accepted risks"
while every suppression stays live. A gate that reports "could not run" as exit 1
is nearly as bad, because the first thing a reader does with exit 1 is look for
the drift.

Runs in the `Reviewer Selftest` job (``pytest scripts/ci/tests``).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]
_CI_DIR = _REPO_ROOT / "scripts" / "ci"
_CLI = _CI_DIR / "accepted_risks_cli.py"


def _run(*args: str, project_root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(_CLI), *args, "--project-root", str(project_root)],
        capture_output=True,
        text=True,
    )


def _write_register(root: Path, body: str) -> None:
    (root / "shipwright_accepted_risks.yaml").write_text(body, encoding="utf-8")


_ENTRY = """schema: 1
acceptances:
  - id: ar-test-entry
    target: trivy-ignore
    rule: CVE-2026-0001
    expires: {expires}
    rationale_ref: ADR-001
    statement: >-
      A test acceptance, long enough to satisfy the minimum statement length.
"""

_TRIVYIGNORE = """vulnerabilities:
  - id: CVE-2026-0001
    expired_at: 2099-01-01
    statement: matching suppression for the register entry above
"""


def test_absent_register_is_not_an_error(tmp_path: Path) -> None:
    """A fresh or legacy repo has no register; that is not drift."""
    assert _run("check", project_root=tmp_path).returncode == 0
    assert _run("expire", project_root=tmp_path).returncode == 0


def test_paired_register_and_suppression_pass(tmp_path: Path) -> None:
    _write_register(tmp_path, _ENTRY.format(expires="2099-01-01"))
    (tmp_path / ".trivyignore.yaml").write_text(_TRIVYIGNORE, encoding="utf-8")
    result = _run("check", project_root=tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "no drift" in result.stdout


def test_register_entry_without_suppression_is_stale(tmp_path: Path) -> None:
    _write_register(tmp_path, _ENTRY.format(expires="2099-01-01"))
    result = _run("check", project_root=tmp_path)
    assert result.returncode == 1
    assert "STALE" in result.stdout


def test_suppression_without_register_entry_is_unrecorded(tmp_path: Path) -> None:
    _write_register(tmp_path, "schema: 1\nacceptances: []\n")
    (tmp_path / ".trivyignore.yaml").write_text(_TRIVYIGNORE, encoding="utf-8")
    result = _run("check", project_root=tmp_path)
    assert result.returncode == 1
    assert "UNRECORDED" in result.stdout


def test_past_due_entry_fails_expire(tmp_path: Path) -> None:
    """The whole reason this iterate exists: an overdue acceptance must BLOCK."""
    _write_register(tmp_path, _ENTRY.format(expires="2000-01-01"))
    result = _run("expire", project_root=tmp_path)
    assert result.returncode == 1
    assert "EXPIRED" in result.stdout
    assert "ar-test-entry" in result.stdout


def test_entry_expiring_today_is_still_active(tmp_path: Path) -> None:
    """The due date itself is active; the day AFTER it is overdue."""
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).date().isoformat()
    _write_register(tmp_path, _ENTRY.format(expires=today))
    assert _run("expire", project_root=tmp_path).returncode == 0


def test_missing_pyyaml_is_not_reported_as_drift(tmp_path: Path) -> None:
    """A gate that CANNOT run must not look like a gate that found something.

    PyYAML is imported lazily inside the register parser, so without it the CLI
    used to die on an unhandled traceback with exit 1 - the same code as real
    drift. Exit 2 (fail closed) keeps "could not run" distinguishable from
    "ran and found drift". Found by running the CI steps verbatim against a
    Python without PyYAML.
    """
    _write_register(tmp_path, _ENTRY.format(expires="2099-01-01"))
    # A sitecustomize that makes `import yaml` fail, injected via PYTHONPATH so
    # the real interpreter is untouched.
    shim = tmp_path / "shim"
    shim.mkdir()
    # `name="yaml"` matters: the real import machinery always sets it, and the
    # CLI's handler is scoped on `exc.name` so it cannot misdiagnose an unrelated
    # missing module as a PyYAML problem. A shim omitting it would simulate a
    # state Python never produces, and would "fail" a correct handler.
    (shim / "yaml.py").write_text(
        "raise ModuleNotFoundError(\"No module named 'yaml'\", name='yaml')\n",
        encoding="utf-8",
    )
    import os

    env = dict(os.environ, PYTHONPATH=str(shim))
    result = subprocess.run(
        [sys.executable, str(_CLI), "check", "--project-root", str(tmp_path)],
        capture_output=True,
        text=True,
        env=env,
    )
    assert result.returncode == 2, (
        f"expected 2 (fail closed), got {result.returncode}: {result.stderr}"
    )
    assert "could not run" in result.stderr
    assert "NOT a drift finding" in result.stderr
    assert "pip install pyyaml" in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize(
    "body",
    [
        pytest.param("schema: 1\n", id="missing-acceptances"),
        pytest.param("", id="empty-file"),
        pytest.param("schema: 99\nacceptances: []\n", id="unsupported-schema"),
        pytest.param("schema: 1\nacceptances: [{id: x}]\n", id="half-filled-entry"),
        pytest.param("schema: 1\nacceptances: [ unclosed\n", id="invalid-yaml"),
    ],
)
def test_unparseable_register_fails_closed(tmp_path: Path, body: str) -> None:
    """A register that cannot be trusted must never read as 'nothing accepted'.

    Exit 2 (not 1) so a broken register is distinguishable from real drift.
    """
    _write_register(tmp_path, body)
    for command in ("check", "expire"):
        result = _run(command, project_root=tmp_path)
        assert result.returncode == 2, (
            f"{command} on a {body!r} register returned {result.returncode}, "
            "expected 2 (fail closed)"
        )


def _stage_ci_copy(tmp_path: Path) -> Path:
    """A throwaway copy of scripts/ci/*.py, so a break is not made in the repo."""
    import shutil

    staged = tmp_path / "ci"
    staged.mkdir()
    for src in _CI_DIR.glob("*.py"):
        shutil.copy(src, staged / src.name)
    return staged


def _run_staged(staged: Path, project_root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(staged / "accepted_risks_cli.py"), "check",
         "--project-root", str(project_root)],
        capture_output=True, text=True,
    )


def test_a_broken_vendor_is_not_reported_as_drift(tmp_path: Path) -> None:
    """A missing sibling module must read as "could not run", not as drift.

    The sibling imports run at MODULE IMPORT time, outside main()'s try, so
    before this guard a deleted or renamed vendored module died on an unhandled
    traceback with exit 1 - the code that means "drift detected". Likelier than
    the PyYAML case, since it is what a botched re-vendor produces.
    (Stage-2 review, CR-6.)
    """
    staged = _stage_ci_copy(tmp_path)
    (staged / "accepted_risk_scan.py").unlink()
    result = _run_staged(staged, tmp_path)
    assert result.returncode == 2, f"expected 2, got {result.returncode}: {result.stderr}"
    assert "vendored gate is broken" in result.stderr
    assert "NOT a drift finding" in result.stderr
    assert "Traceback" not in result.stderr


def test_a_non_yaml_missing_module_is_not_blamed_on_pyyaml(tmp_path: Path) -> None:
    """Never tell a security-gate operator to install the wrong thing.

    main()'s ModuleNotFoundError handler is scoped to `yaml` and re-raises
    anything else; an unrelated missing import inside a vendored module is caught
    by the import guard instead, which names the real cause. (Stage-2 review, CR-6.)
    """
    staged = _stage_ci_copy(tmp_path)
    target = staged / "accepted_risks.py"
    target.write_text(
        target.read_text(encoding="utf-8").replace(
            "import re", "import re, definitely_not_a_real_module", 1
        ),
        encoding="utf-8",
    )
    result = _run_staged(staged, tmp_path)
    assert result.returncode == 2
    assert "definitely_not_a_real_module" in result.stderr
    assert "pip install pyyaml" not in result.stderr, (
        "a missing unrelated module must not be diagnosed as a PyYAML problem"
    )


def test_converge_is_absent_from_the_vendored_cli(tmp_path: Path) -> None:
    """The removal is the point, so it is pinned rather than left to a comment.

    Canonical is explicit that no scheduled job may hold the authority to
    mass-dismiss security alerts. A CI copy that CANNOT converge enforces that
    structurally instead of by convention.
    """
    result = _run("converge", project_root=tmp_path)
    assert result.returncode != 0
    assert "invalid choice" in result.stderr

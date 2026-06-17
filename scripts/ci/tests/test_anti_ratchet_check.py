"""Tests for the webui-vendored ``scripts/hooks/anti_ratchet_check.py``.

Lives under ``scripts/ci/tests/`` so the existing `Reviewer Selftest` CI job
(``python -m pytest scripts/ci/tests``) runs it without a workflow change.
Subprocess-driven (the gate is a CLI), so the test file location is irrelevant
to imports — it invokes the hooks script by absolute path.

Pins the fail-OPEN vs fail-CLOSED contract mirrored from the canonical monorepo
(iterate-2026-06-17-anti-ratchet-corrupt-failclosed): an ABSENT baseline fails
open (fresh repo), a PRESENT-but-corrupt baseline fails CLOSED (a corrupt
baseline must not silently disable the gate).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCRIPT = _REPO_ROOT / "scripts" / "hooks" / "anti_ratchet_check.py"


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=str(cwd), check=True, capture_output=True, text=True)


def _init_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "T")
    (repo / "a.py").write_text("\n".join(f"line{i}" for i in range(310)) + "\n")
    _git(repo, "add", "a.py")
    _git(repo, "commit", "-q", "-m", "initial")
    return repo


def _run(repo: Path, *extra: str) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    return subprocess.run(
        [sys.executable, str(_SCRIPT), "--project-root", str(repo), *extra],
        capture_output=True, text=True, env=env,
    )


def test_absent_baseline_fails_open(tmp_path):
    """No baseline file → exit 0 (fail-open, legitimate fresh repo)."""
    repo = _init_repo(tmp_path)
    res = _run(repo, "--worktree")
    assert res.returncode == 0, res.stderr
    assert "baseline" in res.stderr.lower()


def test_malformed_baseline_fails_closed(tmp_path):
    """A present-but-corrupt baseline must NOT silently disable the gate →
    fail CLOSED (exit 1 + diagnostic), unlike an absent one."""
    repo = _init_repo(tmp_path)
    (repo / "shipwright_bloat_baseline.json").write_text("{ bad json", encoding="utf-8")
    res = _run(repo, "--worktree")
    assert res.returncode == 1, res.stderr
    assert (
        "malformed" in res.stderr.lower()
        or "corrupt" in res.stderr.lower()
        or "failing closed" in res.stderr.lower()
    )


def test_ratchet_above_current_blocks(tmp_path):
    """A real ratchet (file grew past entry.current) → exit 1 (sanity)."""
    repo = _init_repo(tmp_path)
    (repo / "a.py").write_text("\n".join(f"line{i}" for i in range(400)) + "\n")
    _git(repo, "add", "a.py")
    _git(repo, "commit", "-q", "-m", "bump")
    (repo / "shipwright_bloat_baseline.json").write_text(
        json.dumps({"version": 1, "entries": [
            {"path": "a.py", "limit": 300, "current": 310,
             "state": "grandfathered", "adr": None},
        ]}) + "\n", encoding="utf-8")
    res = _run(repo, "--worktree")
    assert res.returncode == 1, res.stderr
    assert "a.py" in res.stdout + res.stderr

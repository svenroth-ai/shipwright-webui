"""Regression tests for the automated `PR Review` round-5 blocking findings
on w5 (iterate-2026-09-07-w5-bind-and-promote) -- kept in a NEW file rather
than grown into `test_promote_fr_layers_pr_review_fixes.py` (bloat cap,
CLAUDE.md "Files under 300 lines"; that file was already at 239 lines).
Same STUB cross-repo tree as the sibling files -- see
`promote_fr_layers_stub.py`'s docstring.

@covers FR-01.66
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from promote_fr_layers import run  # noqa: E402
from promote_fr_layers_stub import stub_plugin_root, write_tests_fixture  # noqa: E402,F401


_SPEC_TEXT = (
    "# Spec\n\n"
    "| ID | Area | Name | Priority | Description | Basis | Layers |\n"
    "|----|------|------|----------|-------------|--------|--------|\n"
    "| FR-01.01 | PRJ | One | Must | Does a thing | crawl | (inferred) |\n"
)


def _write_inputs(tmp_path: Path, tests_by_fr: dict) -> tuple[Path, Path, Path]:
    spec_dir = tmp_path / ".shipwright" / "planning" / "01-adopted"
    spec_dir.mkdir(parents=True, exist_ok=True)
    spec_path = spec_dir / "spec.md"
    spec_path.write_text(_SPEC_TEXT, encoding="utf-8")
    write_tests_fixture(tmp_path, tests_by_fr)
    manifest_path = tmp_path / "test-traceability.json"
    ledger_path = tmp_path / "ledger.json"
    return spec_path, manifest_path, ledger_path


def _args(**kwargs) -> argparse.Namespace:
    base = dict(
        project_root=".", manifest_path=None, spec_path=None, ledger_path=None,
        vitest_report=[], escalation_out=None, ack_path=None,
        evidence_max_age_seconds=3600, expect_plugin_commit=None, expect_project_commit=None,
    )
    base.update(kwargs)
    return argparse.Namespace(**base)


def _git(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def test_run_refuses_a_dirty_worktree_even_at_the_expected_commit(stub_plugin_root, tmp_path):
    """PR Review (blocking, round 5): `--expect-project-commit` only checked
    HEAD, so a caller could leave HEAD untouched while modifying a tracked
    file (e.g. a test, after it was run) and still pass this check --
    producing evidence that does not correspond to the pinned commit's
    actual committed tree."""
    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    _git("init", "-q", cwd=tmp_path)
    _git("config", "user.email", "test@example.com", cwd=tmp_path)
    _git("config", "user.name", "test", cwd=tmp_path)
    _git("add", ".", cwd=tmp_path)
    _git("commit", "-q", "-m", "init", cwd=tmp_path)
    head = _git("rev-parse", "HEAD", cwd=tmp_path).stdout.strip()

    vitest = tmp_path / "vitest.json"
    vitest.write_text(json.dumps({"results": {"a.test.ts::x": {"status": "enabled", "executed": "pass"}}}), encoding="utf-8")

    # HEAD is untouched, but a tracked file now differs from what HEAD
    # actually points to.
    spec_path.write_text(_SPEC_TEXT + "| FR-01.02 | PRJ | Two | Must | x | crawl | (inferred) |\n", encoding="utf-8")

    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote", vitest_report=[f"server={vitest}"],
        expect_project_commit=head,
    )
    assert run(args) == 2
    assert not manifest_path.is_file()


def test_run_refuses_a_non_object_ledger_instead_of_crashing(stub_plugin_root, tmp_path):
    """PR Review (blocking, round 5): a syntactically valid but non-object
    ledger.json used to reach `evaluate_manifest`'s `ledger.get(...)`
    unchecked and crash with an uncaught AttributeError instead of the
    structured `{"success": false}` failure every other bad-input path
    here produces."""
    for malformed in ("[]", "null", '"not-an-object"'):
        spec_path, manifest_path, ledger_path = _write_inputs(
            tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
        )
        ledger_path.write_text(malformed, encoding="utf-8")
        vitest = tmp_path / "vitest.json"
        vitest.write_text(json.dumps({"results": {"a.test.ts::x": {"status": "enabled", "executed": "pass"}}}), encoding="utf-8")

        args = _args(
            project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
            manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
            run_id="iterate-2026-09-07-w5-bind-and-promote", vitest_report=[f"server={vitest}"],
        )
        assert run(args) == 2, f"expected a structured failure for ledger content {malformed!r}"
        assert spec_path.read_text(encoding="utf-8") == _SPEC_TEXT
        assert not manifest_path.is_file()

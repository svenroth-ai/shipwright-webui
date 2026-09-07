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


def test_a_relative_manifest_path_override_resolves_against_project_root_not_cwd(
    stub_plugin_root, tmp_path, monkeypatch
):
    """PR Review (blocking, round 7): resolve_confined_path() used to resolve
    a RELATIVE override against the process's cwd instead of project_root --
    invoking from a different cwd (as CI commonly does) either failed the
    confinement check below or silently targeted the wrong directory."""
    spec_path, _manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    vitest = tmp_path / "vitest.json"
    vitest.write_text(json.dumps({"results": {"a.test.ts::x": {"status": "enabled", "executed": "pass"}}}), encoding="utf-8")

    relative_manifest = "custom/manifest.json"
    expected_manifest_path = tmp_path / relative_manifest

    elsewhere = tmp_path.parent / "elsewhere-cwd"
    elsewhere.mkdir(exist_ok=True)
    monkeypatch.chdir(elsewhere)

    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=relative_manifest, spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote", vitest_report=[f"server={vitest}"],
    )
    assert run(args) == 0
    assert expected_manifest_path.is_file()
    assert not (elsewhere / relative_manifest).exists()


def test_a_relative_path_escaping_project_root_is_still_refused(stub_plugin_root, tmp_path):
    """The relative-path fix above must not weaken the confinement check --
    `../outside.json` still escapes `project_root` once joined and must
    still be refused."""
    spec_path, _manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path="../outside-manifest.json", spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote", vitest_report=[],
    )
    assert run(args) == 2
    assert not (tmp_path.parent / "outside-manifest.json").is_file()


def test_a_non_object_ack_is_treated_as_unacked_instead_of_crashing(stub_plugin_root, tmp_path):
    """PR Review (blocking, round 6): a syntactically valid but non-object
    ack.json ([], null, a bare string) used to reach `check_ack`'s
    `ack.get(...)` unguarded and crash with an uncaught AttributeError,
    instead of being treated the same as "no ack on file"."""
    for malformed in ("[]", "null", '"not-an-object"'):
        spec_path, manifest_path, ledger_path = _write_inputs(tmp_path, {})
        ack_path = tmp_path / "ack.json"
        ack_path.write_text(malformed, encoding="utf-8")

        args = _args(
            project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
            manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
            ack_path=str(ack_path),
            run_id="iterate-2026-09-07-w5-bind-and-promote", vitest_report=[],
        )
        exit_code = run(args)
        assert exit_code == 3, f"expected the unacked-escalation exit code for ack content {malformed!r}"


def test_a_non_utf8_ack_is_treated_as_unacked_instead_of_crashing(stub_plugin_root, tmp_path):
    """PR Review (blocking, round 8): `check_ack()` caught `OSError` and
    `json.JSONDecodeError` but not the `UnicodeDecodeError` a non-UTF-8 ack
    file raises out of `read_text` before `json.loads` is even reached."""
    spec_path, manifest_path, ledger_path = _write_inputs(tmp_path, {})
    ack_path = tmp_path / "ack.json"
    ack_path.write_bytes(b"\xff\xfe\x00\x01not-utf8")

    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        ack_path=str(ack_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote", vitest_report=[],
    )
    assert run(args) == 3


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

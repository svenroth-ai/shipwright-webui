"""Network-free integration tests for `traceability_manifest_gate.run()`.

`test_traceability_manifest_gate.py` deliberately only covers the pure
`_normalize`/`_summarize_diff` helpers — `run()` itself imports the
`test_links` collector from a SHA-pinned checkout of a separate repo, which
needs network + `uv` and is what the CI job itself provides (see that
module's docstring).

This module closes the gap the external plan review raised (2026-09-06,
high severity): `run()`'s own control flow — the import-contract guard, the
stale/current/missing-manifest branches, and their exit codes — is exercised
here against a STUB collector package written to a temp directory, so it
runs offline in any environment (no real shipwright monorepo checkout).
It does not, and cannot, verify the real collector's shape; that contract is
covered by the CI job actually running end-to-end against the pinned SHA.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from traceability_manifest_gate import run  # noqa: E402

_STUB_MODULE_NAMES = (
    "scripts.lib.collectors.test_links",
    "scripts.lib.collectors._test_links_io",
    "scripts.lib.collectors",
    "scripts.lib",
    "scripts",
)

_IO_STUB = '''
def configured_test_roots(project_root):
    return []


def configured_prune_dirs(project_root):
    return []


def git_head(project_root):
    return "stubbed-sha"
'''

_COLLECTOR_STUB = '''
def _validate_manifest(manifest):
    pass


def build_manifest(project_root, *, test_roots, prune_dirs, evidence,
                    enumerate_untagged, generated_at, source_commit):
    return {
        "schema_version": 3,
        "collector_version": "stub/1.0.0",
        "generated_at": generated_at,
        "source_commit": source_commit,
        "spec_hash": "sha256:stub",
        "requirements": {},
        "orphans": [],
        "invalid_tags": [],
        "invalid_layers": [],
        "untagged_tests": [],
    }
'''


def _write_stub_plugin(plugin_root: Path) -> None:
    collectors_dir = plugin_root / "scripts" / "lib" / "collectors"
    collectors_dir.mkdir(parents=True)
    (collectors_dir / "_test_links_io.py").write_text(_IO_STUB, encoding="utf-8")
    (collectors_dir / "test_links.py").write_text(_COLLECTOR_STUB, encoding="utf-8")


def _cleanup(plugin_root: Path) -> None:
    for name in _STUB_MODULE_NAMES:
        sys.modules.pop(name, None)
    plugin_root_str = str(plugin_root.resolve())
    if plugin_root_str in sys.path:
        sys.path.remove(plugin_root_str)


@pytest.fixture()
def stub_plugin_root(tmp_path: Path):
    """Writes a minimal stand-in `test_links` collector package and cleans up
    both `sys.path` and the module cache afterwards — each test gets a fresh
    tmp_path, but the imported module NAMES are always the same
    (`scripts.lib.collectors...`), so a stale cached module from a prior test
    would otherwise leak into the next one. Fixture teardown (not in-test
    cleanup) runs even if the test body raises/fails an assertion — external
    code review, 2026-09-06, low severity."""
    plugin_root = tmp_path / "plugin_root"
    _write_stub_plugin(plugin_root)
    try:
        yield plugin_root
    finally:
        _cleanup(plugin_root)


@pytest.fixture()
def empty_plugin_root(tmp_path: Path):
    """No stub written — reproduces what happens when the pinned monorepo
    commit renamed/removed the collector module entirely. Same
    exception-safe teardown as `stub_plugin_root`."""
    plugin_root = tmp_path / "empty_plugin_root"
    plugin_root.mkdir()
    try:
        yield plugin_root
    finally:
        _cleanup(plugin_root)


def test_run_returns_0_when_regen_matches_committed(stub_plugin_root: Path, tmp_path: Path, capsys) -> None:
    committed = tmp_path / "test-traceability.json"
    committed.write_text(json.dumps({
        "schema_version": 3,
        "collector_version": "stub/1.0.0",
        "generated_at": "2026-01-01T00:00:00+00:00",
        "source_commit": "stubbed-sha",
        "spec_hash": "sha256:stub",
        "requirements": {},
        "orphans": [],
        "invalid_tags": [],
        "invalid_layers": [],
        "untagged_tests": [],
    }), encoding="utf-8")

    exit_code = run(stub_plugin_root, tmp_path, committed)

    assert exit_code == 0
    out = json.loads(capsys.readouterr().out)
    assert out["success"] is True


def test_run_returns_0_when_only_source_commit_differs(stub_plugin_root: Path, tmp_path: Path, capsys) -> None:
    """`source_commit` mismatch alone must NOT fail the gate (reversed after
    external code review, 2026-09-06 — see the module docstring on
    `traceability_manifest_gate.py`): a manifest can never embed the hash of
    the commit that will contain it, so this is the normal, always-present
    state, not staleness. It IS surfaced as informational context."""
    committed = tmp_path / "test-traceability.json"
    committed.write_text(json.dumps({
        "schema_version": 3,
        "collector_version": "stub/1.0.0",
        "generated_at": "2026-01-01T00:00:00+00:00",
        "source_commit": "many-commits-behind-head",
        "spec_hash": "sha256:stub",
        "requirements": {},
        "orphans": [],
        "invalid_tags": [],
        "invalid_layers": [],
        "untagged_tests": [],
    }), encoding="utf-8")

    exit_code = run(stub_plugin_root, tmp_path, committed)

    assert exit_code == 0
    out = json.loads(capsys.readouterr().out)
    assert out["success"] is True
    assert out["info"] == {
        "committed_source_commit": "many-commits-behind-head",
        "head": "stubbed-sha",
    }


def test_run_returns_1_when_requirements_actually_drift(stub_plugin_root: Path, tmp_path: Path, capsys) -> None:
    """The genuine staleness signal: FR<->test topology differs, independent
    of `source_commit`."""
    committed = tmp_path / "test-traceability.json"
    committed.write_text(json.dumps({
        "schema_version": 3,
        "collector_version": "stub/1.0.0",
        "generated_at": "2026-01-01T00:00:00+00:00",
        "source_commit": "stubbed-sha",
        "spec_hash": "sha256:stub",
        "requirements": {
            "01::FR-01.01": {"id": "FR-01.01", "status": "active", "tests": {}}
        },
        "orphans": [],
        "invalid_tags": [],
        "invalid_layers": [],
        "untagged_tests": [],
    }), encoding="utf-8")

    exit_code = run(stub_plugin_root, tmp_path, committed)

    assert exit_code == 1
    out = json.loads(capsys.readouterr().out)
    assert out["success"] is False
    assert any("01::FR-01.01" in line for line in out["diff"])


def test_run_returns_1_when_committed_manifest_is_missing(stub_plugin_root: Path, tmp_path: Path, capsys) -> None:
    missing = tmp_path / "does-not-exist.json"

    exit_code = run(stub_plugin_root, tmp_path, missing)

    assert exit_code == 1
    out = json.loads(capsys.readouterr().out)
    assert out["success"] is False
    assert "no committed manifest" in out["reason"]


def test_run_returns_1_with_structured_reason_on_invalid_committed_json(
    stub_plugin_root: Path, tmp_path: Path, capsys
) -> None:
    """A hand-merge conflict or truncated committed file must not crash with
    a raw `JSONDecodeError` traceback — external code review, 2026-09-06,
    low severity."""
    committed = tmp_path / "test-traceability.json"
    committed.write_text("{not valid json", encoding="utf-8")

    exit_code = run(stub_plugin_root, tmp_path, committed)

    assert exit_code == 1
    out = json.loads(capsys.readouterr().out)
    assert out["success"] is False
    assert "not valid JSON" in out["reason"]


def test_run_names_the_pin_when_the_collector_cannot_be_imported(
    empty_plugin_root: Path, tmp_path: Path, capsys
) -> None:
    """No stub written — reproduces what happens when the pinned monorepo
    commit renamed/removed the collector module. The error must name the
    plugin root so a maintainer knows which pin to re-check, not surface a
    bare ModuleNotFoundError traceback mid-CI."""
    committed = tmp_path / "test-traceability.json"
    committed.write_text("{}", encoding="utf-8")

    exit_code = run(empty_plugin_root, tmp_path, committed)

    assert exit_code == 1
    out = json.loads(capsys.readouterr().out)
    assert out["success"] is False
    assert str(empty_plugin_root.resolve()) in out["reason"]

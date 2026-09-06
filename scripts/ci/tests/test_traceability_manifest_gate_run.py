"""Network-free integration tests for `traceability_manifest_gate.run()`:
the success/stale/missing-manifest/malformed-JSON cases.

`test_traceability_manifest_diff.py` / `test_traceability_manifest_diff_drift.py`
deliberately only cover the pure `_normalize`/`_summarize_diff` helpers —
`run()` itself imports the `test_links` collector from a SHA-pinned checkout
of a separate repo, which needs network + `uv` and is what the CI job itself
provides (see that module's docstring). This module closes the gap the
external plan review raised (2026-09-06, high severity): `run()`'s own
control flow is exercised here against a STUB collector package written to a
temp directory, so it runs offline in any environment (no real shipwright
monorepo checkout). It does not, and cannot, verify the real collector's
shape; that contract is covered by the CI job actually running end-to-end
against the pinned SHA.

The import-failure / call-failure / exception-catch-all cases (the pin
having moved, or the collector itself raising) live in the sibling module
`test_traceability_manifest_gate_run_infra_failures.py` (split at the bloat
ceiling, same seam).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from traceability_manifest_gate import run  # noqa: E402
from traceability_gate_stub_collector import stub_plugin_root  # noqa: E402,F401


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

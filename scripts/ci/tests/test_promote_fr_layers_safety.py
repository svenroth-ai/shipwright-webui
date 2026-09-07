"""Failure/rollback/safety-boundary tests for `promote_fr_layers.run()` —
split out of `test_promote_fr_layers_run.py` (bloat cap, CLAUDE.md "Files
under 300 lines"): this file owns the paths where the run is REJECTED or
must roll back, never the normal promote/escalate/ack happy paths (those
stay in the sibling file). Same STUB cross-repo tree as the sibling file —
see `promote_fr_layers_stub.py`'s docstring.

@covers FR-01.66
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import promote_fr_layers  # noqa: E402
from promote_fr_layers import run  # noqa: E402
from promote_fr_layers_stub import stub_plugin_root, write_tests_fixture  # noqa: E402,F401


_SPEC_TEXT = (
    "# Spec\n\n"
    "| ID | Area | Name | Priority | Description | Basis | Layers |\n"
    "|----|------|------|----------|-------------|--------|--------|\n"
    "| FR-01.01 | PRJ | One | Must | Does a thing | crawl | (inferred) |\n"
    "| FR-01.02 | PRJ | Two | Must | Does another thing | crawl | (inferred) |\n"
)


def _write_inputs(tmp_path: Path, tests_by_fr: dict, spec_text: str = _SPEC_TEXT) -> tuple[Path, Path, Path]:
    spec_dir = tmp_path / ".shipwright" / "planning" / "01-adopted"
    spec_dir.mkdir(parents=True)
    spec_path = spec_dir / "spec.md"
    spec_path.write_text(spec_text, encoding="utf-8")
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


def test_an_unsafe_run_id_is_rejected_before_touching_any_path(stub_plugin_root, tmp_path):
    """External plan review (openai, medium): a run_id carrying `..` or a path
    separator must never reach the escalation/ack output paths."""
    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="../../etc/passwd", vitest_report=[],
    )
    assert run(args) == 2
    # Nothing was written anywhere outside the intended tree.
    assert not (tmp_path / ".shipwright" / "planning" / "iterate").exists()


def test_a_stale_vitest_report_is_rejected_as_not_fresh(stub_plugin_root, tmp_path):
    """External plan review (openai, high): a vitest report older than the
    freshness ceiling is refused outright, not silently accepted as green."""
    import os
    import time as time_mod

    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    vitest = tmp_path / "vitest.json"
    vitest.write_text(json.dumps({"results": {"a.test.ts::x": {"status": "enabled", "executed": "pass"}}}), encoding="utf-8")
    stale_mtime = time_mod.time() - 7200  # 2h old
    os.utime(vitest, (stale_mtime, stale_mtime))

    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote",
        vitest_report=[f"server={vitest}"],
        evidence_max_age_seconds=3600,
    )
    assert run(args) == 2
    # Nothing was promoted — the stale report never even reached evaluation.
    assert not manifest_path.is_file()
    assert spec_path.read_text(encoding="utf-8") == _SPEC_TEXT


def test_a_regen_2_failure_rolls_back_spec_md_instead_of_leaving_it_half_promoted(
    stub_plugin_root, tmp_path, monkeypatch
):
    """External plan review (openai medium / GLM high): if the post-promotion
    manifest regen raises ANYTHING, spec.md must be restored to its pre-run
    content — never left with promoted rows and no matching manifest/ledger
    (a permanent hole, since `explicit` never re-evaluates)."""
    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    vitest = tmp_path / "vitest.json"
    vitest.write_text(json.dumps({"results": {"a.test.ts::x": {"status": "enabled", "executed": "pass"}}}), encoding="utf-8")

    real_regen = promote_fr_layers.io_mod.regen_manifest
    calls = {"n": 0}

    def _flaky_regen(project_root, evidence, mods):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("simulated regen #2 failure")
        return real_regen(project_root, evidence, mods)

    monkeypatch.setattr(promote_fr_layers.io_mod, "regen_manifest", _flaky_regen)

    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote",
        vitest_report=[f"server={vitest}"],
    )
    exit_code = run(args)
    assert exit_code == 2
    assert calls["n"] == 2  # confirms regen #2 (not #1) was the one that failed

    # spec.md is back to its EXACT pre-run content — no half-promoted row.
    assert spec_path.read_text(encoding="utf-8") == _SPEC_TEXT
    assert not manifest_path.is_file()
    assert not ledger_path.is_file()


def test_a_keyboard_interrupt_during_regen_2_still_rolls_back_spec_md(
    stub_plugin_root, tmp_path, monkeypatch
):
    """Code review (orchestrator, high): the original rollback only caught
    `Exception`, so a KeyboardInterrupt/SystemExit during the (potentially
    long, full-repo) regen #2 skipped the restore entirely. `write_promotions`
    catches BaseException, rolls back, and re-raises anything that is not a
    plain Exception — so the interrupt still propagates, but spec.md is never
    left half-promoted."""
    import pytest

    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    vitest = tmp_path / "vitest.json"
    vitest.write_text(json.dumps({"results": {"a.test.ts::x": {"status": "enabled", "executed": "pass"}}}), encoding="utf-8")

    real_regen = promote_fr_layers.io_mod.regen_manifest
    calls = {"n": 0}

    def _interrupted_regen(project_root, evidence, mods):
        calls["n"] += 1
        if calls["n"] == 2:
            raise KeyboardInterrupt()
        return real_regen(project_root, evidence, mods)

    monkeypatch.setattr(promote_fr_layers.io_mod, "regen_manifest", _interrupted_regen)

    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote",
        vitest_report=[f"server={vitest}"],
    )
    with pytest.raises(KeyboardInterrupt):
        run(args)
    assert calls["n"] == 2

    assert spec_path.read_text(encoding="utf-8") == _SPEC_TEXT
    assert not manifest_path.is_file()
    assert not ledger_path.is_file()


def test_a_ledger_write_failure_also_rolls_back_the_already_written_manifest(
    stub_plugin_root, tmp_path, monkeypatch
):
    """Doubt review (orchestrator, medium): write_promotions used to restore
    ONLY spec.md on failure -- a manifest write that succeeded followed by a
    failing ledger write left a promoted manifest on disk with no matching
    ledger entry, the same permanent-hole class the rollback exists to
    close. All three files must roll back together."""
    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    vitest = tmp_path / "vitest.json"
    vitest.write_text(json.dumps({"results": {"a.test.ts::x": {"status": "enabled", "executed": "pass"}}}), encoding="utf-8")

    real_atomic_write = promote_fr_layers.io_mod.atomic_write_text

    def _flaky_atomic_write(path, text):
        if Path(path) == ledger_path:
            raise OSError("simulated ledger write failure")
        return real_atomic_write(path, text)

    monkeypatch.setattr(promote_fr_layers.io_mod, "atomic_write_text", _flaky_atomic_write)

    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote",
        vitest_report=[f"server={vitest}"],
    )
    exit_code = run(args)
    assert exit_code == 2

    assert spec_path.read_text(encoding="utf-8") == _SPEC_TEXT
    assert not manifest_path.is_file()
    assert not ledger_path.is_file()


def test_rewrite_spec_row_refuses_when_layers_is_not_the_last_cell(tmp_path):
    """Code review (orchestrator, high): the writer used to assume the Layers
    cell is always the row's LAST cell, while the real reader resolves it by
    HEADER NAME and admits rows shorter than their header — a mismatch would
    silently overwrite a different cell (most likely Basis). Refuse instead."""
    import pytest
    from dataclasses import dataclass

    import promote_fr_layers_io as io_mod

    @dataclass(frozen=True)
    class _FakeRow:
        id: str
        cells: tuple
        lineno: int
        layers_cell: str

    class _FakeReader:
        @staticmethod
        def read_fr_rows(content):
            # This row's last cell is "Basis", not its (named-column-resolved)
            # Layers cell — the disagreement the guard must catch.
            return [_FakeRow(id="FR-01.01", cells=("FR-01.01", "PRJ", "crawl"), lineno=3, layers_cell="(inferred)")]

    mods = {"fr_table_reader": _FakeReader}
    spec_text = "# Spec\n\n| FR-01.01 | PRJ | crawl |\n"
    with pytest.raises(ValueError, match="not this row's last cell"):
        io_mod.rewrite_spec_row(spec_text, "FR-01.01", "unit", mods)

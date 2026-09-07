"""Regression tests for the automated `PR Review` blocking findings on w5
(iterate-2026-09-07-w5-bind-and-promote) -- split out of
`test_promote_fr_layers_safety.py` (bloat cap, CLAUDE.md "Files under 300
lines") rather than grown in place, since these are a cohesive, dated group
of their own. Same STUB cross-repo tree as the sibling files -- see
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


def test_a_removed_fr_is_named_in_the_run_output(stub_plugin_root, tmp_path, monkeypatch, capsys):
    """PR Review (blocking, round 3): `evaluate_manifest` already NAMES every
    removed FR (external plan review GLM #9b) but the CLI's own `output`
    dict dropped it -- surfacing this in a real integration run, not just a
    `layer_promotion.py` unit test."""
    spec_path, manifest_path, ledger_path = _write_inputs(tmp_path, {})
    fixed_manifest = {
        "schema_version": 3, "collector_version": "stub/1.0.0",
        "generated_at": "1970-01-01T00:00:00+00:00", "source_commit": "stubbed-sha",
        "spec_hash": "sha256:stub",
        "requirements": {
            "01::FR-01.01": {
                "id": "FR-01.01", "status": "removed",
                "required_layers": [], "required_layers_source": "inferred_legacy", "tests": {},
            },
        },
        "orphans": [], "invalid_tags": [], "untagged_tests": [],
    }
    monkeypatch.setattr(promote_fr_layers.io_mod, "regen_manifest", lambda *a, **k: fixed_manifest)

    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote", vitest_report=[],
    )
    assert run(args) == 0
    output = json.loads(capsys.readouterr().out)
    assert output["removed_fr_ids"] == ["FR-01.01"]


def test_run_refuses_a_manifest_path_override_outside_project_root(stub_plugin_root, tmp_path):
    """PR Review (blocking, round 3): `--manifest-path` (and its siblings)
    accepted ANY path with no confinement to project_root."""
    spec_path, _manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    outside_manifest = tmp_path.parent / "outside-manifest.json"
    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(outside_manifest), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote", vitest_report=[],
    )
    assert run(args) == 2
    assert not outside_manifest.is_file()


def test_a_negative_evidence_max_age_is_rejected_as_misconfiguration(stub_plugin_root, tmp_path):
    """A negative ceiling makes `age > ceiling` true for every report, i.e.
    "reject all evidence" -- refuse it explicitly instead of silently
    behaving that way."""
    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote", vitest_report=[],
        evidence_max_age_seconds=-1,
    )
    assert run(args) == 2
    assert not manifest_path.is_file()


def test_an_escalation_write_failure_also_rolls_back_the_promotion(
    stub_plugin_root, tmp_path, monkeypatch
):
    """write_promotions used to leave the escalation report's write to the
    CALLER, entirely unguarded and AFTER the promotion was already committed
    -- a failure there left a terminal promotion with no matching escalation
    record for the FR(s) that did NOT promote in the same run. The
    escalation write is now part of the same transaction, so a failure there
    rolls back spec.md/manifest/ledger too."""
    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    vitest = tmp_path / "vitest.json"
    vitest.write_text(json.dumps({"results": {"a.test.ts::x": {"status": "enabled", "executed": "pass"}}}), encoding="utf-8")

    real_atomic_write = promote_fr_layers.io_mod.atomic_write_text

    def _flaky_atomic_write(path, text):
        if Path(path).name == "layer_promotion_escalation.json":
            raise OSError("simulated escalation-report write failure")
        return real_atomic_write(path, text)

    monkeypatch.setattr(promote_fr_layers.io_mod, "atomic_write_text", _flaky_atomic_write)

    run_id = "iterate-2026-09-07-w5-bind-and-promote"
    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id=run_id, vitest_report=[f"server={vitest}"],
    )
    exit_code = run(args)
    assert exit_code == 2

    # FR-01.01 promotes, FR-01.02 has no binding and escalates -- both in the
    # SAME run, the exact coexistence the finding was about. Nothing should
    # be left committed: spec.md, manifest, ledger AND the escalation report
    # all roll back together.
    assert spec_path.read_text(encoding="utf-8") == _SPEC_TEXT
    assert not manifest_path.is_file()
    assert not ledger_path.is_file()
    escalation_path = tmp_path / ".shipwright" / "planning" / "iterate" / run_id / "layer_promotion_escalation.json"
    assert not escalation_path.is_file()


def test_run_refuses_an_unverified_plugin_checkout(tmp_path):
    """`--plugin-root` used to be trusted with no integrity check at all.
    `--expect-plugin-commit`, when passed, must refuse to import from a
    checkout whose HEAD does not match."""
    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    monorepo_root = tmp_path / "monorepo"
    plugin_root = monorepo_root / "plugins" / "shipwright-compliance"
    plugin_root.mkdir(parents=True)
    subprocess.run(["git", "init", "-q"], cwd=monorepo_root, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=monorepo_root, check=True)
    subprocess.run(["git", "config", "user.name", "test"], cwd=monorepo_root, check=True)
    (monorepo_root / "README.md").write_text("stub", encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=monorepo_root, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=monorepo_root, check=True)

    args = _args(
        project_root=str(tmp_path), plugin_root=str(plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote", vitest_report=[],
        expect_plugin_commit="0" * 40,
    )
    assert run(args) == 2
    assert spec_path.read_text(encoding="utf-8") == _SPEC_TEXT
    assert not manifest_path.is_file()


def test_run_refuses_when_project_root_is_not_the_expected_commit(stub_plugin_root, tmp_path):
    """PR Review (blocking, round 2): the evidence freshness check only
    looked at report mtime -- an old report copied/touched recently would
    pass. `--expect-project-commit`, when it does not match project_root's
    actual HEAD, must refuse before any vitest report is even considered."""
    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "test"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=tmp_path, check=True)

    vitest = tmp_path / "vitest.json"
    vitest.write_text(json.dumps({"results": {"a.test.ts::x": {"status": "enabled", "executed": "pass"}}}), encoding="utf-8")

    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote", vitest_report=[f"server={vitest}"],
        expect_project_commit="0" * 40,
    )
    assert run(args) == 2
    assert spec_path.read_text(encoding="utf-8") == _SPEC_TEXT
    assert not manifest_path.is_file()


def test_run_rejects_a_future_dated_vitest_report(stub_plugin_root, tmp_path):
    """PR Review (comment): clock skew or a deliberately advanced mtime must
    be rejected the same as a stale one, not silently accepted as fresh."""
    import os
    import time as time_mod

    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    vitest = tmp_path / "vitest.json"
    vitest.write_text(json.dumps({"results": {"a.test.ts::x": {"status": "enabled", "executed": "pass"}}}), encoding="utf-8")
    future_mtime = time_mod.time() + 3600
    os.utime(vitest, (future_mtime, future_mtime))

    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote", vitest_report=[f"server={vitest}"],
    )
    assert run(args) == 2
    assert not manifest_path.is_file()

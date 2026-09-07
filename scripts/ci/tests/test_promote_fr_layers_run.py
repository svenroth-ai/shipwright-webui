"""Network-free integration tests for `promote_fr_layers.run()` — the
two-regen-pass / row-rewrite / ledger / escalation-and-ack HAPPY-PATH wiring,
against a STUB cross-repo tree (see `promote_fr_layers_stub.py`'s docstring
for why the stub `build_manifest` derives its per-row
`required_layers_source` from spec.md's own marker rule, and per-FR test
bindings from a side fixture). Failure/rollback/safety-boundary tests live in
the sibling `test_promote_fr_layers_safety.py` (bloat cap split).

@covers FR-01.66
"""

from __future__ import annotations

import argparse
import json
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
    "| FR-01.02 | PRJ | Two | Must | Does another thing | crawl | (inferred) |\n"
)


_ONE_ROW_SPEC_TEXT = (
    "# Spec\n\n"
    "| ID | Area | Name | Priority | Description | Basis | Layers |\n"
    "|----|------|------|----------|-------------|--------|--------|\n"
    "| FR-01.01 | PRJ | One | Must | Does a thing | crawl | (inferred) |\n"
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
        evidence_max_age_seconds=3600, expect_plugin_commit=None,
    )
    base.update(kwargs)
    return argparse.Namespace(**base)


def test_promotes_a_green_fr_and_rewrites_spec_manifest_and_ledger(stub_plugin_root, tmp_path):
    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    vitest = tmp_path / "vitest.json"
    vitest.write_text(json.dumps({"results": {"a.test.ts::x": {"status": "enabled", "executed": "pass"}}}), encoding="utf-8")

    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id="iterate-2026-09-07-w5-bind-and-promote",
        vitest_report=[f"server={vitest}"],
    )
    # FR-01.02 has no test binding at all in this fixture (deliberately, to
    # prove it is left untouched) — it escalates with `no_observable_layer`,
    # so the overall exit code is still 3 even though FR-01.01 WAS promoted.
    # Promotion and escalation are decided and applied independently, per FR.
    exit_code = run(args)
    assert exit_code == 3

    new_spec = spec_path.read_text(encoding="utf-8")
    assert "| FR-01.01 | PRJ | One | Must | Does a thing | crawl | unit |" in new_spec
    # The untouched FR keeps its bare marker cell exactly as it was.
    assert "| FR-01.02 | PRJ | Two | Must | Does another thing | crawl | (inferred) |" in new_spec

    # The committed manifest is a FULL regen from the now-edited spec.md (regen
    # #2), never a hand-patch of a pre-promotion snapshot.
    new_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    req = new_manifest["requirements"]["01::FR-01.01"]
    assert req["required_layers"] == ["unit"]
    assert req["required_layers_source"] == "explicit"
    other = new_manifest["requirements"]["01::FR-01.02"]
    assert other["required_layers_source"] == "inferred_legacy"

    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    assert ledger["FR-01.01"]["status"] == "promoted"
    assert ledger["FR-01.01"]["layers"] == ["unit"]


def test_escalates_and_hands_back_when_evidence_is_absent(stub_plugin_root, tmp_path):
    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )

    run_id = "iterate-2026-09-07-w5-bind-and-promote"
    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id=run_id, vitest_report=[],
    )
    exit_code = run(args)
    assert exit_code == 3

    # No spec mutation happened, and no manifest was ever written — nothing
    # was decidable, so there is nothing to commit.
    assert spec_path.read_text(encoding="utf-8") == _SPEC_TEXT
    assert not manifest_path.is_file()

    escalation_path = tmp_path / ".shipwright" / "planning" / "iterate" / run_id / "layer_promotion_escalation.json"
    assert escalation_path.is_file()
    escalation = json.loads(escalation_path.read_text(encoding="utf-8"))
    assert escalation["escalations"][0]["fr_id"] == "FR-01.01"
    assert escalation["escalations"][0]["reason_code"] == "absent_ci_evidence"

    # The run never wrote its own ack.
    ack_path = tmp_path / ".shipwright" / "planning" / "iterate" / run_id / "layer_promotion_ack.json"
    assert not ack_path.is_file()


def test_a_matching_operator_ack_clears_the_stop_on_rerun(stub_plugin_root, tmp_path):
    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    run_id = "iterate-2026-09-07-w5-bind-and-promote"
    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id=run_id, vitest_report=[],
    )
    first = run(args)
    assert first == 3

    escalation_path = tmp_path / ".shipwright" / "planning" / "iterate" / run_id / "layer_promotion_escalation.json"
    fingerprint = json.loads(escalation_path.read_text(encoding="utf-8"))["fingerprint"]
    ack_path = tmp_path / ".shipwright" / "planning" / "iterate" / run_id / "layer_promotion_ack.json"
    ack_path.write_text(json.dumps({"run_id": run_id, "fingerprint": fingerprint}), encoding="utf-8")

    # The ack clears the STOP (exit 0) — it does NOT itself manufacture a
    # promotion: evidence is still absent, so nothing was promoted and no
    # manifest was written. See the next test for the realistic recovery path.
    second = run(args)
    assert second == 0
    second_output = json.loads(escalation_path.read_text(encoding="utf-8"))
    assert second_output["promoted"] == []
    assert not manifest_path.is_file()


def test_ack_plus_fresh_green_evidence_promotes_on_rerun(stub_plugin_root, tmp_path):
    """The realistic recovery path: an operator's ack does not fabricate a
    pass by itself (see the test above) — it clears the STOP so a re-run with
    the missing evidence actually supplied can decide normally."""
    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}},
        spec_text=_ONE_ROW_SPEC_TEXT,
    )
    run_id = "iterate-2026-09-07-w5-bind-and-promote"
    args_no_evidence = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id=run_id, vitest_report=[],
    )
    assert run(args_no_evidence) == 3

    vitest = tmp_path / "vitest.json"
    vitest.write_text(json.dumps({"results": {"a.test.ts::x": {"status": "enabled", "executed": "pass"}}}), encoding="utf-8")
    args_with_evidence = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id=run_id, vitest_report=[f"server={vitest}"],
    )
    assert run(args_with_evidence) == 0
    assert "| FR-01.01 | PRJ | One | Must | Does a thing | crawl | unit |" in spec_path.read_text(encoding="utf-8")


def test_a_stale_ack_from_a_different_escalation_set_does_not_clear_the_stop(stub_plugin_root, tmp_path):
    spec_path, manifest_path, ledger_path = _write_inputs(
        tmp_path, {"FR-01.01": {"unit": [{"id": "a.test.ts::x", "status": "enabled"}]}}
    )
    run_id = "iterate-2026-09-07-w5-bind-and-promote"
    ack_path = tmp_path / ".shipwright" / "planning" / "iterate" / run_id / "layer_promotion_ack.json"
    ack_path.parent.mkdir(parents=True)
    ack_path.write_text(json.dumps({"run_id": run_id, "fingerprint": "not-the-real-fingerprint"}), encoding="utf-8")

    args = _args(
        project_root=str(tmp_path), plugin_root=str(stub_plugin_root),
        manifest_path=str(manifest_path), spec_path=str(spec_path), ledger_path=str(ledger_path),
        run_id=run_id, vitest_report=[],
    )
    assert run(args) == 3

"""Unit tests for the pure FR layer-promotion predicate (w5).

@covers FR-01.66
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import layer_promotion as lp  # noqa: E402


def _req(**kwargs):
    base = {
        "id": "FR-01.99",
        "status": "active",
        "required_layers": [],
        "required_layers_source": "inferred_legacy",
        "tests": {},
    }
    base.update(kwargs)
    return base


def _enabled(test_id: str) -> dict:
    return {"id": test_id, "status": "enabled"}


def _quarantined(test_id: str) -> dict:
    return {"id": test_id, "status": "quarantined"}


def test_observed_layers_ignores_disabled_tests():
    tests = {
        "unit": [_enabled("a.test.ts::x")],
        "e2e": [{"id": "b.spec.ts::y", "status": "quarantined"}],
    }
    assert lp.observed_layers(tests) == ["unit"]


def test_observed_layers_sorted_by_rank():
    tests = {"e2e": [_enabled("a")], "unit": [_enabled("b")], "integration": [_enabled("c")]}
    assert lp.observed_layers(tests) == ["unit", "integration", "e2e"]


def test_a_quarantined_manifest_binding_never_counts_as_observed_coverage():
    """External plan review (GLM, low): a bound test marked skipped/quarantined
    IN THE MANIFEST (a tagging-side advisory, distinct from the EVIDENCE side's
    own runtime executed status) must not silently count toward the observed
    layer set — it carries no coverage obligation, matching the shared evidence
    vocab's own status precedence (quarantined never outranks enabled)."""
    req = _req(tests={"unit": [_quarantined("a.test.ts::x")]})
    d = lp.evaluate_requirement("FR-01.99", req, {}, {})
    assert d["action"] == lp.ACTION_ESCALATE
    assert d["reason_code"] == lp.ESCALATE_NO_OBSERVABLE_LAYER


def test_a_quarantined_test_is_excluded_even_when_evidence_would_have_passed():
    """The quarantined binding is excluded from consideration entirely — its
    evidence (even if green) never contributes to a promotion decision. Only
    the OTHER enabled test in the same layer decides it."""
    req = _req(tests={"unit": [
        _quarantined("a.test.ts::flaky"),
        _enabled("a.test.ts::real"),
    ]})
    evidence = {
        "a.test.ts::flaky": {"status": "enabled", "executed": "pass"},
        "a.test.ts::real": {"status": "enabled", "executed": "pass"},
    }
    d = lp.evaluate_requirement("FR-01.99", req, evidence, {})
    assert d["action"] == lp.ACTION_PROMOTE
    assert d["evidence_test_ids"] == ["a.test.ts::real"]


def test_no_observable_layer_escalates():
    req = _req(tests={})
    d = lp.evaluate_requirement("FR-01.01", req, {}, {})
    assert d["action"] == lp.ACTION_ESCALATE
    assert d["reason_code"] == lp.ESCALATE_NO_OBSERVABLE_LAYER


def test_already_explicit_is_terminal_no_reevaluation():
    req = _req(required_layers_source="explicit", tests={})
    d = lp.evaluate_requirement("FR-01.01", req, {}, {})
    assert d["action"] == lp.ACTION_SKIP_ALREADY_EXPLICIT


def test_removed_requirement_is_skipped():
    req = _req(status="removed")
    d = lp.evaluate_requirement("FR-01.01", req, {}, {})
    assert d["action"] == lp.ACTION_SKIP_REMOVED


def test_ledger_demotion_contradiction_escalates():
    req = _req(tests={"unit": [_enabled("a.test.ts::x")]})
    evidence = {"a.test.ts::x": {"status": "enabled", "executed": "pass"}}
    ledger = {"FR-01.99": {"status": "demoted"}}
    d = lp.evaluate_requirement("FR-01.99", req, evidence, ledger)
    assert d["action"] == lp.ACTION_ESCALATE
    assert d["reason_code"] == lp.ESCALATE_CONTRADICTS_LEDGER


def test_missing_evidence_is_absent_not_fail_escalates():
    req = _req(tests={"unit": [_enabled("a.test.ts::x")]})
    d = lp.evaluate_requirement("FR-01.99", req, {}, {})
    assert d["action"] == lp.ACTION_ESCALATE
    assert d["reason_code"] == lp.ESCALATE_ABSENT_CI_EVIDENCE
    assert d["missing_test_ids"] == ["a.test.ts::x"]


def test_missing_evidence_flags_parameterized_title_join_gap():
    """A `test.each`-style title still carries its unresolved `${...}`
    placeholder in the static manifest id — it can never join a vitest JSON
    report's runtime-interpolated title. Flagged for the operator, never
    silently assumed green."""
    req = _req(tests={"unit": [
        _enabled("a.test.ts::${term} resolves"),
        _enabled("a.test.ts::plain case"),
    ]})
    evidence = {"a.test.ts::plain case": {"status": "enabled", "executed": "pass"}}
    d = lp.evaluate_requirement("FR-01.99", req, evidence, {})
    assert d["action"] == lp.ACTION_ESCALATE
    assert d["missing_test_ids"] == ["a.test.ts::${term} resolves"]
    assert d["likely_parameterized_title_join_gap"] == ["a.test.ts::${term} resolves"]


def test_not_run_evidence_is_absent_escalates():
    req = _req(tests={"unit": [_enabled("a.test.ts::x")]})
    evidence = {"a.test.ts::x": {"status": "enabled", "executed": "not_run"}}
    d = lp.evaluate_requirement("FR-01.99", req, evidence, {})
    assert d["action"] == lp.ACTION_ESCALATE
    assert d["reason_code"] == lp.ESCALATE_ABSENT_CI_EVIDENCE


def test_failing_evidence_skips_not_green_no_escalation():
    req = _req(tests={"unit": [_enabled("a.test.ts::x")]})
    evidence = {"a.test.ts::x": {"status": "enabled", "executed": "fail"}}
    d = lp.evaluate_requirement("FR-01.99", req, evidence, {})
    assert d["action"] == lp.ACTION_SKIP_NOT_GREEN
    assert d["failing_test_ids"] == ["a.test.ts::x"]


def test_all_green_promotes_with_full_observed_layer_set():
    req = _req(tests={
        "unit": [_enabled("a.test.ts::x")],
        "e2e": [_enabled("b.spec.ts::y")],
    })
    evidence = {
        "a.test.ts::x": {"status": "enabled", "executed": "pass"},
        "b.spec.ts::y": {"status": "enabled", "executed": "pass"},
    }
    d = lp.evaluate_requirement("FR-01.99", req, evidence, {})
    assert d["action"] == lp.ACTION_PROMOTE
    assert d["layers"] == ["unit", "e2e"]
    assert set(d["evidence_test_ids"]) == {"a.test.ts::x", "b.spec.ts::y"}


def test_one_red_layer_blocks_promotion_of_the_whole_fr():
    """A green top layer must NOT promote while a lower bound layer is red —
    promoting required_layers=[unit, e2e] would misrepresent unit as covered."""
    req = _req(tests={
        "unit": [_enabled("a.test.ts::x")],
        "e2e": [_enabled("b.spec.ts::y")],
    })
    evidence = {
        "a.test.ts::x": {"status": "enabled", "executed": "fail"},
        "b.spec.ts::y": {"status": "enabled", "executed": "pass"},
    }
    d = lp.evaluate_requirement("FR-01.99", req, evidence, {})
    assert d["action"] == lp.ACTION_SKIP_NOT_GREEN
    assert d["failing_test_ids"] == ["a.test.ts::x"]


def test_unknown_layer_names_are_named_in_the_no_observable_layer_escalation():
    """External plan review (GLM, low #9a): a typo'd/future layer name outside
    LAYER_RANK must not be silently invisible — it is named in the escalation
    detail, not just dropped."""
    req = _req(tests={"perf": [_enabled("a.test.ts::x")]})
    d = lp.evaluate_requirement("FR-01.99", req, {}, {})
    assert d["action"] == lp.ACTION_ESCALATE
    assert d["reason_code"] == lp.ESCALATE_NO_OBSERVABLE_LAYER
    assert d["unknown_layer_names"] == ["perf"]
    assert "perf" in d["detail"]


def test_a_non_dict_evidence_entry_is_treated_as_missing_not_a_crash():
    """External plan review (GLM, low #7): a malformed evidence value (not a
    dict) must fail closed as absent evidence, never raise AttributeError."""
    req = _req(tests={"unit": [_enabled("a.test.ts::x")]})
    evidence = {"a.test.ts::x": "not-a-dict"}
    d = lp.evaluate_requirement("FR-01.99", req, evidence, {})
    assert d["action"] == lp.ACTION_ESCALATE
    assert d["reason_code"] == lp.ESCALATE_ABSENT_CI_EVIDENCE
    assert d["missing_test_ids"] == ["a.test.ts::x"]


def test_evaluate_manifest_partitions_decisions():
    requirements = {
        "01::FR-01.01": _req(id="FR-01.01", tests={"unit": [_enabled("a::x")]}),
        "01::FR-01.02": _req(id="FR-01.02", tests={}),
        "01::FR-01.03": _req(id="FR-01.03", status="removed"),
    }
    evidence = {"a::x": {"status": "enabled", "executed": "pass"}}
    out = lp.evaluate_manifest(requirements, evidence, {})
    assert [d["fr_id"] for d in out["promotions"]] == ["FR-01.01"]
    assert [d["fr_id"] for d in out["escalations"]] == ["FR-01.02"]
    assert out["total_evaluated"] == 2  # removed FR is never counted
    # External plan review (GLM, low #9b): a removed FR must still be NAMED in
    # the run's own report, not silently dropped from every output list.
    assert out["removed_fr_ids"] == ["FR-01.03"]


def test_systemic_pattern_none_for_a_handful():
    escalations = [{"fr_id": f"FR-01.0{i}", "reason_code": lp.ESCALATE_ABSENT_CI_EVIDENCE} for i in range(2)]
    assert lp.systemic_pattern(escalations, total_evaluated=20) is None


def test_systemic_pattern_fires_when_most_of_the_set_escalates():
    escalations = [
        {"fr_id": f"FR-01.{i:02d}", "reason_code": lp.ESCALATE_ABSENT_CI_EVIDENCE} for i in range(17)
    ]
    out = lp.systemic_pattern(escalations, total_evaluated=32)
    assert out is not None
    assert out["escalated_count"] == 17
    assert out["by_reason_code"][lp.ESCALATE_ABSENT_CI_EVIDENCE] == sorted(e["fr_id"] for e in escalations)
    assert out["no_evidence_fed_for_layer_fr_ids"] == sorted(e["fr_id"] for e in escalations)
    assert out["likely_parameterized_title_join_gap_fr_ids"] == []


def test_systemic_pattern_separates_join_gap_from_missing_layer_evidence():
    escalations = [
        {"fr_id": "FR-01.01", "reason_code": lp.ESCALATE_ABSENT_CI_EVIDENCE, "likely_parameterized_title_join_gap": ["x"]},
        {"fr_id": "FR-01.02", "reason_code": lp.ESCALATE_ABSENT_CI_EVIDENCE, "likely_parameterized_title_join_gap": []},
        {"fr_id": "FR-01.03", "reason_code": lp.ESCALATE_ABSENT_CI_EVIDENCE, "likely_parameterized_title_join_gap": []},
    ]
    out = lp.systemic_pattern(escalations, total_evaluated=4)
    assert out["likely_parameterized_title_join_gap_fr_ids"] == ["FR-01.01"]
    assert out["no_evidence_fed_for_layer_fr_ids"] == ["FR-01.02", "FR-01.03"]


def test_apply_promotion_to_row_cells_replaces_last_only():
    cells = ("FR-01.01", "PRJ", "Name", "Must", "Description", "basis", "(inferred)")
    out = lp.apply_promotion_to_row_cells(cells, "unit, e2e")
    assert out == ("FR-01.01", "PRJ", "Name", "Must", "Description", "basis", "unit, e2e")


def test_ledger_record_shape():
    rec = lp.ledger_record(
        "FR-01.01", ["unit"], "iterate-2026-09-07-w5", ["a::x"], "2026-09-07T00:00:00Z",
        evidence_source_commit="deadbeef",
    )
    assert rec == {
        "status": "promoted",
        "layers": ["unit"],
        "run_id": "iterate-2026-09-07-w5",
        "promoted_at": "2026-09-07T00:00:00Z",
        "evidence_test_ids": ["a::x"],
        "evidence_source_commit": "deadbeef",
    }

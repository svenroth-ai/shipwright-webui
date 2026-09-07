"""Unit tests for `scripts/ci/traceability_manifest_diff.py`'s pure diff logic
(split out of `traceability_manifest_gate.py` at the bloat ceiling).

Deliberately does NOT exercise `run()` against the REAL collector — that
needs a real checked-out shipwright-compliance plugin (network + `uv`),
which is what the CI job itself provides. This module covers the SCOPE
DECISION half: what `_normalize` deliberately neutralizes and why (evidence
fields, coverage values, link/orphan/invalid_tag order, `source_commit`) —
i.e. what must NOT count as drift. What DOES count as drift, `_summarize_diff`,
and malformed-input tolerance live in `test_traceability_manifest_diff_drift.py`
(split at the bloat ceiling, same seam). `run()`'s own control flow is covered
network-free against a STUB collector in `test_traceability_manifest_gate_run.py`
and `test_traceability_manifest_gate_run_infra_failures.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from traceability_manifest_diff import _normalize  # noqa: E402
from traceability_manifest_fixtures import _link, _manifest  # noqa: E402


def test_generated_at_alone_does_not_count_as_drift() -> None:
    """A regen minutes apart from the committed one must not be reported stale
    purely because the clock moved."""
    committed = _manifest(
        generated_at="2026-01-01T00:00:00+00:00",
        source_commit="deadbeef",
        links=[_link("a.test.ts::case", status="enabled", executed="pass")],
    )
    fresh = _manifest(
        generated_at="2026-09-06T12:00:00+00:00",
        source_commit="deadbeef",
        links=[_link("a.test.ts::case", status="enabled", executed="pass")],
    )
    assert _normalize(committed) == _normalize(fresh)


def test_execution_evidence_alone_does_not_count_as_drift() -> None:
    """A bare CI regen (no test suite run in this job) always reads every link
    as `not_run` — see the module's SCOPE DECISION. That must not, by itself,
    make an otherwise-current manifest report as stale."""
    committed = _manifest(
        generated_at="2026-01-01T00:00:00+00:00",
        source_commit="deadbeef",
        links=[_link("a.test.ts::case", status="enabled", executed="pass")],
    )
    fresh = _manifest(
        generated_at="1970-01-01T00:00:00+00:00",
        source_commit="deadbeef",
        links=[_link("a.test.ts::case", status="enabled", executed="not_run")],
    )
    assert _normalize(committed) == _normalize(fresh)


def test_source_commit_mismatch_alone_does_not_count_as_drift() -> None:
    """REVERSED after external code review, 2026-09-06 (reject-severity): a
    manifest can never embed the hash of the commit it will be committed
    inside of, so `committed.source_commit == HEAD` is unsatisfiable by
    construction on every commit, not just until a regen lands — confirmed
    empirically against this repo's own history (see the module docstring).
    `source_commit` is informational provenance, like `generated_at`; only
    the FR<->test topology fields decide staleness."""
    committed = _manifest(
        generated_at="x", source_commit="old-sha-many-commits-behind",
        links=[_link("a.test.ts::case")],
    )
    fresh = _manifest(
        generated_at="x", source_commit="brand-new-head-sha",
        links=[_link("a.test.ts::case")],
    )
    assert _normalize(committed) == _normalize(fresh)


def test_coverage_value_alone_does_not_count_as_drift() -> None:
    """`coverage` is a pure derivative of the `status`/`executed` link fields
    this gate already strips: the collector's `_cov_status` returns `"ok"`
    iff a link is enabled AND `executed == "pass"`. Since this gate always
    regenerates with `evidence={}`, a committed manifest carrying real
    execution evidence (`coverage: "ok"`) would otherwise report drift
    against a fresh regen (`coverage: "MISSING"`) forever, for a reason
    unrelated to FR<->test topology — external code review, 2026-09-06,
    high severity."""
    committed = _manifest(
        generated_at="x", source_commit="same",
        links=[_link("a.test.ts::case", status="enabled", executed="pass")],
        coverage={"unit": "ok"},
    )
    fresh = _manifest(
        generated_at="x", source_commit="same",
        links=[_link("a.test.ts::case", status="enabled", executed="not_run")],
        coverage={"unit": "MISSING"},
    )
    assert _normalize(committed) == _normalize(fresh)


def test_coverage_key_set_change_IS_drift() -> None:
    """The `coverage` KEY SET (which layers are required/filed) is genuine
    topology and must still surface — only the per-layer VERDICT is
    evidence-derived and neutralized above."""
    committed = _manifest(
        generated_at="x", source_commit="same",
        links=[_link("a.test.ts::case")],
        coverage={"unit": "MISSING"},
    )
    fresh = _manifest(
        generated_at="x", source_commit="same",
        links=[_link("a.test.ts::case")],
        coverage={"unit": "MISSING", "e2e": "MISSING"},
    )
    assert _normalize(committed) != _normalize(fresh)


def test_link_order_alone_does_not_count_as_drift() -> None:
    """Upstream emits links in `sorted(found)` over `pathlib.Path` objects —
    an order that differs across OS (case-fold on Windows vs. case-sensitive
    on POSIX) and CPython version. The SET of bindings is the real signal;
    the committed manifest's order (produced on whatever machine ran the
    regen) must not itself count as drift — external code review,
    2026-09-06, high severity."""
    committed = _manifest(
        generated_at="x", source_commit="same",
        links=[_link("a.test.ts::case"), _link("b.test.ts::case")],
    )
    fresh = _manifest(
        generated_at="x", source_commit="same",
        links=[_link("b.test.ts::case"), _link("a.test.ts::case")],
    )
    assert _normalize(committed) == _normalize(fresh)


def test_orphan_order_alone_does_not_count_as_drift() -> None:
    """`orphans` is populated during the same per-file scan (`sorted(found)`
    over `Path` objects) as the link lists above — same OS/CPython ordering
    caveat applies (external code review, 2026-09-06 round 2, high severity:
    the round-1 fix only sorted `tests` link lists, missing this field)."""
    orphan_a = {"test": "a.test.ts::case", "tagged_fr": "FR-99.99", "reason": "no such FR", "category": "orphan"}
    orphan_b = {"test": "b.test.ts::case", "tagged_fr": "FR-88.88", "reason": "no such FR", "category": "orphan"}
    committed = _manifest(generated_at="x", source_commit="same", links=[_link("a.test.ts::case")])
    committed["orphans"] = [orphan_a, orphan_b]
    fresh = _manifest(generated_at="x", source_commit="same", links=[_link("a.test.ts::case")])
    fresh["orphans"] = [orphan_b, orphan_a]

    assert _normalize(committed) == _normalize(fresh)


def test_invalid_tags_order_alone_does_not_count_as_drift() -> None:
    """`invalid_tags` is populated during the same per-file scan as
    `orphans` — same ordering caveat (external code review, 2026-09-06
    round 2, high severity)."""
    tag_a = {"test": "a.test.ts::case", "raw": "@covers bogus", "reason": "malformed"}
    tag_b = {"test": "b.test.ts::case", "raw": "@covers also-bogus", "reason": "malformed"}
    committed = _manifest(generated_at="x", source_commit="same", links=[_link("a.test.ts::case")])
    committed["invalid_tags"] = [tag_a, tag_b]
    fresh = _manifest(generated_at="x", source_commit="same", links=[_link("a.test.ts::case")])
    fresh["invalid_tags"] = [tag_b, tag_a]

    assert _normalize(committed) == _normalize(fresh)


def test_orphan_and_invalid_tag_set_change_IS_drift() -> None:
    """The order-insensitivity above must not neutralize a genuine content
    change — the SET of orphans/invalid_tags is still real topology."""
    orphan_a = {"test": "a.test.ts::case", "tagged_fr": "FR-99.99", "reason": "no such FR", "category": "orphan"}
    orphan_c = {"test": "c.test.ts::case", "tagged_fr": "FR-77.77", "reason": "no such FR", "category": "orphan"}
    committed = _manifest(generated_at="x", source_commit="same", links=[_link("a.test.ts::case")])
    committed["orphans"] = [orphan_a]
    fresh = _manifest(generated_at="x", source_commit="same", links=[_link("a.test.ts::case")])
    fresh["orphans"] = [orphan_a, orphan_c]

    assert _normalize(committed) != _normalize(fresh)


def test_normalize_never_mutates_its_argument() -> None:
    original = _manifest(
        generated_at="x", source_commit="same",
        links=[_link("a.test.ts::case", status="enabled", executed="pass")],
    )
    import copy

    before = copy.deepcopy(original)
    _normalize(original)
    assert original == before

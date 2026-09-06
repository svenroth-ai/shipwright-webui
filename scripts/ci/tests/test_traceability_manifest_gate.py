"""Unit tests for `scripts/ci/traceability_manifest_gate.py`'s pure diff logic.

Deliberately does NOT exercise `run()` against the REAL collector — that
needs a real checked-out shipwright-compliance plugin (network + `uv`),
which is what the CI job itself provides. This module covers the part every
PR touching this file CAN verify locally offline: the normalization (what
the gate deliberately ignores, and why) and the diff summary. `run()`'s own
control flow (import-contract guard, exit codes, missing-manifest handling)
is covered network-free against a STUB collector in
`test_traceability_manifest_gate_run.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from traceability_manifest_gate import _normalize, _summarize_diff  # noqa: E402


def _link(id_: str, *, status: str = "enabled", executed: str = "not_run") -> dict:
    return {"id": id_, "path": id_, "layer": "unit", "status": status, "executed": executed,
            "tag_source": "covers_comment"}


def _manifest(*, generated_at: str, source_commit: str, links: list[dict]) -> dict:
    return {
        "schema_version": 3,
        "collector_version": "test_links/1.0.0",
        "generated_at": generated_at,
        "source_commit": source_commit,
        "spec_hash": "sha256:aaaa",
        "requirements": {
            "01::FR-01.01": {
                "id": "FR-01.01",
                "status": "active",
                "tests": {"unit": links},
            }
        },
        "orphans": [],
        "invalid_tags": [],
        "invalid_layers": [],
        "untagged_tests": [],
    }


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


def test_schema_version_mismatch_IS_drift() -> None:
    """`schema_version` is not in `_TOP_LEVEL_IGNORED_FIELDS`, so a collector
    upgrade that bumps it must not be silently normalized away — external
    plan review, 2026-09-06 (schema drift should fail loud, not pass quiet)."""
    committed = _manifest(
        generated_at="x", source_commit="same",
        links=[_link("a.test.ts::case")],
    )
    fresh = dict(committed, schema_version=committed["schema_version"] + 1)

    assert _normalize(committed) != _normalize(fresh)
    diff = _summarize_diff(_normalize(committed), _normalize(fresh))
    assert any("schema_version" in line for line in diff)


def test_a_removed_covers_binding_IS_drift() -> None:
    """A test whose `@covers` tag was deleted (or a spec FR whose test binding
    changed) must surface — this is the actual staleness this gate exists for."""
    committed = _manifest(
        generated_at="x", source_commit="same",
        links=[_link("a.test.ts::case"), _link("b.test.ts::case")],
    )
    fresh = _manifest(
        generated_at="x", source_commit="same",
        links=[_link("a.test.ts::case")],
    )
    assert _normalize(committed) != _normalize(fresh)
    diff = _summarize_diff(_normalize(committed), _normalize(fresh))
    assert any("test bindings changed" in line for line in diff)


def test_summarize_diff_tolerates_a_malformed_shared_requirement_value() -> None:
    """`_summarize_diff` is documented as best-effort — a hand-edited or
    malformed committed manifest mapping a shared requirement key to
    something other than a dict must not crash the failure-reporting path
    itself (external code review, 2026-09-06, low severity)."""
    committed = _manifest(
        generated_at="x", source_commit="same",
        links=[_link("a.test.ts::case")],
    )
    fresh = _manifest(
        generated_at="x", source_commit="same",
        links=[_link("a.test.ts::case"), _link("b.test.ts::case")],
    )
    # The vulnerable lookup is specifically `fresh_reqs[key].get('id', ...)`
    # — malform the FRESH side so the two sides differ (a real dict vs.
    # `None`) and the `.get()` call would previously have raised
    # `AttributeError: 'NoneType' object has no attribute 'get'`.
    fresh["requirements"]["01::FR-01.01"] = None

    diff = _summarize_diff(committed, fresh)
    assert any("01::FR-01.01 (?)" in line for line in diff)


def test_normalize_never_mutates_its_argument() -> None:
    original = _manifest(
        generated_at="x", source_commit="same",
        links=[_link("a.test.ts::case", status="enabled", executed="pass")],
    )
    import copy

    before = copy.deepcopy(original)
    _normalize(original)
    assert original == before

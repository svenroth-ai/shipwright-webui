"""Unit tests for `scripts/ci/traceability_manifest_diff.py`: the IS-drift
half, `_summarize_diff`, and malformed-input tolerance. Split out of
`test_traceability_manifest_diff.py` at the bloat ceiling (same seam — that
module covers the SCOPE DECISION / non-drift half: what must NOT count as
drift). This module covers what DOES count as drift, the human-readable
diff summary, and the guards that keep both functions from crashing on a
hand-edited or older-schema manifest.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from traceability_manifest_diff import _normalize, _summarize_diff  # noqa: E402
from traceability_manifest_fixtures import _link, _manifest  # noqa: E402


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


def test_summarize_diff_reports_an_unenumerated_top_level_field() -> None:
    """`fold_map`/`fold_defects`/`invalid_ids` (and any future field the
    unvendored, unversioned collector adds) are not individually enumerated
    by `_summarize_diff` — without a fallback, drift confined to one of them
    exits 1 with an empty `diff` array: a red build with no actionable log
    line — external code review, 2026-09-06, medium severity."""
    committed = _manifest(generated_at="x", source_commit="same", links=[_link("a.test.ts::case")])
    committed["fold_map"] = {"01::FR-01.01": "01::FR-01.01"}
    fresh = _manifest(generated_at="x", source_commit="same", links=[_link("a.test.ts::case")])
    fresh["fold_map"] = {"01::FR-01.01": "01::FR-01.02"}

    normalized_committed, normalized_fresh = _normalize(committed), _normalize(fresh)
    assert normalized_committed != normalized_fresh
    diff = _summarize_diff(normalized_committed, normalized_fresh)
    assert any("fold_map" in line for line in diff)


def test_normalize_tolerates_a_malformed_requirement_node_and_layer_value() -> None:
    """A hand-edited or older-schema committed manifest could map a
    requirement key to a non-dict, or a layer's `tests` entry to a non-list —
    `_normalize` must report these as a content difference rather than crash
    on `.get`/iteration (external code review, 2026-09-06 round 2, low
    severity: the pre-existing malformed-node test only exercised
    `_summarize_diff` directly, never through `_normalize`'s own guard, which
    is what `run()` actually calls first in production order)."""
    committed = _manifest(generated_at="x", source_commit="same", links=[_link("a.test.ts::case")])
    committed["requirements"]["01::FR-01.01"] = "not-a-dict"
    fresh = _manifest(generated_at="x", source_commit="same", links=[_link("a.test.ts::case")])
    fresh["requirements"]["01::FR-01.01"]["tests"]["unit"] = "not-a-list"

    normalized_committed = _normalize(committed)
    normalized_fresh = _normalize(fresh)
    assert normalized_committed != normalized_fresh
    # Must not raise — the guard tolerates both malformed shapes.
    _summarize_diff(normalized_committed, normalized_fresh)

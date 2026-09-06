"""Shared manifest-building helpers for the traceability-manifest diff test
suite. Split out (bloat ceiling) so neither `test_traceability_manifest_diff.py`
(the SCOPE DECISION / non-drift tests) nor
`test_traceability_manifest_diff_drift.py` (the IS-drift + malformed-input
tolerance tests) needs to duplicate them.
"""

from __future__ import annotations


def _link(id_: str, *, status: str = "enabled", executed: str = "not_run") -> dict:
    return {"id": id_, "path": id_, "layer": "unit", "status": status, "executed": executed,
            "tag_source": "covers_comment"}


def _manifest(*, generated_at: str, source_commit: str, links: list[dict],
              coverage: dict | None = None) -> dict:
    req: dict = {
        "id": "FR-01.01",
        "status": "active",
        "tests": {"unit": links},
    }
    if coverage is not None:
        req["coverage"] = coverage
    return {
        "schema_version": 3,
        "collector_version": "test_links/1.0.0",
        "generated_at": generated_at,
        "source_commit": source_commit,
        "spec_hash": "sha256:aaaa",
        "requirements": {"01::FR-01.01": req},
        "orphans": [],
        "invalid_tags": [],
        "invalid_layers": [],
        "untagged_tests": [],
    }

"""Systemic-pattern reporting for FR layer promotion (w5, S10).

Split out of ``layer_promotion.py`` (bloat cap, CLAUDE.md "Files under 300
lines"): this module owns ONLY the "most of the set escalated" summary —
never a promotion/escalation DECISION, which stays in ``layer_promotion.py``.
Re-exported there as ``layer_promotion.systemic_pattern`` so every existing
call site (``lp.systemic_pattern(...)``) is unchanged.

Deliberately does NOT import from ``layer_promotion`` (that module imports
THIS one for the re-export — importing back would be circular). The
``absent_ci_evidence`` reason-code string is duplicated as a local literal
below rather than shared, matching the same value ``layer_promotion.
ESCALATE_ABSENT_CI_EVIDENCE`` holds; a drift here would only ever misfile
the join-gap sub-classification, never a promotion decision.
"""

from __future__ import annotations

from typing import Any

_ESCALATE_ABSENT_CI_EVIDENCE = "absent_ci_evidence"

# Systemic-pattern threshold (p3.5 doc: "if the run finds itself escalating
# most of the set, that is a signal the predicate is wrong — stop and say so,
# rather than routing twenty decisions to a person"). Strictly greater than
# half, so an even split (rare) does not itself trip the systemic label.
_SYSTEMIC_ESCALATION_FRACTION = 0.5


def systemic_pattern(escalations: list[dict], total_evaluated: int) -> dict[str, Any] | None:
    """When escalations are MOST of the evaluated set, name the pattern once
    instead of reporting N look-alike surprises (p3.5 doc, verbatim guidance).

    Returns ``None`` when escalations are within the expected "zero to a
    handful" volume. Grouped by ``reason_code`` so the operator sees WHICH
    structural gap dominates (e.g. "no e2e evidence was fed into this run"),
    not just a raw count.
    """
    if not escalations or total_evaluated == 0:
        return None
    if len(escalations) <= total_evaluated * _SYSTEMIC_ESCALATION_FRACTION:
        return None
    by_reason: dict[str, list[str]] = {}
    join_gap_ids: list[str] = []
    evidence_gap_ids: list[str] = []
    for esc in escalations:
        by_reason.setdefault(esc["reason_code"], []).append(esc["fr_id"])
        if esc.get("likely_parameterized_title_join_gap"):
            join_gap_ids.append(esc["fr_id"])
        elif esc["reason_code"] == _ESCALATE_ABSENT_CI_EVIDENCE:
            evidence_gap_ids.append(esc["fr_id"])
    return {
        "escalated_count": len(escalations),
        "total_evaluated": total_evaluated,
        "by_reason_code": {code: sorted(ids) for code, ids in by_reason.items()},
        # Sub-classification of `absent_ci_evidence` ONLY (never auto-resolved —
        # see evaluate_requirement's docstring on why guessing a join is unsafe).
        "likely_parameterized_title_join_gap_fr_ids": sorted(join_gap_ids),
        "no_evidence_fed_for_layer_fr_ids": sorted(evidence_gap_ids),
        "message": (
            f"{len(escalations)}/{total_evaluated} requirements escalated — that is most of "
            "the evaluated set, which the source rule reads as a signal the predicate itself "
            "is unmet at scale (e.g. a whole evidence layer was never fed into this run, or a "
            "class of test ids can never join fresh evidence), not as a handful of independent "
            "undecidable FRs. Stopping and naming the pattern rather than routing many "
            "near-identical decisions to the operator."
        ),
    }


__all__ = ["systemic_pattern"]

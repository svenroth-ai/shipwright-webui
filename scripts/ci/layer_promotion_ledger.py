"""Row-rewrite + ledger-record output helpers for FR layer promotion (w5, S10).

Split out of ``layer_promotion.py`` (bloat cap, CLAUDE.md "Files under 300
lines"): this module owns the PURE OUTPUT SHAPE of a promotion decision (the
rewritten row cells, the ledger entry) — never the DECISION itself, which
stays in ``layer_promotion.py``. Re-exported there as
``layer_promotion.apply_promotion_to_row_cells`` /
``layer_promotion.ledger_record`` so every existing call site
(``lp.apply_promotion_to_row_cells(...)``, ``lp.ledger_record(...)``) is
unchanged.

Deliberately does NOT import from ``layer_promotion`` (no circular
dependency): both functions are pure transforms of already-decided values.
"""

from __future__ import annotations

from typing import Any


def apply_promotion_to_row_cells(cells: tuple[str, ...], new_layers_cell: str) -> tuple[str, ...]:
    """Replace the LAST cell (Layers, per this repo's fixed table shape) of an
    already-parsed FR row. Pure — the caller re-escapes and re-joins the row."""
    if not cells:
        return cells
    return cells[:-1] + (new_layers_cell,)


def ledger_record(
    fr_id: str,
    layers: list[str],
    run_id: str,
    evidence_test_ids: list[str],
    promoted_at: str,
    evidence_source_commit: str = "",
) -> dict[str, Any]:
    """The one-way ledger entry recorded for a promoted FR.

    ``evidence_source_commit`` (external plan review, openai #5/#6) is the git
    HEAD the fresh evidence was collected against — provenance for "this
    promotion's green run was against THIS tree", not a cryptographic
    integrity proof of the cross-repo tooling itself (that trust model already
    matches every other script in ``scripts/ci/`` that imports the same pinned
    sibling checkout, e.g. ``traceability_manifest_gate.py``).
    """
    return {
        "status": "promoted",
        "layers": list(layers),
        "run_id": run_id,
        "promoted_at": promoted_at,
        "evidence_test_ids": list(evidence_test_ids),
        "evidence_source_commit": evidence_source_commit,
    }


__all__ = ["apply_promotion_to_row_cells", "ledger_record"]

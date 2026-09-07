"""Escalation-report + operator-ack helpers for FR layer promotion (w5, S10) --
split out of ``promote_fr_layers.py`` (bloat cap, CLAUDE.md "Files under 300
lines"): this module owns computing the escalation fingerprint, resolving the
escalation/ack paths, writing the escalation report when it is NOT folded into
a promotion's atomic write (no promotions this run), and checking a prior
operator ack against the current escalation set. It makes no promotion or
escalation DECISION of its own -- see ``layer_promotion.py`` for that.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from promote_fr_layers_paths import resolve_confined_path


def ack_fingerprint(escalations: list[dict]) -> str:
    ids = sorted(f"{e['fr_id']}:{e['reason_code']}" for e in escalations)
    return hashlib.sha256("\n".join(ids).encode("utf-8")).hexdigest()


def resolve_escalation_paths(
    project_root: Path, run_id: str, escalation_out_arg: str | None, ack_path_arg: str | None,
) -> tuple[Path, Path]:
    ack_dir = project_root / ".shipwright" / "planning" / "iterate" / run_id
    escalation_out = resolve_confined_path(project_root, escalation_out_arg, ack_dir / "layer_promotion_escalation.json")
    ack_path = resolve_confined_path(project_root, ack_path_arg, ack_dir / "layer_promotion_ack.json")
    return escalation_out, ack_path


def write_escalation_only(escalation_out: Path, content: str, atomic_write_text) -> str | None:
    """Used when this run has escalations but NO promotions -- nothing else
    was written, so there is no wider transaction to roll back, just this
    one file; guarded for a structured failure reason instead of an
    uncaught traceback. Returns an error reason, or ``None`` on success."""
    try:
        escalation_out.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_text(escalation_out, content)
    except OSError as exc:
        return f"failed writing the escalation report to {escalation_out}: {type(exc).__name__}: {exc}"
    return None


def check_ack(ack_path: Path, fingerprint: str, run_id: str) -> bool:
    """A stale ack from a DIFFERENT escalation set must not silently clear
    this one -- both the fingerprint AND the run_id must match."""
    if not ack_path.is_file():
        return False
    try:
        ack = json.loads(ack_path.read_text(encoding="utf-8"))
        return ack.get("fingerprint") == fingerprint and ack.get("run_id") == run_id
    except (OSError, json.JSONDecodeError):
        return False


__all__ = ["ack_fingerprint", "resolve_escalation_paths", "write_escalation_only", "check_ack"]

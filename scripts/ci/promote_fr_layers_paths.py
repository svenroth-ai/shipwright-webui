"""Trust-boundary helpers for FR layer promotion (w5, S10) -- split out of
``promote_fr_layers_io.py`` (bloat cap, CLAUDE.md "Files under 300 lines"):
this module owns every check that decides whether a CALLER-SUPPLIED path or
checkout is safe to read/write/import, and makes no promotion/escalation
decision and does no cross-repo import itself.
"""

from __future__ import annotations

import subprocess
from pathlib import Path


def resolve_confined_path(project_root: Path, raw: str | None, default: Path) -> Path:
    """Resolve a caller-overridable path (``--manifest-path``, ``--spec-path``,
    ``--ledger-path``, ``--escalation-out``, ``--ack-path``), confined to
    ``project_root`` (PR Review, blocking, round 3): these overrides
    previously accepted ANY path with no confinement check, so a mistaken or
    malicious override could read/write outside the project tree entirely.
    ``realpath`` + ``is_relative_to``, matching this monorepo's own
    path-guard convention (webui `CLAUDE.md` rule 10) -- never a bare
    ``startswith`` string check, which a sibling directory sharing a path
    prefix (e.g. ``/project-evil`` vs ``/project``) would defeat."""
    path = default if raw is None else Path(raw)
    resolved = path.resolve()
    if not resolved.is_relative_to(project_root):
        raise ValueError(
            f"'{raw}' resolves to '{resolved}', which is outside project_root "
            f"'{project_root}' -- refusing to read/write outside the project tree"
        )
    return resolved


def verify_commit_pin(root: Path, expect_commit: str) -> None:
    """Fail closed unless ``root``'s git HEAD is EXACTLY the commit the
    caller expects (code review, blocking): a caller-controlled path with no
    integrity check would let a modified/swapped checkout control manifest
    generation and file-writing behavior. This is the runtime half of the
    guarantee, not a substitute for the other half: a SHA-pinned
    ``actions/checkout`` step (mirroring the ``Traceability manifest (gate)``
    job in ``ci.yml``) is what makes a given ref trustworthy in the first
    place; this only confirms the path a CI invocation actually names is
    still that same checkout, not one that moved after the checkout step
    ran. Used for BOTH the plugin checkout (``import_cross_repo``) and the
    project checkout itself (``promote_fr_layers.run``'s evidence-freshness
    binding) -- same check, two different trees."""
    resolved = root.resolve()
    try:
        proc = subprocess.run(
            ["git", "-C", str(resolved), "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True, timeout=30,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(
            f"could not read the git HEAD of '{resolved}' to verify it matches the expected "
            f"commit {expect_commit!r}: {type(exc).__name__}: {exc}"
        ) from exc
    actual = proc.stdout.strip()
    if actual != expect_commit:
        raise RuntimeError(
            f"'{resolved}' is at commit {actual!r}, not the expected commit {expect_commit!r} "
            "-- refusing to proceed against an unverified checkout"
        )


__all__ = ["resolve_confined_path", "verify_commit_pin"]

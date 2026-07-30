"""Tests for the webui-vendored accepted-risk gate under ``scripts/ci/``.

Lives under ``scripts/ci/tests/`` so the existing `Reviewer Selftest` CI job
(``python -m pytest scripts/ci/tests``) runs it without a workflow change.

This file is the DRIFT GUARD half; the CLI's behavioural contract lives in
``test_accepted_risks_cli_contract.py`` (split when this file crossed the
300-line cap - the seam is real: one tests the VENDORING, the other the GATE).

1. **DRIFT GUARD** over ``scripts/ci/accepted_risks_vendor.json``. Vendored code
   rots silently: someone patches the copy in place, the canonical source moves
   on, and nothing says so. Both directions are enforced per the registry-driven
   SSoT rule - every manifest entry resolves to a file whose sha256 matches, AND
   every vendored module has a manifest entry. An in-place edit therefore fails
   CI until the manifest is updated, which is the moment to ask "did I mean to
   diverge from canonical?".

2. **PROVENANCE** - every vendored module states where it came from, and a
   copy that is NOT byte-identical to canonical says so where a reader will see
   it rather than only in a manifest field.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]
_CI_DIR = _REPO_ROOT / "scripts" / "ci"
_MANIFEST = _CI_DIR / "accepted_risks_vendor.json"
_CLI = _CI_DIR / "accepted_risks_cli.py"

#: Vendored-but-NOT-hash-pinned, each with a one-line reason. These carry a
#: provenance header but predate this manifest; listing them explicitly keeps
#: the gap VISIBLE rather than silently outside a name glob.
_NOT_HASH_PINNED = {
    "pr_review.py": "vendored 2026-06-12 with header-only provenance",
    "pr_review_lib.py": "vendored 2026-06-12 with header-only provenance",
}

#: A vendored module is one that CARRIES a provenance header - a property, not
#: a name. The previous version globbed `accepted_risk*.py` +
#: `gh_action_tag_owner.py`, i.e. exactly today's four files, so vendoring a
#: fifth leaf under any other name satisfied the reverse direction vacuously.
#: (Stage-2 review, CR-8.)
_PROVENANCE_MARKER = "# canonical-source-hash:"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _manifest() -> dict:
    return json.loads(_MANIFEST.read_text(encoding="utf-8"))


# ---------------------------------------------------------------- drift guard


def test_manifest_exists_and_is_wellformed() -> None:
    manifest = _manifest()
    assert manifest.get("canonical_repo"), "manifest must name the canonical repo"
    assert manifest.get("canonical_version"), "manifest must record the vendor version"
    assert manifest.get("modules"), "manifest must list the vendored modules"


@pytest.mark.parametrize("name", sorted(_manifest()["modules"]))
def test_forward_every_manifest_entry_matches_disk(name: str) -> None:
    """FORWARD: the recorded hash is the hash of the file actually on disk."""
    entry = _manifest()["modules"][name]
    path = _CI_DIR / name
    assert path.is_file(), f"{name} is in the manifest but missing from scripts/ci/"
    actual = _sha256(path)
    assert actual == entry["sha256"], (
        f"{name} has been edited in place.\n"
        f"  manifest: {entry['sha256']}\n"
        f"  on disk:  {actual}\n"
        "If the edit is intentional, update accepted_risks_vendor.json (and say in "
        "the header how this copy now diverges from canonical)."
    )


def test_reverse_every_vendored_module_is_recorded() -> None:
    """REVERSE: nothing vendored escapes the manifest."""
    on_disk = {
        p.name
        for p in _CI_DIR.glob("*.py")
        if p.is_file() and _PROVENANCE_MARKER in p.read_text(encoding="utf-8")
    }
    recorded = set(_manifest()["modules"])
    unpinned = on_disk - recorded - set(_NOT_HASH_PINNED)
    assert not unpinned, (
        "these files carry a vendored-provenance header but are in neither the "
        f"manifest nor the documented not-hash-pinned list: {sorted(unpinned)}. "
        "Add them to accepted_risks_vendor.json, or to _NOT_HASH_PINNED with a "
        "reason."
    )
    assert not recorded - on_disk, (
        f"manifest entries with no file on disk: {sorted(recorded - on_disk)}"
    )


@pytest.mark.parametrize("name", sorted(_manifest()["modules"]))
def test_every_module_carries_its_provenance_header(name: str) -> None:
    text = (_CI_DIR / name).read_text(encoding="utf-8")
    for key in (
        "# canonical-source-repo:",
        "# canonical-source-path:",
        "# canonical-source-hash:",
        "# canonical-source-version:",
    ):
        assert key in text, f"{name} is missing `{key}` in its vendored header"


def test_adapted_modules_say_how_they_diverge() -> None:
    """A copy that is NOT byte-identical must say so where a reader will see it."""
    for name, entry in _manifest()["modules"].items():
        text = (_CI_DIR / name).read_text(encoding="utf-8")
        if entry["adapted"]:
            assert "ADAPTED" in text, f"{name} is marked adapted but does not say how"
        else:
            assert "BYTE-IDENTICAL" in text, (
                f"{name} claims to be verbatim but does not state it"
            )

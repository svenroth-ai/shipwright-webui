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
import re
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]
_CI_DIR = _REPO_ROOT / "scripts" / "ci"
_MANIFEST = _CI_DIR / "accepted_risks_vendor.json"
_CLI = _CI_DIR / "accepted_risks_cli.py"

#: Vendored modules NOT covered by THIS manifest, each with a one-line reason.
#: Listing them explicitly keeps the situation VISIBLE rather than silently
#: outside a name glob. Three distinct reasons live here, and they are not
#: equally comfortable: the 2026-06-12 and 2026-07-28 groups are a real gap
#: (header-only, pinned nowhere), while the ADR-117 pair IS pinned — in
#: `test_pr_review_vendor_pins.py`, because this manifest carries ONE
#: top-level `canonical_commit` and they come from a different upstream commit
#: than the accepted-risk batch does. Recording them here would make that
#: field wrong for half the entries.
_NOT_HASH_PINNED = {
    "pr_review.py": "vendored 2026-06-12 with header-only provenance",
    "pr_review_lib.py": "vendored 2026-06-12 with header-only provenance",
    "pr_review_dismiss_select.py":
        "ADR-117 port, upstream commit 4146a610 — pinned in test_pr_review_vendor_pins.py",
    "pr_review_dismiss.py":
        "ADR-117 port, upstream commit 4146a610 — pinned in test_pr_review_vendor_pins.py",
    "pr_review_diff_filter.py":
        "vendored 2026-07-28 (canonical-parity iterate) with header-only provenance",
    "pr_review_generated.py":
        "vendored 2026-07-28 (canonical-parity iterate) with header-only provenance",
    "pr_review_render.py":
        "vendored 2026-07-28 (canonical-parity iterate) with header-only provenance",
    "pr_review_safe_path.py":
        "vendored 2026-07-28 (canonical-parity iterate) with header-only provenance",
    "pr_review_model_policy.py":
        "vendored 2026-09-01 (DeepSeek ZDR routing) with header-only provenance; "
        "self-contained merge of two canonical sources, see its module docstring",
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
    # The version is an iterate RUN ID, not a git ref, so it cannot be handed to
    # `git show` - which is why re-vendoring could not verify its own provenance
    # and every canonical_sha256 silently stayed a CRLF working-tree hash until
    # iterate-2026-07-31-revendor-accepted-risk-gate. The commit is what makes the
    # recorded upstream hashes reproducible, so it is guarded, not merely written.
    commit = manifest.get("canonical_commit")
    assert commit, (
        "manifest must record `canonical_commit` - the upstream commit the blobs "
        "were taken from. Without it `canonical_sha256` cannot be reproduced, and "
        "an unverifiable provenance field is how it went wrong last time."
    )
    assert re.fullmatch(r"[0-9a-f]{40}", commit), (
        f"canonical_commit must be a full 40-char sha, got {commit!r} - an "
        "abbreviation can become ambiguous as the canonical repo grows"
    )
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
    """REVERSE: nothing vendored escapes the manifest.

    RECURSIVE, and keyed on the path relative to ``scripts/ci`` rather than the
    bare filename. A non-recursive `glob("*.py")` went blind the moment a module
    landed in a subdirectory — and it failed together with the `eol=lf` pin,
    which is also non-recursive (`scripts/ci/*.py`), so such a module would have
    had neither a CRLF pin nor reverse-drift coverage: CR-8's vacuity, one
    directory down. Flat files key as their own name, so the manifest is
    unchanged. (Stage-3 doubt review, D-6.)

    `tests/` is excluded deliberately: this very file quotes the marker string,
    and a test is not a vendored module.
    """
    on_disk = {
        p.relative_to(_CI_DIR).as_posix()
        for p in _CI_DIR.rglob("*.py")
        if p.is_file()
        and "__pycache__" not in p.parts
        and "tests" not in p.relative_to(_CI_DIR).parts
        and _PROVENANCE_MARKER in p.read_text(encoding="utf-8")
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
        # Paired with the manifest's `canonical_commit`: the header is where a
        # reader actually looks, so the reproduction command must be there too.
        "# canonical-source-commit:",
    ):
        assert key in text, f"{name} is missing `{key}` in its vendored header"


@pytest.mark.parametrize("name", sorted(_manifest()["modules"]))
def test_header_provenance_agrees_with_the_manifest(name: str) -> None:
    """The header's values must BE the manifest's, not merely be present.

    Presence-only checking is how the provenance rotted the first time: every
    `canonical_sha256` sat wrong (a CRLF working-tree hash matching no upstream
    blob) for a whole window while the guards stayed green, because nothing ever
    compared a recorded value to anything
    (iterate-2026-07-31-revendor-accepted-risk-gate).

    This closes the last unenforced surface reachable WITHOUT a sibling clone:
    header vs manifest is a local string comparison. Whether either matches real
    upstream still needs a clone, and stays a hand-check by recorded decision.
    """
    text = (_CI_DIR / name).read_text(encoding="utf-8")
    manifest = _manifest()
    entry = manifest["modules"][name]
    for label, pattern, expected in (
        ("commit", r"^# canonical-source-commit: (\S+)$", manifest["canonical_commit"]),
        ("hash", r"^# canonical-source-hash: (\S+)$", entry["canonical_sha256"]),
        ("path", r"^# canonical-source-path: (\S+)$", entry["canonical_path"]),
        ("version", r"^# canonical-source-version: (\S+)$", manifest["canonical_version"]),
        # The repo is the single most supply-chain-relevant field here — a header
        # pointing at someone else's fork is the whole attack — and it was the one
        # field the first draft of this test skipped. (Stage-3 doubt review, D-4.)
        ("repo", r"^# canonical-source-repo: (\S+)$", manifest["canonical_repo"]),
    ):
        # findall, not search: `search` takes the FIRST match, so a module could
        # carry a correct line up top and a second, drifted one lower down where
        # a reader actually looks, and pass. (Stage-3 doubt review, D-4.)
        found = re.findall(pattern, text, re.M)
        assert len(found) == 1, (
            f"{name}: expected exactly one `# canonical-source-{label}:` line, "
            f"found {len(found)}. Two provenance lines mean one of them is a lie."
        )
        assert found[0] == expected, (
            f"{name}: header canonical-source-{label} disagrees with the manifest.\n"
            f"  header:   {found[0]}\n"
            f"  manifest: {expected}\n"
            "Re-vendor rather than editing one of them by hand."
        )

    # `canonical_sha256` is verified ONLY by a human running the command in this
    # header against a clone (recorded decision — an offline check would need a
    # sibling clone that is not guaranteed present). So a drifted command means
    # the one manual verification path silently verifies the WRONG blob. It was
    # unguarded, in a change whose premise is that unguarded provenance rots.
    # (Stage-3 doubt review, D-4.)
    command = re.findall(r"^#\s+git show (\S+):(\S+) \| sha256sum$", text, re.M)
    assert len(command) == 1, (
        f"{name}: expected exactly one `git show <commit>:<path> | sha256sum` "
        f"reproduction line in the header, found {len(command)}"
    )
    assert command[0] == (manifest["canonical_commit"], entry["canonical_path"]), (
        f"{name}: the header's reproduction command does not name the recorded "
        f"commit and path.\n  command:  {command[0]}\n"
        f"  manifest: {(manifest['canonical_commit'], entry['canonical_path'])}\n"
        "Following it would verify the wrong blob."
    )


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

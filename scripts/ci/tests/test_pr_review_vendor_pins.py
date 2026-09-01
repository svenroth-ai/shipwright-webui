"""Drift pins for the reviewer's VENDORED stale-verdict modules, and the
cross-file invariants the ownership rule depends on (ADR-117 port).

Two subjects, deliberately together: the hash pins below, and
`test_the_marker_namespace_has_exactly_one_producer` at the bottom. Both
answer "is the thing ownership rests on still true in THIS repository?" —
one for the rule's bytes, one for the namespace those bytes key on — and
neither is a test of any single module's behaviour, which is why the
namespace guard moved here out of the `gh`-boundary module.

`scripts/ci/accepted_risks_vendor.json` cannot hold these. That manifest carries
ONE top-level `canonical_commit` for the accepted-risk gate's batch
(`987e49c6…`); these two modules come from a different upstream commit
(`4146a610…`), so recording them there would make the manifest's own provenance
field a lie for half its entries. They are therefore listed in that guard's
`_NOT_HASH_PINNED` allowlist — and pinned HERE instead, so "not in the manifest"
does not quietly mean "not pinned at all".

Vendored code rots silently: someone patches the copy in place, canonical moves
on, and nothing says so. That risk is sharper for these two than for most,
because the rule they carry decides whether an IRREVERSIBLE GitHub write may
happen, it was narrowed by three upstream review rounds against measured
failures, and it exists in two repositories at once. Hardening it *here* only is
drift in the dangerous direction: canonical stays weak, and the next re-vendor
silently reverts the local change. So a deliberate edit is meant to be loud.

**If one of these assertions fails and you meant it:** update the constant, update
the module's `# canonical-source-hash:` header, and file the change UPSTREAM —
a divergence that is not also upstream is a divergence that will be reverted.
"""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

import pytest

CI_DIR = Path(__file__).resolve().parent.parent  # scripts/ci
_REPO_ROOT = CI_DIR.parent.parent

#: Files that legitimately DISCUSS the marker (tests, the iterate spec, vendor
#: headers) as opposed to EMITTING one into a review body.
_MAY_MENTION = ("scripts/ci/tests/", ".shipwright/", "CHANGELOG")

#: sha256 of the file AS VENDORED (header included), over LF-normalised bytes.
#: Normalised rather than raw `read_bytes()` on purpose: webui #341 burned a
#: whole iterate on hashes that silently held CRLF working-tree bytes and so
#: matched no upstream object. `.gitattributes` sets `text eol=lf` for
#: `scripts/ci/**` today, which makes raw bytes work by luck; normalising makes
#: this pin survive that attribute changing.
_PINNED = {
    "pr_review_dismiss_select.py":
        "b8958bb913b5fff97350074f8c2d5c9b6f5537ffcbe89795ca3a0ade429fa81a",
    "pr_review_dismiss.py":
        "3b325186cd215f11b380be3a9fc455c75df0c7db9b687207ffb4b16d20f9e146",
}


def _lf_sha256(path: Path) -> str:
    return hashlib.sha256(
        path.read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8")
    ).hexdigest()


@pytest.mark.parametrize("name", sorted(_PINNED))
def test_a_vendored_module_has_not_been_edited_in_place(name: str) -> None:
    path = CI_DIR / name
    assert path.is_file(), f"{name} is missing"
    assert _lf_sha256(path) == _PINNED[name], (
        f"{name} no longer matches its recorded hash. If the edit was deliberate: "
        "update this constant AND the module's `# canonical-source-hash:` header, "
        "and take the change upstream to the canonical monorepo — a local-only "
        "divergence in this rule is reverted by the next re-vendor."
    )


def test_every_pinned_module_states_its_provenance() -> None:
    """A hash without a header is a number nobody can act on: the reader needs to
    know WHICH upstream file and WHICH commit it should be reconciled against."""
    for name in _PINNED:
        text = (CI_DIR / name).read_text(encoding="utf-8")
        for marker in ("# canonical-source-hash:", "# canonical-source-repo:",
                       "# canonical-source-commit:", "# canonical-source-paths:",
                       "# canonical-source-version:"):
            assert marker in text, f"{name} is missing `{marker}`"


#: Excused from the manifest guard AND pinned nowhere. `pr_review.py` /
#: `pr_review_lib.py` predate this module (vendored 2026-06-12, header-only
#: provenance); the four `pr_review_{diff_filter,generated,render,safe_path}.py`
#: modules are the canonical-parity iterate's split (vendored 2026-07-28,
#: header-only provenance, merged forward past this ADR-117 port on 2026-08-05);
#: `pr_review_model_policy.py` merges two canonical sources into one file
#: (vendored 2026-09-01, header-only provenance — same reason as the other six,
#: not byte-identical to any single upstream file so a bytes pin would compare
#: against nothing real). All seven are named in `_NOT_HASH_PINNED` for exactly
#: that reason. Listing them HERE as well is what lets the reverse direction
#: below be a real assertion instead of a comment: the set is closed, so a NEW
#: unpinned entry fails rather than joining a silent backlog.
_KNOWINGLY_UNPINNED = {
    "pr_review.py", "pr_review_lib.py",
    "pr_review_diff_filter.py", "pr_review_generated.py",
    "pr_review_render.py", "pr_review_safe_path.py",
    "pr_review_model_policy.py",
}


def test_the_not_hash_pinned_allowlist_and_this_module_agree() -> None:
    """Both directions, per the registry-driven SSoT rule.

    Forward: everything pinned here must still be excused from the manifest
    guard, or the two records have drifted apart.

    Reverse: everything excused from the manifest guard must be either pinned
    here or listed in `_KNOWINGLY_UNPINNED`. That is the hole this file exists
    to prevent — "not in the manifest" quietly becoming "not checked by
    anything" — and it is the direction that opens silently the next time
    someone vendors a leaf. Stage-2 review flagged that the docstring promised
    both directions while only the forward one was asserted.
    """
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from test_accepted_risks_vendored import _NOT_HASH_PINNED

    for name in _PINNED:
        assert name in _NOT_HASH_PINNED, (
            f"{name} is pinned here but no longer excused from the manifest guard; "
            "one of the two records is stale"
        )

    unchecked = set(_NOT_HASH_PINNED) - set(_PINNED) - _KNOWINGLY_UNPINNED
    assert not unchecked, (
        f"excused from the manifest guard and pinned by nothing: {sorted(unchecked)}. "
        "Add a hash to _PINNED here, or record it in _KNOWINGLY_UNPINNED with the "
        "reason it cannot be pinned."
    )


def test_the_marker_namespace_has_exactly_one_producer():
    """Ownership rests on `<!-- shipwright-pr-review:{nonce} -->` identifying
    THIS reviewer. The nonce proves which review is the current anchor; the
    namespace is what makes an older candidate's marker ours at all — and that
    holds only while nothing else in this repository writes one.

    Reviews never cross repositories, so the monorepo's reviewer and this
    vendored copy sharing the namespace is harmless. A SECOND producer added
    *here* would not be, and this is the ONLY thing standing between the design
    and its one residual over-reach vector: a candidate needs a well-formed
    marker with ANY nonce (past nonces are unknowable, so ours cannot be
    required) plus `type == "Bot"` plus the anchor's login — and every workflow
    in this repository posts as `github-actions[bot]`.

    Scoped to the WHOLE repository, not just `scripts/ci/*.py` (Stage-2 review):
    a workflow step running `gh pr review --body "... <!-- shipwright-pr-review:
    … -->"`, or a shell/PowerShell helper doing the same, would satisfy the
    ownership predicate while a Python-only, non-recursive glob saw nothing.
    """
    token = "shipwright-pr-review"
    # git decides what "in this repository" means. Walking the filesystem
    # instead pulled in build artifacts (`.pytest_cache/v/cache/nodeids` names
    # this very test) and needed a hand-maintained ignore list that would rot;
    # `--cached --others --exclude-standard` is tracked PLUS untracked-but-not-
    # ignored, so a producer added in this very commit is still in scope.
    # `-z` and NUL-splitting, not newlines. With `core.quotePath` at its default
    # git returns a path holding non-ASCII or control bytes as a C-quoted
    # literal (`"scripts/ci/\303\251.py"`); `_REPO_ROOT / rel` then names a file
    # that does not exist, the read raises, and a broad `except` would drop it —
    # the guard passing by NOT LOOKING, which is the same failure shape as
    # scoping the exclusion to an absolute path or letting `.pytest_cache` in.
    # A file this guard cannot see is a file that can hold a second producer.
    listed = subprocess.run(
        ["git", "-C", str(_REPO_ROOT), "ls-files", "-z", "--cached", "--others",
         "--exclude-standard"],
        capture_output=True, encoding="utf-8", errors="replace", timeout=60)
    assert listed.returncode == 0, f"git ls-files failed: {listed.stderr.strip()}"

    emitters: list[str] = []
    for rel in sorted(set(listed.stdout.split("\0"))):
        rel = rel.strip()
        if not rel or rel.startswith(_MAY_MENTION):
            continue
        path = _REPO_ROOT / rel
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue  # binary: cannot be a review-body producer
        except FileNotFoundError:
            continue  # listed-then-deleted between the two calls; benign race
        # Anything ELSE (a permission error, a path this guard cannot address)
        # is NOT swallowed: it means the scan is incomplete, and an incomplete
        # scan reporting "exactly one producer" is the lie this test prevents.
        if token in text:
            emitters.append(rel)
    assert emitters == ["scripts/ci/pr_review_dismiss_select.py"], (
        "exactly one file may stamp the ownership marker; found: " + repr(emitters)
        + ". A second producer under the shared `github-actions[bot]` login would "
        "inherit ownership of this reviewer's verdicts."
    )

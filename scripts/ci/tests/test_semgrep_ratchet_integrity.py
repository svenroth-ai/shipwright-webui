"""Can the Semgrep suppression ratchet be BYPASSED or DISARMED, rather than evaded?

The two ratchet modules ask "has the pinned set drifted". This one asks the
adversarial question the Stage-3 doubt review asked: what leaves the suite green
while a real suppression takes effect, or while the guard itself stops guarding?

Every test here closes a hole that was GREEN when it was found. They are grouped
apart from the ratchets deliberately — a reader auditing "is this guard worth
trusting" should not have to read two registries first.

Siblings: `test_semgrep_scan_scope.py`, `test_semgrep_inline_suppressions.py`
(the ratchets); `semgrep_channels.py`, `semgrep_scan_surface.py` (discovery).
"""

from __future__ import annotations

import json
from pathlib import Path

from accepted_risks_paths import SECURITY_YML, runs, workflow
from semgrep_channels import (
    MARKER_RE,
    MIN_RATIONALE,
    PROSE_EXEMPT,
    REPO_ROOT,
    directives,
    parse_line,
    tracked_files,
)
from semgrep_scan_surface import REQUIRED_SCANNED, SCANNED_EXTENSIONS

_HERE = Path(__file__).resolve().parent


def test_the_scanner_is_pointed_at_the_whole_tree_with_the_full_ruleset() -> None:
    """Pinning the ignore FILE is not pinning the scan SCOPE.

    `.semgrepignore` is one of several things that decide what Semgrep looks at.
    The scan step could also carry `--exclude=server/src/core`, narrow `--config`
    away from `auto`, or set `SEMGREP_RULES` — each removing code from the scan
    with this whole suite green and the ignore file untouched.

    The precedent is the sibling channel's, and it is damning: Trivy's half of
    this design carries `test_the_scanner_actually_reads_the_ignorefile_the_gate_
    reconciles` because the register gate was green for MONTHS while
    `.trivyignore.yaml` was never read at all (PR #330). A ratchet that
    reconciles a file against a registry, and never asks whether the scanner
    applies that file, repeats it. (Stage-3 doubt review, D-4.)
    """
    scan = "\n".join(runs(workflow(SECURITY_YML), "scan"))
    semgrep = [ln.strip() for ln in scan.splitlines() if "semgrep scan" in ln]
    assert len(semgrep) == 1, (
        f"expected exactly one `semgrep scan` line in security.yml's scan job, "
        f"found {len(semgrep)}: {semgrep}"
    )
    line = semgrep[0]
    assert "--config auto" in line, (
        f"the Semgrep step no longer runs `--config auto`: {line}\n"
        "Narrowing the ruleset silences findings exactly as an ignore line does, "
        "and neither ratchet can see it."
    )
    for flag in ("--exclude", "--include", "--baseline-commit"):
        assert flag not in line, (
            f"the Semgrep step carries `{flag}`: {line}\n"
            "That changes the scan SCOPE outside `.semgrepignore`, where the "
            "scope ratchet cannot see it. Put path exclusions in .semgrepignore, "
            "where they are pinned and carry a written rationale."
        )
    assert line.rstrip().endswith(" ."), (
        f"the Semgrep step no longer scans the whole tree (`.`): {line}"
    )


def test_the_root_ignore_file_is_the_only_one() -> None:
    """Semgrepignore is per-DIRECTORY; the ratchet reads exactly one path.

    A nested `client/src/.semgrepignore` would be honoured by Semgrep, invisible
    to `live_patterns` (which reads the root file), classified as an inert
    extensionless file by the surface map, and NOT matched by
    `pr-review-run.yml`'s `^\\.semgrepignore` — so not even routed to Tier-3a
    review. Closing it here is cheaper and safer than widening a workflow regex,
    which would drag the CI trust boundary into this change.
    (Stage-3 doubt review, D-4, second instance.)
    """
    found = sorted(f for f in tracked_files() if Path(f).name == ".semgrepignore")
    assert found == [".semgrepignore"], (
        f"expected exactly one .semgrepignore, at the repo root; found: {found}.\n"
        "Semgrep reads nested ignore files, but the scope ratchet pins only the "
        "root one — so a nested file silences a subtree with nothing able to see "
        "it. Move those patterns into the root file, where they are pinned."
    )


def test_the_undebatable_languages_stay_scanned() -> None:
    """`test_every_in_scope_extension_is_classified` demands A classification.

    It does not demand the RIGHT one — so moving `.yml` into the unscanned map
    with a plausible sentence is a one-line, fully green disarm. And
    `.github/workflows` is exactly where a rule like
    `yaml.github-actions.security.run-shell-injection` fires.
    (Stage-3 doubt review, D-6.)
    """
    missing = sorted(REQUIRED_SCANNED - set(SCANNED_EXTENSIONS))
    assert not missing, (
        f"these file types were moved out of SCANNED_EXTENSIONS: {missing}.\n"
        "Semgrep certainly analyses them, so the directive ratchet must read "
        "them. Reclassifying one is not a documentation change — it blinds a "
        "whole language. If Semgrep genuinely dropped support, say so here and "
        "shrink REQUIRED_SCANNED in the same change."
    )


def test_the_prose_exemptions_cannot_become_a_self_service_bypass() -> None:
    """`PROSE_EXEMPT` suppresses the suppression-detector, so IT needs a ratchet.

    Unguarded it is a one-entry bypass: add a directive anywhere, add a
    40-character exemption keyed at that line, and it is invisible to every test
    in the ratchet module. The registry's docstring states the two properties
    that make it safe — the file is VENDORED (so its prose cannot be reworded)
    and manifest-pinned (so line keys cannot drift). Those were asserted in prose
    only; they are enforced here. (Stage-3 doubt review, D-7.)
    """
    assert len(PROSE_EXEMPT) == 2, (
        f"PROSE_EXEMPT has grown to {len(PROSE_EXEMPT)} entries. Each one hides a "
        "line from the suppression ratchet. Adding a third is a policy decision: "
        "justify it and raise this number in the same change."
    )
    manifest = json.loads(
        (REPO_ROOT / "scripts" / "ci" / "accepted_risks_vendor.json").read_text(
            encoding="utf-8"
        )
    )["modules"]

    for (rel, line_no), rationale in PROSE_EXEMPT.items():
        path = REPO_ROOT / rel
        assert path.is_file(), f"exempted file no longer exists: {rel}"

        # (a) VENDORED ONLY. The rationale rests on "cannot be reworded here",
        #     which is true of a manifest-pinned module and of nothing else.
        assert rel.startswith("scripts/ci/") and Path(rel).name in manifest, (
            f"{rel} is exempted but is not a vendored module (see "
            "scripts/ci/accepted_risks_vendor.json). Exemptions exist ONLY for "
            "files whose bytes are pinned to upstream and therefore cannot be "
            "reworded. For any other file, move the prose — do not exempt it."
        )

        lines = path.read_text(encoding="utf-8", errors="replace").split("\n")
        assert line_no <= len(lines), (
            f"{rel} has only {len(lines)} lines but line {line_no} is exempted. "
            "The file moved under the exemption — re-check it and re-key."
        )
        text = lines[line_no - 1]
        assert MARKER_RE.search(text), (
            f"{rel}:{line_no} is exempted as prose but no longer carries a "
            "marker. Drop the exemption, or re-key it to where the prose moved: "
            "left as-is it is blanket cover for whatever lands on that line."
        )

        # (b) RULE-LESS ONLY. An exemption may cover inert prose; it may never
        #     cover a line that would otherwise have registered a real rule.
        parsed = parse_line(text)
        assert parsed == [], (
            f"{rel}:{line_no} is exempted but parses as a REAL directive: "
            f"{parsed}. An exemption is for inert prose, never for a working "
            "suppression. Register it in _INLINE_SUPPRESSIONS instead."
        )
        assert len(rationale.strip()) >= MIN_RATIONALE, (
            f"exemption {rel}:{line_no} needs a real reason, not a label."
        )


def test_the_exemptions_do_what_they_claim_on_the_real_tree() -> None:
    """AC-6, restated for the parser that actually shipped.

    An earlier draft asserted this as "the scanner distinguishes prose from a
    directive", crediting `tokenize`. It no longer does — every language is read
    line by line — so `accepted_risk_scan.py` reports zero directives ONLY
    because of `PROSE_EXEMPT`. Saying it the old way would have left a test whose
    docstring taught a design CLAUDE.md DO-NOT #31 forbids re-introducing.
    (Stage-3 doubt review, D-9.)
    """
    vendored = REPO_ROOT / "scripts" / "ci" / "accepted_risk_scan.py"
    live = REPO_ROOT / "scripts" / "ci" / "pr_review_openrouter.py"
    for path in (vendored, live):
        assert path.is_file(), (
            f"{path} is gone. These two files pin the exemption's real-tree "
            "effect; if they moved, re-point this test rather than deleting it."
        )
    assert directives(vendored) == [], (
        f"the vendored module reports directives: {directives(vendored)}. Its two "
        "docstring mentions are covered by PROSE_EXEMPT; if that stopped working, "
        "the exemption is mis-keyed rather than the file being wrong — it is "
        "byte-pinned and cannot be edited here."
    )
    real = directives(live)
    assert len(real) == 1 and real[0][2].startswith("python.lang.security"), (
        f"expected exactly one real directive in {live.name}, got: {real}"
    )


def test_the_sibling_ratchet_modules_still_exist() -> None:
    """Deleting a ratchet module leaves `pytest scripts/ci/tests` GREEN.

    The gate job runs the whole directory (deliberately — a new module is covered
    on day one), so a deleted module is simply not collected and nothing notices:
    `test_accepted_risks_ci_wiring` takes its whole-directory early return, and
    the client `doc-sync` meta-test checks docs-mention-docs, never
    docs-mention-disk. The Tier-3a `PR Review` context is real and blocking, but
    it is an LLM review, and it was the only thing between a green run and a
    silently deleted guard. (Stage-3 doubt review, D-8.)
    """
    for name in (
        "semgrep_channels.py",
        "semgrep_scan_surface.py",
        "test_semgrep_scan_scope.py",
        "test_semgrep_inline_suppressions.py",
        "test_semgrep_channels_scanner.py",
        "test_semgrep_ignore_matcher.py",
    ):
        assert (_HERE / name).is_file(), (
            f"{name} is gone. The Semgrep suppression ratchet is a set of modules "
            "that only work together; deleting one disarms a channel while the "
            "directory-wide pytest run stays green. Restore it, or retire the "
            "whole ratchet deliberately and update CLAUDE.md DO-NOT #31."
        )

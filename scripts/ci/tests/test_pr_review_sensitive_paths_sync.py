"""The tier ROUTES a change to the reviewer; the prompt decides what it DOES.

Both directions, because either drift is a real hole and they fail differently:

- **tier → prompt.** The tier sends a change to the reviewer, and the reviewer's
  rules never mention that surface. The waiver is correctly refused and the
  review that replaces it returns `approve`, because a one-line addition to a
  suppression file looks trivially safe on its face. The door is un-waivable
  and unlocked — the worse of the two, because everything upstream of it reads
  as working. This is not hypothetical: widening the tier with the suppression
  channels (`.trivyignore.yaml` and friends) left exactly this gap until the
  adversarial review found it.
- **prompt → tier.** The reviewer has a rule for a surface the tier never routes
  to it. Harmless but dead, and dead policy is how a reader comes to believe a
  path is guarded when it is not.

Registry-driven SSoT meta-test (skill Step 6): the tier's `grep -qE` alternation
in `.github/workflows/pr-review-run.yml` is the registry, and
`scripts/ci/pr_reviewer/system` is the disk.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
STAGE2 = REPO_ROOT / ".github" / "workflows" / "pr-review-run.yml"
SYSTEM_PROMPT = REPO_ROOT / "scripts" / "ci" / "pr_reviewer" / "system"

# `server/src/**` etc. are reachable through the EXTERNAL-CONTRIBUTOR arm rather
# than the path arm, so the prompt legitimately discusses them without the tier
# naming a path. Only path-shaped tokens are compared.
_PATH_TOKEN = re.compile(r"^[.\w][\w./*-]*$")


def _tier_paths() -> set[str]:
    """The alternation the `tier` step greps changed paths against."""
    body = STAGE2.read_text(encoding="utf-8")
    match = re.search(r"grep -qE '\^\((?P<alts>[^']+)\)'", body)
    assert match, "could not find the sensitive-path alternation in the tier step"
    out = set()
    for alt in match.group("alts").split("|"):
        cleaned = alt.replace("\\", "").strip()
        if cleaned:
            out.add(cleaned)
    assert out, "parsed an empty sensitive-path set"
    return out


def _prompt_text() -> str:
    return SYSTEM_PROMPT.read_text(encoding="utf-8")


@pytest.mark.parametrize("path", sorted(_tier_paths()))
def test_every_routed_path_is_named_in_the_reviewer_prompt(path: str) -> None:
    """tier → prompt: routing a surface the reviewer has no rule for is a hole."""
    assert _PATH_TOKEN.match(path), f"unexpected alternation entry {path!r}"
    # Trailing-slash directories are written either way in prose.
    needles = {path, path.rstrip("/"), path.rstrip(".")}
    assert any(n in _prompt_text() for n in needles), (
        f"the tier routes {path!r} to the reviewer, but "
        f"scripts/ci/pr_reviewer/system never mentions it — the review will "
        f"most likely `approve` it as trivially safe. Add it to rule 4/4b."
    )


def test_the_prompt_names_no_path_the_tier_never_routes() -> None:
    """prompt → tier: dead policy reads as protection that is not there."""
    prompt = _prompt_text()
    tier = _tier_paths()
    # Only inspect backticked tokens that look like repo paths.
    quoted = {t for t in re.findall(r"`([^`]+)`", prompt) if _PATH_TOKEN.match(t)}
    # Tokens that are code identifiers or non-path examples, not routed surfaces.
    ignore_substrings = ("(", "=", "server/", "client/", "CONTRIBUTING", "core.hooksPath")
    stray = set()
    for token in quoted:
        if any(s in token for s in ignore_substrings) or "/" not in token and "." not in token:
            continue
        base = token.rstrip("*").rstrip("/")
        if any(base.startswith(p.rstrip("*").rstrip("/")) for p in tier):
            continue
        stray.add(token)
    assert not stray, (
        f"the reviewer prompt names {sorted(stray)} as sensitive, but the tier "
        f"in pr-review-run.yml never routes those paths to it — either add them "
        f"to the alternation or stop claiming they are guarded."
    )

"""Campaign-C, sub-iterate C1 — verification probe.

Empirically asserts that `CLAUDE.md` already meets Campaign-C's target
state on origin/main, so the C1 split is a no-op (the Phase-0f
compliance-hygiene pass, PR #55 / commit f4d52fd, organically delivered
the outcome the source plan called for).

Two assertions:
  1. CLAUDE.md LOC <= 300 (project-wide source LOC limit).
  2. CLAUDE.md is NOT an entry in shipwright_bloat_baseline.json.

Run from project root:
    uv run --with openai pytest \
      .shipwright/planning/iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/_c1_verify.py -v
"""

from __future__ import annotations

import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[6]
CLAUDE_MD = PROJECT_ROOT / "CLAUDE.md"
BASELINE = PROJECT_ROOT / "shipwright_bloat_baseline.json"

LOC_LIMIT = 300


def _line_count(p: Path) -> int:
    """Count lines the same way wc -l does (newline-terminated)."""
    text = p.read_text(encoding="utf-8")
    if not text:
        return 0
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def test_claude_md_within_loc_limit() -> None:
    assert CLAUDE_MD.is_file(), f"CLAUDE.md not found at {CLAUDE_MD}"
    loc = _line_count(CLAUDE_MD)
    assert loc <= LOC_LIMIT, (
        f"CLAUDE.md is {loc} LOC, exceeds project limit of {LOC_LIMIT}. "
        "Campaign-C C1 invariant violated — the file would need to be "
        "split or added to shipwright_bloat_baseline.json with an ADR."
    )


def test_claude_md_not_in_bloat_baseline() -> None:
    assert BASELINE.is_file(), f"baseline not found at {BASELINE}"
    data = json.loads(BASELINE.read_text(encoding="utf-8"))
    paths = [entry["path"] for entry in data["entries"]]
    assert "CLAUDE.md" not in paths, (
        "CLAUDE.md unexpectedly present in shipwright_bloat_baseline.json. "
        "Campaign-C C1 pre-condition violated — investigate which iterate "
        "added the entry before re-running this probe."
    )

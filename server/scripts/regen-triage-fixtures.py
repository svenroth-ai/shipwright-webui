#!/usr/bin/env python3
"""Regenerate `server/src/test/fixtures/triage-resolved.json` from the JSONL fixture.

Run when `shared/scripts/triage.py` changes the resolved-view shape:

    uv run server/scripts/regen-triage-fixtures.py

Inputs : server/src/test/fixtures/triage.jsonl
Outputs: server/src/test/fixtures/triage-resolved.json (overwritten)

Discovery order for `shared/scripts/triage.py` (the upstream module):
1. `$SHIPWRIGHT_PLUGIN_ROOT/../shared/scripts/triage.py` (Claude Code session env)
2. `$HOME/.claude/plugins/cache/shipwright/shared/scripts/triage.py` (plugin cache)
3. `../shipwright/shared/scripts/triage.py` (sibling monorepo checkout)

Bails with exit 1 + actionable message if not found. The committed JSON
fixture is the SoT for CI; this script is a developer-only convenience
to refresh after a triage.py schema change.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
JSONL = REPO_ROOT / "server" / "src" / "test" / "fixtures" / "triage.jsonl"
RESOLVED = REPO_ROOT / "server" / "src" / "test" / "fixtures" / "triage-resolved.json"


def find_triage_py() -> Path | None:
    candidates: list[Path] = []
    plugin_root = os.environ.get("SHIPWRIGHT_PLUGIN_ROOT")
    if plugin_root:
        candidates.append(Path(plugin_root).parent / "shared" / "scripts" / "triage.py")
    home = Path(os.environ.get("HOME") or os.environ.get("USERPROFILE") or "")
    if home:
        candidates.append(
            home
            / ".claude"
            / "plugins"
            / "cache"
            / "shipwright"
            / "shared"
            / "scripts"
            / "triage.py"
        )
    candidates.append(REPO_ROOT.parent / "shipwright" / "shared" / "scripts" / "triage.py")
    for c in candidates:
        if c.exists():
            return c
    return None


def main() -> int:
    triage_py = find_triage_py()
    if not triage_py:
        sys.stderr.write(
            "error: shared/scripts/triage.py not found. "
            "Set SHIPWRIGHT_PLUGIN_ROOT or check that the shipwright monorepo "
            "is at ../shipwright relative to this repo.\n"
        )
        return 1

    if not JSONL.exists():
        sys.stderr.write(f"error: input fixture missing at {JSONL}\n")
        return 1

    sys.path.insert(0, str(triage_py.parent))
    from triage import read_all_items  # noqa: E402

    # read_all_items needs a project_root that contains .shipwright/triage.jsonl.
    # Stage the fixture into a tmp project tree so we don't pollute the repo.
    with tempfile.TemporaryDirectory() as tmp:
        proj = Path(tmp)
        (proj / ".shipwright").mkdir()
        (proj / ".shipwright" / "triage.jsonl").write_text(
            JSONL.read_text(encoding="utf-8"), encoding="utf-8"
        )
        items = read_all_items(proj)

    payload = {
        "_comment": (
            "Generated from triage.jsonl by Python read_all_items() "
            "(shared/scripts/triage.py). Regenerate via "
            "server/scripts/regen-triage-fixtures.py whenever triage.py "
            "changes the wire shape. The TS port readAllItems() must match "
            "this byte-for-byte (deep-equal) per the parity test in "
            "src/core/triage-store.test.ts."
        ),
        "items": items,
    }
    RESOLVED.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    sys.stderr.write(f"wrote {RESOLVED} ({len(items)} items)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

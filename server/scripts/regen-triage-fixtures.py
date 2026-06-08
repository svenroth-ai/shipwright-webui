#!/usr/bin/env python3
"""Regenerate the triage parity fixtures from the JSONL inputs.

Run when `shared/scripts/triage.py` changes the resolved-view shape:

    uv run server/scripts/regen-triage-fixtures.py

Single-file gate:
  Inputs : server/src/test/fixtures/triage.jsonl
  Outputs: server/src/test/fixtures/triage-resolved.json (overwritten)

Union gate (tracked union outbox — campaign 2026-06-08-triage-outbox-delivery):
  Inputs : server/src/test/fixtures/triage-union.tracked.jsonl  (has header)
           server/src/test/fixtures/triage-union.outbox.jsonl   (headerless buffer)
  Outputs: server/src/test/fixtures/triage-union-resolved.json (overwritten)

Both committed JSON fixtures are the SoT for CI; the TS port
(`readAllItems`) must match them byte-for-byte (deep-equal).

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
FIXTURES = REPO_ROOT / "server" / "src" / "test" / "fixtures"
JSONL = FIXTURES / "triage.jsonl"
RESOLVED = FIXTURES / "triage-resolved.json"
UNION_TRACKED = FIXTURES / "triage-union.tracked.jsonl"
UNION_OUTBOX = FIXTURES / "triage-union.outbox.jsonl"
UNION_RESOLVED = FIXTURES / "triage-union-resolved.json"


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

    # --- Single-file gate ------------------------------------------------
    # read_all_items needs a project_root that contains .shipwright/triage.jsonl.
    # Stage the fixture into a tmp project tree so we don't pollute the repo.
    with tempfile.TemporaryDirectory() as tmp:
        proj = Path(tmp)
        (proj / ".shipwright").mkdir()
        (proj / ".shipwright" / "triage.jsonl").write_text(
            JSONL.read_text(encoding="utf-8"), encoding="utf-8"
        )
        items = read_all_items(proj)

    RESOLVED.write_text(
        json.dumps(
            {
                "_comment": (
                    "Generated from triage.jsonl by Python read_all_items() "
                    "(shared/scripts/triage.py). Regenerate via "
                    "server/scripts/regen-triage-fixtures.py whenever triage.py "
                    "changes the wire shape. The TS port readAllItems() must match "
                    "this byte-for-byte (deep-equal) per the parity test in "
                    "src/core/triage-store.test.ts."
                ),
                "items": items,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    sys.stderr.write(f"wrote {RESOLVED} ({len(items)} items)\n")

    # --- Union gate (tracked union outbox) -------------------------------
    # Stage BOTH the tracked store and the headerless outbox buffer so the
    # Python union reader resolves cross-file. The TS port must match this.
    if not UNION_TRACKED.exists() or not UNION_OUTBOX.exists():
        sys.stderr.write(
            f"error: union fixtures missing at {UNION_TRACKED} / {UNION_OUTBOX}\n"
        )
        return 1
    with tempfile.TemporaryDirectory() as tmp:
        proj = Path(tmp)
        (proj / ".shipwright").mkdir()
        (proj / ".shipwright" / "triage.jsonl").write_text(
            UNION_TRACKED.read_text(encoding="utf-8"), encoding="utf-8"
        )
        (proj / ".shipwright" / "triage.outbox.jsonl").write_text(
            UNION_OUTBOX.read_text(encoding="utf-8"), encoding="utf-8"
        )
        union_items = read_all_items(proj)

    UNION_RESOLVED.write_text(
        json.dumps(
            {
                "_comment": (
                    "Generated from triage-union.{tracked,outbox}.jsonl by Python "
                    "read_all_items() (shared/scripts/triage.py) over the tracked "
                    "union outbox view (campaign 2026-06-08-triage-outbox-delivery). "
                    "The TS port readAllItems() must match this byte-for-byte "
                    "(deep-equal) per the union parity test in "
                    "src/core/triage-store.test.ts."
                ),
                "items": union_items,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    sys.stderr.write(f"wrote {UNION_RESOLVED} ({len(union_items)} items)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

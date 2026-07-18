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

CLI list gate (pendingDelivery — iterate-2026-06-10-triage-pending-delivery-badge):
  Inputs : the same union fixture pair
  Outputs: server/src/test/fixtures/triage-union-cli-list.json (overwritten)
  Runs the REAL `triage_cli.py list --json` (subprocess, sibling of triage.py)
  so the fixture IS the canonical WebUI live-view contract: open items only,
  each with `pendingDelivery` (TRACKED-PREFERRED residence). The TS GET-route
  projection (`enrichPendingDelivery` over `filterTriage(readAllItems(...))`)
  must deep-equal it.

All committed JSON fixtures are the SoT for CI; the TS port
(`readAllItems` / `enrichPendingDelivery`) must match them byte-for-byte
(deep-equal).

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
import subprocess
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
UNION_CLI_LIST = FIXTURES / "triage-union-cli-list.json"
RECOVERY_JSONL = FIXTURES / "triage-recovery.jsonl"
RECOVERY_RESOLVED = FIXTURES / "triage-recovery-resolved.json"


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

    # --- Recovery gate (record-boundary parity) ---------------------------
    # iterate-2026-07-18-triage-jsonl-record-boundary. The input fixture is
    # DELIBERATELY corrupted: concatenated records, a valid record followed by
    # an unrecoverable tail, a leading scalar, a CRLF line, NBSP between
    # records, and an append+status pair sharing one physical line.
    #
    # This is the Boundary Probe for the `touches_io_boundary` risk flag: it
    # proves the TS record splitter and the Python `lib/jsonl_records.py`
    # splitter agree on WHERE A RECORD ENDS — including which records are
    # legitimately UNRECOVERABLE (the scalar-first and NBSP cases drop the
    # record that follows in BOTH languages; that agreement is the point).
    if not RECOVERY_JSONL.exists():
        sys.stderr.write(f"error: recovery fixture missing at {RECOVERY_JSONL}\n")
        return 1
    with tempfile.TemporaryDirectory() as tmp:
        proj = Path(tmp)
        (proj / ".shipwright").mkdir()
        # Byte-for-byte copy so the fixture's CRLF line survives verbatim — the
        # whole point is to compare byte-level record framing. (read_text's
        # `newline` kwarg is 3.13+, and universal-newline translation would
        # silently rewrite the CR we are trying to test.)
        (proj / ".shipwright" / "triage.jsonl").write_bytes(RECOVERY_JSONL.read_bytes())
        recovery_items = read_all_items(proj)

    RECOVERY_RESOLVED.write_text(
        json.dumps(
            {
                "_comment": (
                    "Generated from triage-recovery.jsonl by Python "
                    "read_all_items() (shared/scripts/triage.py, which delegates "
                    "record boundaries to lib/jsonl_records.py). The input is "
                    "DELIBERATELY corrupted. The TS port readAllItems() must "
                    "match this byte-for-byte (deep-equal) per the recovery "
                    "parity test in src/core/triage-store.recovery.test.ts. "
                    "Records absent here are absent by CONTRACT (a scalar or a "
                    "non-JSON-whitespace separator makes the rest of the line "
                    "unrecoverable in both languages), not by accident."
                ),
                "items": recovery_items,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    sys.stderr.write(f"wrote {RECOVERY_RESOLVED} ({len(recovery_items)} items)\n")

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

    # --- CLI list gate (pendingDelivery) ----------------------------------
    # Run the REAL `triage_cli.py list --json` over the same staged union pair
    # so the fixture is generated by the canonical contract, not a re-
    # implementation. The CLI lives at tools/triage_cli.py next to triage.py;
    # discovery is confined to the already-validated triage.py location
    # (external review OAI3/OAI10: log the resolved path, hard-fail loudly —
    # never emit a stale or empty fixture).
    triage_cli = triage_py.parent / "tools" / "triage_cli.py"
    if not triage_cli.exists():
        sys.stderr.write(f"error: triage_cli.py not found at {triage_cli}\n")
        return 1
    sys.stderr.write(f"running CLI contract: {triage_cli}\n")
    with tempfile.TemporaryDirectory() as tmp:
        proj = Path(tmp)
        (proj / ".shipwright").mkdir()
        (proj / ".shipwright" / "triage.jsonl").write_text(
            UNION_TRACKED.read_text(encoding="utf-8"), encoding="utf-8"
        )
        (proj / ".shipwright" / "triage.outbox.jsonl").write_text(
            UNION_OUTBOX.read_text(encoding="utf-8"), encoding="utf-8"
        )
        run = subprocess.run(
            [sys.executable, str(triage_cli), "--project-root", str(proj),
             "list", "--json"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
            # The contract is UTF-8 JSON. Without this the child writes via
            # the Windows-cp1252 stdout codec and crashes on any non-ASCII
            # item (boundary probe 2026-06-10; root fix lands in the
            # monorepo CLI, this keeps regen deterministic on old caches).
            env={**os.environ, "PYTHONUTF8": "1"},
        )
    if run.returncode != 0:
        sys.stderr.write(
            f"error: triage_cli list --json exited {run.returncode}:\n"
            f"{run.stderr}\n"
        )
        return 1
    cli_items = json.loads(run.stdout)

    UNION_CLI_LIST.write_text(
        json.dumps(
            {
                "_comment": (
                    "Generated from triage-union.{tracked,outbox}.jsonl by the "
                    "REAL `triage_cli.py list --json` (shared/scripts/tools/"
                    "triage_cli.py) — the canonical WebUI live-view contract: "
                    "open items only, each with pendingDelivery (TRACKED-"
                    "PREFERRED residence). The TS GET-route projection "
                    "(enrichPendingDelivery over filterTriage(readAllItems())) "
                    "must match this byte-for-byte (deep-equal) per the parity "
                    "test in src/core/triage-enrich.test.ts. Regenerate via "
                    "server/scripts/regen-triage-fixtures.py."
                ),
                "items": cli_items,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    sys.stderr.write(f"wrote {UNION_CLI_LIST} ({len(cli_items)} items)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

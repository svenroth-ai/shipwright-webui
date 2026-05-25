"""Sub-iterate C8 — empirical verification of the pty-manager bloat exception.

Asserts three things:
  1. The ADR file exists at the expected path.
  2. The ADR contains every mandatory section from the template.
  3. The baseline entry for server/src/terminal/pty-manager.ts is now
     state=exception + adr matches the ADR-NNN regex.

This is F0.5 surface_verification for an ADR-only iterate — no code
change to pty-manager.ts, so the only meaningful assertion is the
metadata flip.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[6]
ADR_PATH = REPO_ROOT / ".shipwright" / "planning" / "adr" / "101-bloat-exception-pty-manager.md"
BASELINE_PATH = REPO_ROOT / "shipwright_bloat_baseline.json"
PTY_MANAGER_PATH = "server/src/terminal/pty-manager.ts"


def test_adr_file_exists() -> None:
    assert ADR_PATH.is_file(), f"ADR file missing at {ADR_PATH}"


@pytest.mark.parametrize(
    "needle",
    [
        "**Status:**",
        "**Date:**",
        "**Re-Review-Date:**",
        "**Incident Reference:**",
        "## Context",
        "## Ousterhout Argument",
        "## YAGNI Check",
        "## Chesterton-Fence Check",
        "## Decision",
        "## Consequences",
        "## Rejected alternatives",
    ],
)
def test_adr_contains_mandatory_section(needle: str) -> None:
    body = ADR_PATH.read_text(encoding="utf-8")
    assert needle in body, f"ADR is missing mandatory section: {needle}"


def test_baseline_entry_is_exception() -> None:
    data = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    entries = [e for e in data["entries"] if e["path"] == PTY_MANAGER_PATH]
    assert len(entries) == 1, (
        f"Expected exactly one baseline entry for {PTY_MANAGER_PATH}, "
        f"got {len(entries)}"
    )
    entry = entries[0]
    assert entry["state"] == "exception", (
        f"Expected state=exception for {PTY_MANAGER_PATH}, got {entry['state']}"
    )
    assert entry["adr"] is not None, "ADR field must not be null for an exception entry"
    assert re.fullmatch(r"ADR-\d{3}", entry["adr"]), (
        f"ADR field {entry['adr']!r} does not match ^ADR-\\d{{3}}$"
    )


def test_baseline_entry_anti_ratchet_preserved() -> None:
    """The exception flip must NOT raise the `current` value upward.

    Campaign A.defense anti-ratchet rule: `current` is a ceiling, not a
    sliding target. The exception ADR raises what's *allowed*, not what's
    recorded.
    """
    data = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    entry = next(e for e in data["entries"] if e["path"] == PTY_MANAGER_PATH)
    assert entry["current"] == 1198, (
        f"current should remain at 1198 (actual LOC), got {entry['current']}"
    )
    assert entry["limit"] == 300, (
        f"limit should remain at the project default 300, got {entry['limit']}"
    )

"""Least-privilege GITHUB_TOKEN guard for .github/workflows/*.yml (stdlib-only).

Mirrors the shipwright monorepo guard. Pins the OpenSSF Scorecard
Token-Permissions hardening: a read-only top-level token, with write scopes
widened only on the jobs that need them. ``security.yml`` is the documented
exception (single-job SARIF workflow; top-level convention-locked by the
compliance A5.3 audit).

No PyYAML dependency — the pr-review ``selftest`` CI job installs only pytest.
The workflow files are simple + consistently formatted, so a small line scan of
the top-level ``permissions:`` block is sufficient and unambiguous: after the
hardening the top-level block of every non-security workflow grants no write, so
any ``*: write`` line elsewhere in the file is necessarily job-level.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

_WORKFLOWS = Path(__file__).resolve().parents[3] / ".github" / "workflows"


def _read(name: str) -> str:
    path = _WORKFLOWS / name
    assert path.is_file(), f"missing workflow: {path}"
    return path.read_text(encoding="utf-8")


def _top_level_permissions(text: str) -> dict:
    """Parse the top-level (column-0) ``permissions:`` mapping block -> {scope: value}."""
    out: dict = {}
    in_block = False
    for line in text.splitlines():
        if re.match(r"^permissions:\s*$", line):
            in_block = True
            continue
        if in_block:
            if re.match(r"^\S", line):  # next column-0 key ends the block
                break
            m = re.match(r"^\s+([\w-]+):\s*([^\s#]+)", line)
            if m:
                out[m.group(1)] = m.group(2)
    return out


def _has_indented_line(text: str, scope: str, value: str) -> bool:
    return re.search(
        rf"^\s+{re.escape(scope)}:\s*{re.escape(value)}\b", text, re.MULTILINE
    ) is not None


_READ_ONLY_TOP = ["ci.yml", "codeql.yml", "bloat-check.yml", "pr-review.yml"]


@pytest.mark.parametrize("name", _READ_ONLY_TOP)
def test_top_level_token_is_read_only(name: str) -> None:
    top = _top_level_permissions(_read(name))
    assert top, f"{name}: explicit top-level `permissions:` block missing"
    assert top.get("contents") == "read", f"{name}: top-level must grant contents:read"
    writes = [k for k, v in top.items() if v == "write"]
    assert not writes, f"{name}: top-level must stay read-only; write scopes found: {writes}"


def test_bloat_check_widens_pr_write_at_job_level() -> None:
    # top-level has no write (asserted above) -> any pull-requests:write is job-level.
    assert _has_indented_line(_read("bloat-check.yml"), "pull-requests", "write"), (
        "bloat-check must widen to pull-requests:write (job-level)"
    )


def test_pr_review_widens_pr_write_at_job_level() -> None:
    assert _has_indented_line(_read("pr-review.yml"), "pull-requests", "write"), (
        "pr-review `review` job must widen to pull-requests:write"
    )


def test_codeql_widens_security_events_at_job_level() -> None:
    assert _has_indented_line(_read("codeql.yml"), "security-events", "write"), (
        "codeql `analyze` job needs security-events:write (job-level)"
    )


def test_security_yml_is_the_documented_top_level_exception() -> None:
    # security.yml KEEPS its write scopes at the top level — convention-locked by
    # the compliance A5.3 audit. Asserting it here documents the exception.
    top = _top_level_permissions(_read("security.yml"))
    assert top.get("security-events") == "write"
    assert top.get("actions") == "read"
    assert top.get("contents") == "read"

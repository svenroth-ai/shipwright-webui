"""Shared fixture builders for the stale-verdict test modules.

`test_pr_review_dismiss.py` (pure selection) and `test_pr_review_dismiss_calls.py`
(the two `gh`-facing entry points) are separate modules only because one file
carrying both crossed the source-size guideline. They describe one subject, so
the review shapes they build live in one place — a budget met by copying a
fixture block into a second file is met on paper only.

Not `conftest.py`, and not pytest fixtures: these are plain builders, and this
directory already carries its shared helpers as `_`-prefixed modules
(`_pr_review_shell.py`, `_pr_review_workflows.py`).

Vendored from the canonical monorepo (plugins/shipwright-security/tests/
_pr_review_fixtures.py, ADR-117). Every BUILDER is byte-identical; this
docstring is not — the vendoring note was added and the `conftest.py` rationale
was rewritten, because canonical's reason ("that module owns the source-tree
pollution guards") describes a file this repo does not have.
"""

from __future__ import annotations

__all__ = ["BOT", "HEAD", "NONCE", "OLD", "OTHER_NONCE",
           "anchor", "crlf_body", "marked_body", "review"]

NONCE = "0" * 32
OTHER_NONCE = "f" * 32
HEAD = "aaaaaaaabbbbbbbbccccccccdddddddd11111111"
OLD = "99999999888888887777777766666666ffffffff"
BOT = "github-actions[bot]"


def marked_body(nonce: str) -> str:
    """A body shaped exactly like a posted review: marker on the last line."""
    return f"x\n\n<!-- shipwright-pr-review:{nonce} -->"


def crlf_body(nonce: str) -> str:
    """The same body as GitHub actually returns it.

    Every other fixture here uses bare LF. The call that absorbs the trailing
    CR is `_own_marker`'s `.rstrip()`, not its trailing `.strip()` — canonical's
    docstring credits the wrong one, measured in this port (iterate spec ledger
    row 7). Remove `.rstrip()` and this body's last line is empty, `fullmatch`
    fails, no anchor is ever found, and the feature dies against live GitHub
    while every LF-only test stays green.
    """
    crlf, marker = "\r\n", f"<!-- shipwright-pr-review:{nonce} -->"
    return f"summary{crlf}{crlf}{marker}{crlf}"


def review(rid, *, state="CHANGES_REQUESTED", commit=OLD, login=BOT,
           kind="Bot", nonce=OTHER_NONCE, body=None):
    """A review object shaped like the live API (probe P1 on PR #446)."""
    text = body if body is not None else f"summary\n\n<!-- shipwright-pr-review:{nonce} -->"
    return {"id": rid, "state": state, "commit_id": commit, "body": text,
            "user": {"login": login, "type": kind}}


def anchor(commit=HEAD):
    """This run's own review: marked with NONCE, posted as a COMMENTED state."""
    return review(1, state="COMMENTED", commit=commit, nonce=NONCE)

"""The `gh`-CLI boundary for the Tier-3 PR reviewer.

Vendored from the canonical shipwright monorepo. The WebUI has no Python
``shared/``/``plugins/`` tree on the CI runner, so the reviewer lives in-repo
(same convention as ``scripts/hooks/anti_ratchet_check.py``).

# canonical-source-hash: fa3852e6c34e61719a97bd7c78fb9950f8bf83abf9e168b172c2603479056ee7
# canonical-source-repo: https://github.com/svenroth-ai/shipwright
# canonical-source-paths:
#   plugins/shipwright-security/scripts/lib/pr_review_gh.py
# canonical-source-version: iterate-2026-07-27-pr-review-forged-boundary
# canonical-source-hash = sha256(the canonical file's bytes at the version above)
# adaptation: none — the body is byte-identical to canonical below the docstring.

Three thin subprocess wrappers: fetch the PR's diff, post the review comment,
post the review state. Split out of ``pr_review.py`` so the tool script keeps to
the source-size guideline and the subprocess surface — the one place where
attacker-controlled bytes enter the process — is its own reviewable module.

See ``pr_review_diff_filter._split_sections`` for why the fetch reads bytes.
"""

from __future__ import annotations

import subprocess

__all__ = ["fetch_pr_diff", "post_pr_comment", "post_pr_review_state"]


def fetch_pr_diff(pr_number: int, repo: str) -> str:
    """Fetch the unified diff for a PR via the `gh` CLI.

    Read as BYTES and decode without newline translation. `text=True` would run
    CPython's universal-newline pass, which rewrites a lone CR to LF **before any
    parser sees it** — and git ends a diff line at LF only. A PR whose own
    content carries a CR could therefore manufacture a line break, and with it a
    counterfeit `diff --git` header at column 0, splitting one real file section
    into two. Everything downstream — the generated-artifact filter, the size
    cap, the file lists shown to the model and to humans — trusts that boundary.
    """
    proc = subprocess.run(
        ["gh", "pr", "diff", str(pr_number), "--repo", repo],
        capture_output=True,
        timeout=120,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(f"`gh pr diff` failed ({proc.returncode}): {err}")
    return proc.stdout.decode("utf-8", "replace")


# `encoding=` rather than `text=True` on every call that carries a body: the
# rendered comment always contains non-ASCII (the decision badges), and
# `text=True` encodes with the locale's preferred encoding. On a runner whose
# LC_CTYPE is not UTF-8 that raises, the caller swallows it best-effort, and the
# maintainer is left with a red required check and no comment explaining it.
_TEXT = {"encoding": "utf-8", "errors": "replace"}


def post_pr_comment(pr_number: int, repo: str, body: str) -> None:
    """Post the review comment to the PR via `gh pr comment` (stdin body)."""
    proc = subprocess.run(
        ["gh", "pr", "comment", str(pr_number), "--repo", repo, "--body-file", "-"],
        input=body,
        capture_output=True,
        timeout=60,
        **_TEXT,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"`gh pr comment` failed ({proc.returncode}): {proc.stderr.strip()}")


def post_pr_review_state(pr_number: int, repo: str, decision: str, summary: str) -> None:
    """Post a review state (best-effort): block -> request-changes, else -> comment.

    Deliberately never `--approve` (a bot approving its own org's PR is noise and
    can fail). The merge gate is the workflow job's exit code, not this state.

    Best-effort means the gate does not flip on a failure — not that a failure
    goes unrecorded. `gh pr review` fails on a rate limit, a revoked token, or
    "can not review your own pull request"; raising lets the caller log it.
    """
    norm = (decision or "").strip().lower()
    flag = "--request-changes" if norm == "block" else "--comment"
    body = summary or "Automated Tier-3 review."
    proc = subprocess.run(
        ["gh", "pr", "review", str(pr_number), "--repo", repo, flag, "--body", body],
        capture_output=True,
        timeout=60,
        **_TEXT,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"`gh pr review` failed ({proc.returncode}): {proc.stderr.strip()}")

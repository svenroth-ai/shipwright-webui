"""Tests for pr_review.py's unconditional decision-log excerpt.

Ported from canonical shipwright's test_pr_review_decision_log.py
(iterate-2026-09-03-pr-review-block-visibility, PR #674), split into its own
module for the same reason `test_pr_review_orchestration.py` was split out of
`test_pr_review_script.py`: keeping any one file inside the 300-line source
guideline.

trg: PR #672's 4 legitimate GLM-5.3 `block` verdicts read as a silent CI hang
across 4 runs because main() printed nothing past "reviewing PR..." for a
correct block/approve/comment decision — only the unknown-decision path
explained itself. The full findings were already posted as a PR comment; this
module covers the CI-log excerpt that now says so too. The webui port also
routes the excerpt through `strip_display_unsafe` (this file's own guard for
untrusted text reaching a terminal), unlike canonical shipwright's copy which
has no such sink to match.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

CI_DIR = Path(__file__).resolve().parent.parent  # scripts/ci
sys.path.insert(0, str(CI_DIR))

import pr_review  # noqa: E402

from _pr_review_offline import no_real_gh  # noqa: E402,F401

# Deliberately NOT in any real credential format so the repo's secret-scan
# hooks don't flag this synthetic fixture. Redaction is format-agnostic.
FAKE_KEY = "ORTESTKEY-not-a-real-credential-0123456789"

ARGV = ["--pr-number", "42", "--repo", "owner/repo", "--prompt-dir", "scripts/ci/pr_reviewer"]


def _wire(monkeypatch, *, review_json=None, diff="diff --git a b\n+x\n"):
    """Patch every external boundary; capture posted comment/review state.

    Mirrors test_pr_review_orchestration.py::_wire — kept as its own copy
    rather than imported, matching that module's own established pattern
    (each orchestration test module wires main() independently; only the
    `no_real_gh` offline tripwire is shared, via `_pr_review_offline`).
    """
    posted = {}
    monkeypatch.setenv("OPENROUTER_API_KEY", FAKE_KEY)
    monkeypatch.delenv("SHIPWRIGHT_PR_REVIEW_MODEL", raising=False)
    monkeypatch.setattr(pr_review, "load_prompts", lambda d: ("SYSTEM", "USER\n{PR_META}\n{DIFF}"))
    monkeypatch.setattr(pr_review, "fetch_pr_diff", lambda pr, repo: diff)

    def fake_call(api_key, model, messages, timeout=pr_review.DEFAULT_TIMEOUT, *, extra_body=None):
        posted["messages"] = messages
        posted["extra_body"] = extra_body
        return review_json

    monkeypatch.setattr(pr_review, "call_openrouter", fake_call)
    monkeypatch.setattr(
        pr_review, "post_pr_comment", lambda pr, repo, body: posted.update(comment=body))
    monkeypatch.setattr(
        pr_review, "post_pr_review_state",
        lambda pr, repo, decision, summary: posted.update(state=decision))
    monkeypatch.setattr(pr_review, "read_reviewed_head", lambda pr, repo: "headsha")
    monkeypatch.setattr(pr_review, "dismiss_own_stale_verdicts",
                        lambda pr, repo, *, nonce, reviewed_sha: None)
    return posted


@pytest.mark.usefixtures("no_real_gh")
class TestDecisionLog:

    def test_block_decision_logs_a_bounded_excerpt(self, monkeypatch, capsys):
        _wire(monkeypatch, review_json=json.dumps(
            {"decision": "block", "summary": "Two real defects found in the diff.",
             "blocking": ["b"], "comments": []}))
        assert pr_review.main(ARGV) == 1
        err = capsys.readouterr().err
        assert "decision=block" in err
        assert "exit=1" in err
        assert "Two real defects found in the diff." in err
        assert "PR comment" in err

    def test_approve_and_comment_also_log_unconditionally(self, monkeypatch, capsys):
        _wire(monkeypatch, review_json=json.dumps(
            {"decision": "approve", "summary": "lgtm", "blocking": [], "comments": []}))
        assert pr_review.main(ARGV) == 0
        assert "decision=approve" in capsys.readouterr().err

        _wire(monkeypatch, review_json=json.dumps(
            {"decision": "comment", "summary": "nit", "blocking": [], "comments": ["c"]}))
        assert pr_review.main(ARGV) == 0
        assert "decision=comment" in capsys.readouterr().err

    def test_decision_log_excerpt_is_bounded(self, monkeypatch, capsys):
        _wire(monkeypatch, review_json=json.dumps(
            {"decision": "comment", "summary": "x" * 5000, "blocking": [], "comments": []}))
        pr_review.main(ARGV)
        assert len(capsys.readouterr().err) < 1000

    def test_decision_log_excerpt_is_redacted(self, monkeypatch, capsys):
        _wire(monkeypatch, review_json=json.dumps(
            {"decision": "block", "summary": f"leaked {FAKE_KEY} in summary",
             "blocking": [], "comments": []}))
        pr_review.main(ARGV)
        assert FAKE_KEY not in capsys.readouterr().err

    def test_decision_log_excerpt_is_scrubbed_of_control_chars(self, monkeypatch, capsys):
        # This file's own sink discipline (see strip_display_unsafe's docstring
        # in pr_review_dismiss.py): a model summary is as untrusted as `gh`'s
        # own error bodies, and shares the same terminal-escape risk.
        _wire(monkeypatch, review_json=json.dumps(
            {"decision": "block", "summary": "evil\x1b[31mred\x1b[0m",
             "blocking": [], "comments": []}))
        pr_review.main(ARGV)
        assert "\x1b" not in capsys.readouterr().err

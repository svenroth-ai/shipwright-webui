"""Tests for scripts/ci/pr_review.py — the Tier-3 PR reviewer (I/O + orchestration).

The script is the OpenRouter-backed reviewer invoked by stage 2
(`.github/workflows/pr-review-run.yml`) for Tier-3 PRs (external contributors,
sensitive paths, or `needs-review` label). It must:

- fetch the PR diff, call OpenRouter, parse a strict-JSON decision, post a PR comment
- map the decision to an exit code: 0 = approve/comment, 1 = block, 2 = error
- dump the raw response (redacted) on a JSON-parse failure and exit 2
- truncate a > 200k-char diff and FAIL CLOSED on a (partial) truncated review (needs human)
- never write the OpenRouter API key to logs

The pure helpers (parse/truncate/render/redact/decision-mapping) live in
pr_review_lib.py and are covered by test_pr_review_lib.py. All network (`urllib`)
and `gh`-subprocess boundaries are monkeypatched so the suite runs fully offline.

Vendored from the canonical monorepo (plugins/shipwright-security/tests/
test_pr_review_script.py); paths re-pointed to the WebUI's flat `scripts/ci/` layout.
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

# Deliberately NOT in any real credential format (no `sk-`/`ghp_`/`xox` prefix) so the
# repo's secret-scan hooks don't flag this synthetic fixture. Redaction is format-agnostic.
FAKE_KEY = "ORTESTKEY-not-a-real-credential-0123456789"

SCRIPT_PATH = CI_DIR / "pr_review.py"


# ---------------------------------------------------------------------------
# File contract
# ---------------------------------------------------------------------------

class TestFileContract:

    def test_script_exists(self):
        assert SCRIPT_PATH.exists()

    def test_shebang_present(self):
        first = SCRIPT_PATH.read_text(encoding="utf-8").splitlines()[0]
        assert first == "#!/usr/bin/env python3", "missing python3 shebang"

    def test_uses_openrouter_key_not_anthropic(self):
        src = SCRIPT_PATH.read_text(encoding="utf-8")
        assert "OPENROUTER_API_KEY" in src, "script must read OPENROUTER_API_KEY"
        assert "ANTHROPIC_API_KEY" not in src, (
            "script must not reference ANTHROPIC_API_KEY — OpenRouter is the single provider"
        )

    def test_default_model_is_sonnet(self):
        assert pr_review.DEFAULT_MODEL == "anthropic/claude-sonnet-4.6"

    def test_no_reviewer_module_silently_crosses_the_size_guideline(self):
        """The reviewer family stays inside the 300-line source guideline.

        This is a CI-visible ratchet because nothing else here is one. The
        pre-commit hook blocks a RATCHET of a file already in
        `shipwright_bloat_baseline.json`; a brand-new crossing is only advisory
        there, and the detective audit that would catch it runs in the
        shipwright dev repo, not in webui. So `pr_review.py` drifting over 300
        again would reach `main` unremarked — and it has been pushed to the
        ceiling in three consecutive iterates now (299 after the truncation
        fix, 299 again after the two-stage split, which recorded the missing
        headroom as a finding, and it was ADR-117's wiring that finally spent
        it). A baseline entry still wins, so a DELIBERATE exception is a
        one-line record rather than a fight with this test.
        """
        baseline = json.loads(
            (CI_DIR.parent.parent / "shipwright_bloat_baseline.json").read_text(encoding="utf-8"))
        excepted = {e["path"] for e in baseline["entries"]}
        oversize = {
            path.name: len(path.read_text(encoding="utf-8").splitlines())
            for path in sorted(CI_DIR.glob("pr_review*.py"))
            if f"scripts/ci/{path.name}" not in excepted
            and len(path.read_text(encoding="utf-8").splitlines()) > 300
        }
        assert not oversize, (
            f"over the 300-line guideline with no baseline entry: {oversize}. "
            "Split at a real seam (one module per external boundary is the one "
            "this family uses) or record a baseline exception with a reason."
        )


# ---------------------------------------------------------------------------
# main() orchestration — boundaries monkeypatched
# ---------------------------------------------------------------------------

def _wire(monkeypatch, *, review_json=None, diff="diff --git a b\n+x\n", raise_call=None):
    """Patch every external boundary; capture posted comment/review state."""
    posted = {}
    monkeypatch.setenv("OPENROUTER_API_KEY", FAKE_KEY)
    # Isolate orchestration from the filesystem prompt files (cwd-dependent).
    monkeypatch.setattr(pr_review, "load_prompts", lambda d: ("SYSTEM", "USER\n{PR_META}\n{DIFF}"))
    monkeypatch.setattr(pr_review, "fetch_pr_diff", lambda pr, repo: diff)

    def fake_call(api_key, model, messages, timeout=120):
        if raise_call is not None:
            raise raise_call
        return review_json

    monkeypatch.setattr(pr_review, "call_openrouter", fake_call)
    monkeypatch.setattr(
        pr_review, "post_pr_comment",
        lambda pr, repo, body: posted.update(comment=body),
    )
    monkeypatch.setattr(
        pr_review, "post_pr_review_state",
        lambda pr, repo, decision, summary: posted.update(state=decision),
    )
    # ADR-117 added two more `gh` boundaries to main(): the pre-diff head read
    # and the stale-verdict cleanup. Patch BOTH — this module's docstring
    # promises the suite runs fully offline, and `.github/workflows/pr-review.yml`
    # labels the job that runs it "Offline, no credentials".
    #
    # Without these two lines every TestMainOrchestration case spawned a real
    # `gh api repos/owner/repo/pulls/42`, and the two passing-verdict cases went
    # on to run the REAL cleanup against a repo slug that is not ours. Nothing
    # could be dismissed (the fresh nonce is never posted, so no anchor is found
    # and the selector refuses), which is exactly why it was invisible: green,
    # and quietly making authenticated network calls from an offline suite.
    monkeypatch.setattr(pr_review, "read_reviewed_head", lambda pr, repo: "headsha")
    monkeypatch.setattr(pr_review, "dismiss_own_stale_verdicts",
                        lambda pr, repo, *, nonce, reviewed_sha: None)
    return posted


ARGV = ["--pr-number", "42", "--repo", "owner/repo", "--prompt-dir", "scripts/ci/pr_reviewer"]


@pytest.mark.usefixtures("no_real_gh")
class TestMainOrchestration:

    def test_missing_api_key_exits_2(self, monkeypatch):
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
        assert pr_review.main(ARGV) == 2

    def test_block_exits_1(self, monkeypatch):
        _wire(monkeypatch, review_json=json.dumps(
            {"decision": "block", "summary": "no", "blocking": ["b"], "comments": []}))
        assert pr_review.main(ARGV) == 1

    def test_approve_exits_0(self, monkeypatch):
        posted = _wire(monkeypatch, review_json=json.dumps(
            {"decision": "approve", "summary": "lgtm", "blocking": [], "comments": []}))
        assert pr_review.main(ARGV) == 0
        assert "lgtm" in posted["comment"]

    def test_comment_exits_0(self, monkeypatch):
        _wire(monkeypatch, review_json=json.dumps(
            {"decision": "comment", "summary": "nit", "blocking": [], "comments": ["c"]}))
        assert pr_review.main(ARGV) == 0

    def test_openrouter_error_exits_2(self, monkeypatch):
        _wire(monkeypatch, raise_call=RuntimeError("502 Bad Gateway"))
        assert pr_review.main(ARGV) == 2

    def test_json_parse_fail_exits_2_and_dumps_raw(self, monkeypatch, capsys):
        _wire(monkeypatch, review_json="<html>rate limited</html>")
        assert pr_review.main(ARGV) == 2
        err = capsys.readouterr().err
        assert "rate limited" in err  # raw response dumped to logs

    def test_truncation_fails_closed_needs_human(self, monkeypatch):
        # A truncated (partial) diff means we did NOT see the whole change. For a
        # required gate on an untrusted PR, a large diff must not bypass review by
        # size — fail CLOSED (non-zero) even on a partial APPROVE, forcing a
        # request-changes review state so a human must look. The red required
        # check is also what lets the gh-pr-ci triage producer surface the PR.
        posted = _wire(
            monkeypatch,
            diff="z" * (pr_review.MAX_DIFF_CHARS + 1000),
            review_json=json.dumps(
                {"decision": "approve", "summary": "huge", "blocking": [], "comments": []}),
        )
        rc = pr_review.main(ARGV)
        assert rc == pr_review.EXIT_BLOCK
        assert rc != pr_review.EXIT_OK  # the size-bypass is closed
        assert "truncat" in posted["comment"].lower()
        assert posted["state"] == "block"  # forced request-changes on truncation

    def test_api_key_never_logged(self, monkeypatch, capsys):
        # Force the worst path (error message embeds the key) and assert it is
        # never present in any captured output.
        _wire(monkeypatch, raise_call=RuntimeError(f"boom with {FAKE_KEY} in message"))
        pr_review.main(ARGV)
        captured = capsys.readouterr()
        assert FAKE_KEY not in captured.out
        assert FAKE_KEY not in captured.err

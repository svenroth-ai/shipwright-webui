"""Shared `main()`-orchestration test wiring for `scripts/ci/pr_review.py`.

Split out of `test_pr_review_orchestration.py` (300-line source guideline —
the wiring helper + shared constant were pure duplication once that file's
tests split into `test_pr_review_orchestration.py` (decision/exit-code +
routing) and `test_pr_review_orchestration_diff_filtering.py` (fail-closed
diff-filtering gate)). No tests of its own — `_wire()` patches every
external boundary pr_review.main() touches (OpenRouter, `gh` reads/writes,
prompt loading) so both suites run fully offline; `ARGV` is the shared
`main()` invocation both suites drive.
"""

from __future__ import annotations

import sys
from pathlib import Path

CI_DIR = Path(__file__).resolve().parent.parent  # scripts/ci
sys.path.insert(0, str(CI_DIR))

import pr_review  # noqa: E402

# Deliberately NOT in any real credential format (no `sk-`/`ghp_`/`xox` prefix) so the
# repo's secret-scan hooks don't flag this synthetic fixture. Redaction is format-agnostic.
FAKE_KEY = "ORTESTKEY-not-a-real-credential-0123456789"

ARGV = ["--pr-number", "42", "--repo", "owner/repo", "--prompt-dir", "scripts/ci/pr_reviewer"]


def wire(monkeypatch, *, review_json=None, diff="diff --git a b\n+x\n", raise_call=None):
    """Patch every external boundary; capture posted comment/review state."""
    posted = {}
    monkeypatch.setenv("OPENROUTER_API_KEY", FAKE_KEY)
    # A real SHIPWRIGHT_PR_REVIEW_MODEL in the test-runner's own env would
    # silently swap which model (and ZDR policy) these cases exercise.
    monkeypatch.delenv("SHIPWRIGHT_PR_REVIEW_MODEL", raising=False)
    # Isolate orchestration from the filesystem prompt files (cwd-dependent).
    monkeypatch.setattr(pr_review, "load_prompts", lambda d: ("SYSTEM", "USER\n{PR_META}\n{DIFF}"))
    monkeypatch.setattr(pr_review, "fetch_pr_diff", lambda pr, repo: diff)

    def fake_call(api_key, model, messages, timeout=pr_review.DEFAULT_TIMEOUT, *, extra_body=None):
        # Capture what actually reaches the MODEL. Asserting only on the posted
        # comment lets the meta wiring rot silently: dropping the file lists from
        # the build_pr_meta call would otherwise leave the whole suite green.
        # `extra_body` too — main() resolves it and must actually thread it
        # through; a fake that drops the kwarg (like this one used to) would
        # keep the whole suite green even if that wiring were deleted.
        posted["messages"] = messages
        posted["extra_body"] = extra_body
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

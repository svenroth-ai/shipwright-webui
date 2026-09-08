"""Tests for scripts/ci/pr_review.py — `main()` decision/exit-code contract
and model-routing.

Split out of `test_pr_review_script.py` (2026-08-05) to stay inside the
300-line source guideline, then split AGAIN (this iterate) once it grew back
to 352: the fail-closed diff-filtering gate (truncation, generated-artifact
exclusion, "nothing to review") now lives in
`test_pr_review_orchestration_diff_filtering.py`, sharing the `wire()` /
`ARGV` helper from `_pr_review_orchestration_wire`. This module keeps
everything about the decision->exit-code mapping itself and model/ZDR
routing — `TestFileContract` (shebang, re-export surface, the size
guideline itself) stays in the sibling `test_pr_review_script.py`.

The script is the OpenRouter-backed reviewer invoked by stage 2
(`.github/workflows/pr-review-run.yml`) for Tier-3 PRs (external contributors,
sensitive paths, or `needs-review` label). It must fetch the diff, drop
producer-generated sections, REFUSE to proceed when nothing is left, call
OpenRouter, parse a strict-JSON decision, post a comment, and map that decision
to an exit code (0 approve/comment, 1 block, 2 error); dump the raw response
redacted and exit 2 on a parse failure; cut an over-cap diff at a FILE BOUNDARY
and FAIL CLOSED on the partial review that leaves, naming what went unreviewed;
retract its own superseded change-requests on a passing verdict (ADR-117); and
never log the API key.

The pure helpers live in `pr_review_lib` / `pr_review_diff_filter` /
`pr_review_render` and the three I/O boundaries in `pr_review_gh` /
`pr_review_openrouter` / `pr_review_dismiss`, each with its own test module.
Every network and `gh` boundary is monkeypatched in `_pr_review_orchestration_wire`,
so both suites run fully offline.

Vendored from the canonical monorepo (plugins/shipwright-security/tests/
test_pr_review_script.py); paths re-pointed to the WebUI's flat `scripts/ci/`
layout.
"""

from __future__ import annotations

import json

import pytest

from _pr_review_orchestration_wire import ARGV, FAKE_KEY, wire
import pr_review  # noqa: E402
from _pr_review_offline import no_real_gh  # noqa: E402,F401


@pytest.mark.usefixtures("no_real_gh")
class TestMainOrchestration:

    def test_missing_api_key_exits_2(self, monkeypatch):
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
        assert pr_review.main(ARGV) == 2

    def test_block_exits_1(self, monkeypatch):
        wire(monkeypatch, review_json=json.dumps(
            {"decision": "block", "summary": "no", "blocking": ["b"], "comments": []}))
        assert pr_review.main(ARGV) == 1

    def test_approve_exits_0(self, monkeypatch):
        posted = wire(monkeypatch, review_json=json.dumps(
            {"decision": "approve", "summary": "lgtm", "blocking": [], "comments": []}))
        assert pr_review.main(ARGV) == 0
        assert "lgtm" in posted["comment"]

    def test_comment_exits_0(self, monkeypatch):
        wire(monkeypatch, review_json=json.dumps(
            {"decision": "comment", "summary": "nit", "blocking": [], "comments": ["c"]}))
        assert pr_review.main(ARGV) == 0

    def test_openrouter_error_exits_2(self, monkeypatch):
        wire(monkeypatch, raise_call=RuntimeError("502 Bad Gateway"))
        assert pr_review.main(ARGV) == 2

    def test_json_parse_fail_exits_2_and_dumps_raw(self, monkeypatch, capsys):
        wire(monkeypatch, review_json="<html>rate limited</html>")
        assert pr_review.main(ARGV) == 2
        err = capsys.readouterr().err
        assert "rate limited" in err  # raw response dumped to logs

    def test_a_broken_template_exits_2_redacted_not_as_a_traceback(self, monkeypatch, capsys):
        # build_messages raises when the shipped template lost a placeholder.
        # That was the only boundary in main() not caught — it escaped as a raw
        # traceback, bypassing _redact and the documented exit-code table, and
        # was fail-closed only by the accident that exit 1 == EXIT_BLOCK.
        wire(monkeypatch, review_json=json.dumps({"decision": "approve"}))
        monkeypatch.setattr(pr_review, "load_prompts",
                            lambda d: ("SYSTEM", "USER with no placeholders"))
        assert pr_review.main(ARGV) == pr_review.EXIT_ERROR
        err = capsys.readouterr().err
        assert "missing" in err
        assert "Traceback" not in err
        assert FAKE_KEY not in err

    def test_the_fail_closed_comment_does_not_credit_a_model(self, monkeypatch):
        # This branch returns BEFORE call_openrouter, so a footer naming the
        # model says a review happened that provably did not.
        posted = wire(monkeypatch, review_json=json.dumps({"decision": "approve"}), diff="")
        assert pr_review.main(ARGV) == pr_review.EXIT_BLOCK
        assert pr_review.DEFAULT_MODEL not in posted["comment"]
        assert "nothing was sent" in posted["comment"]

    def test_api_key_never_logged(self, monkeypatch, capsys):
        # Force the worst path (error message embeds the key) and assert it is
        # never present in any captured output.
        wire(monkeypatch, raise_call=RuntimeError(f"boom with {FAKE_KEY} in message"))
        pr_review.main(ARGV)
        captured = capsys.readouterr()
        assert FAKE_KEY not in captured.out
        assert FAKE_KEY not in captured.err

    def test_the_default_luna_model_never_touches_zdr_routing(self, monkeypatch):
        # The positive case for the CURRENT default (GPT-5.6 Luna,
        # iterate-2026-09-03-pr-review-sonnet-default, after GLM 5.3 was found
        # to silently hang mid-review on the shared ZDR provider pool — see
        # pr_review_openrouter.py's DEFAULT_MODEL comment): with no override,
        # main() must thread an EMPTY extra_body through — Luna is outside the
        # deepseek/z-ai namespaces, so resolve_extra_body's short-circuit
        # applies and no ZDR provider pin (with its `allow_fallbacks: false`)
        # is ever added.
        posted = wire(monkeypatch, review_json=json.dumps(
            {"decision": "approve", "summary": "lgtm", "blocking": [], "comments": []}))
        assert pr_review.main(ARGV) == pr_review.EXIT_OK
        assert posted["extra_body"] == {}

    def test_the_deepseek_override_still_delivers_the_zdr_body(self, monkeypatch):
        # DeepSeek stays available as an operator override — its ZDR routing
        # must still work even though it is no longer the default. Set the
        # override AFTER wire(), which unconditionally delenv's this var to
        # keep the default-path cases isolated from the test runner's own env.
        posted = wire(monkeypatch, review_json=json.dumps(
            {"decision": "approve", "summary": "lgtm", "blocking": [], "comments": []}))
        monkeypatch.setenv("SHIPWRIGHT_PR_REVIEW_MODEL", pr_review.DEEPSEEK_MODEL)
        assert pr_review.main(ARGV) == pr_review.EXIT_OK
        assert posted["extra_body"]["provider"]["zdr"] is True
        assert posted["extra_body"]["provider"]["data_collection"] == "deny"

    def test_the_glm_override_still_delivers_the_zdr_body(self, monkeypatch):
        # GLM 5.3 stays available as an operator override too (its hang was an
        # availability problem with the shared ZDR provider pool, not a reason
        # to remove the routing wiring) — its ZDR routing must still work. Set
        # the override AFTER wire() for the same reason as above.
        posted = wire(monkeypatch, review_json=json.dumps(
            {"decision": "approve", "summary": "lgtm", "blocking": [], "comments": []}))
        monkeypatch.setenv("SHIPWRIGHT_PR_REVIEW_MODEL", pr_review.GLM_MODEL)
        assert pr_review.main(ARGV) == pr_review.EXIT_OK
        assert posted["extra_body"]["provider"]["zdr"] is True
        assert posted["extra_body"]["provider"]["data_collection"] == "deny"

    def test_a_misconfigured_routing_policy_exits_2_before_any_network_call(
            self, monkeypatch, capsys):
        # The OTHER half of resolve_extra_body's contract: a raise there must
        # map to EXIT_ERROR before fetch_pr_diff / call_openrouter ever run —
        # not escape as a traceback, not fall through to a network call.
        called = {}
        monkeypatch.setenv("OPENROUTER_API_KEY", FAKE_KEY)

        def _raise_routing_error(model):
            raise pr_review.DeepSeekRoutingPolicyError("provider allowlist mismatch")

        monkeypatch.setattr(pr_review, "resolve_extra_body", _raise_routing_error)
        monkeypatch.setattr(pr_review, "fetch_pr_diff",
                            lambda pr, repo: called.setdefault("diff_fetched", True))
        monkeypatch.setattr(pr_review, "call_openrouter",
                            lambda *a, **k: called.setdefault("model_called", True))
        assert pr_review.main(ARGV) == pr_review.EXIT_ERROR
        assert "diff_fetched" not in called
        assert "model_called" not in called
        err = capsys.readouterr().err
        assert "reviewer misconfigured" in err
        assert "provider allowlist mismatch" in err

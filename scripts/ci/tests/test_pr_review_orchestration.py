"""Tests for scripts/ci/pr_review.py — `main()` orchestration.

Split out of `test_pr_review_script.py` (2026-08-05) to stay inside the
300-line source guideline: merging the canonical-parity iterate's fail-closed
orchestration tests with the ADR-117 port's `_wire()` hardening (patching the
two new `gh` boundaries `read_reviewed_head` / `dismiss_own_stale_verdicts` so
the suite stays offline) pushed the combined file to 343 lines. `TestFileContract`
(shebang, re-export surface, the size guideline itself) stays in the sibling
module; this one owns everything that actually RUNS `main()`.

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
Every network and `gh` boundary is monkeypatched here, so the suite runs fully
offline.

Vendored from the canonical monorepo (plugins/shipwright-security/tests/
test_pr_review_script.py); paths re-pointed to the WebUI's flat `scripts/ci/`
layout.
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


def _wire(monkeypatch, *, review_json=None, diff="diff --git a b\n+x\n", raise_call=None):
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
        # A partial diff means we did NOT see the whole change, so a large diff
        # must not bypass the gate by size — fail CLOSED even on a partial
        # APPROVE. Rationale in pr_review_diff_filter.MAX_DIFF_CHARS.
        posted = _wire(
            monkeypatch,
            # A real over-cap diff WITH headers. A headerless one is caught
            # earlier as "nothing to review", which is a different branch.
            diff=("diff --git a/big.ts b/big.ts\n--- a/big.ts\n+++ b/big.ts\n"
                  "@@ -1 +1 @@\n" + "+z" * pr_review.MAX_DIFF_CHARS + "\n"),
            review_json=json.dumps(
                {"decision": "approve", "summary": "huge", "blocking": [], "comments": []}),
        )
        rc = pr_review.main(ARGV)
        assert rc == pr_review.EXIT_BLOCK
        assert rc != pr_review.EXIT_OK  # the size-bypass is closed
        assert "review limit" in posted["comment"].lower()
        assert "big.ts" in posted["comment"]      # says WHICH file went unreviewed
        assert posted["state"] == "block"  # forced request-changes on truncation

    def test_an_oversized_diff_names_the_unreviewed_file_in_every_sink(
            self, monkeypatch, capsys):
        # End to end: the file list survives truncation -> meta -> comment, and
        # both sinks are sanitised. Diff paths are PR-controlled and CI logs are
        # read in a terminal.
        def _s(p, body):
            return f"diff --git a/{p} b/{p}\n--- a/{p}\n+++ b/{p}\n@@ -1 +1 @@\n{body}\n"
        posted = _wire(monkeypatch, review_json=json.dumps({"decision": "approve"}),
                       diff=_s("s.ts", "+y")
                       + _s("b\x1b[31mig.ts", "+x" * pr_review.MAX_DIFF_CHARS))
        assert pr_review.main(ARGV) == pr_review.EXIT_BLOCK
        assert "ig.ts" in posted["comment"]
        assert "\x1b" not in posted["comment"]
        assert "\x1b" not in capsys.readouterr().err
        # ...and the MODEL is told too, not just the human.
        assert "ig.ts" in posted["messages"][1]["content"]

    def test_a_fully_filtered_pr_fails_closed(self, monkeypatch, capsys):
        # This script runs only on PRs the tier step said need review. If the
        # generated-artifact filter leaves nothing, the model would be handed an
        # empty diff — and the system prompt answers that with `approve`. A fork
        # PR touching only regenerated artifacts is the shape that matters.
        posted = _wire(monkeypatch, review_json=json.dumps({"decision": "approve"}),
                       diff="diff --git a/.shipwright/triage.jsonl b/.shipwright/triage.jsonl\n"
                            "--- a/.shipwright/triage.jsonl\n"
                            "+++ b/.shipwright/triage.jsonl\n@@ -1 +1 @@\n-a\n+x\n")
        assert pr_review.main(ARGV) == pr_review.EXIT_BLOCK
        assert "messages" not in posted        # the model was never consulted
        assert "triage.jsonl" in capsys.readouterr().err

    def test_an_empty_fetch_fails_closed(self, monkeypatch, capsys):
        # The broadened gate, at its widest input. `gh pr diff` returning ''
        # satisfies neither half of the old narrow condition (nothing was
        # excluded), truncate_diff('') reports complete, and the system prompt
        # answers an empty diff with `approve`.
        posted = _wire(monkeypatch, review_json=json.dumps({"decision": "approve"}), diff="")
        assert pr_review.main(ARGV) == pr_review.EXIT_BLOCK
        assert "messages" not in posted          # the model was never consulted
        assert "no file sections at all" in capsys.readouterr().err

    def test_a_headerless_body_fails_closed(self, monkeypatch, capsys):
        # Same failure from the model's side: a `gh` body that carries no
        # LF-anchored `diff --git` header at all is also "nothing to review".
        posted = _wire(monkeypatch, review_json=json.dumps({"decision": "approve"}),
                       diff="warning: something went wrong\nno diff here\n")
        assert pr_review.main(ARGV) == pr_review.EXIT_BLOCK
        assert "messages" not in posted
        assert "no file sections at all" in capsys.readouterr().err

    def test_an_ordinary_pr_with_some_generated_files_still_runs(self, monkeypatch):
        # The fail-closed rule must not swing the other way: a PR that mixes a
        # genuinely generated artifact with real source is reviewed normally —
        # the generated section is dropped and disclosed, the source is sent.
        posted = _wire(monkeypatch, review_json=json.dumps({"decision": "approve"}),
                       diff="diff --git a/.shipwright/triage.jsonl b/.shipwright/triage.jsonl\n"
                            "--- a/.shipwright/triage.jsonl\n"
                            "+++ b/.shipwright/triage.jsonl\n@@ -1 +1 @@\n-a\n+b\n"
                            "diff --git a/server/src/x.ts b/server/src/x.ts\n"
                            "--- a/server/src/x.ts\n"
                            "+++ b/server/src/x.ts\n@@ -1 +1 @@\n-old\n+new\n")
        assert pr_review.main(ARGV) == pr_review.EXIT_OK
        assert "server/src/x.ts" in posted["messages"][1]["content"]
        assert "excluded" in posted["comment"].lower()   # and the drop is disclosed

    def test_a_lockfile_only_pr_is_reviewed_not_filtered_away(self, monkeypatch):
        # End to end: the lockfile used to be filtered as generated in the
        # canonical reviewer, so a fork PR touching only it left NOTHING to
        # review. On the one gate whose input is untrusted, the lockfile IS the
        # supply-chain surface — it must reach the model, and the run must not
        # fail closed on "nothing to review" either.
        posted = _wire(monkeypatch, review_json=json.dumps({"decision": "approve"}),
                       diff="diff --git a/server/package-lock.json b/server/package-lock.json\n"
                            "--- a/server/package-lock.json\n+++ b/server/package-lock.json\n"
                            "@@ -1 +1 @@\n-  \"name\": \"safe-pkg\"\n+  \"name\": \"safe-pkq\"\n")
        assert pr_review.main(ARGV) == pr_review.EXIT_OK
        assert "safe-pkq" in posted["messages"][1]["content"], \
            "the lockfile change never reached the model"
        assert "excluded" not in posted["comment"].lower()

    def test_a_broken_template_exits_2_redacted_not_as_a_traceback(self, monkeypatch, capsys):
        # build_messages raises when the shipped template lost a placeholder.
        # That was the only boundary in main() not caught — it escaped as a raw
        # traceback, bypassing _redact and the documented exit-code table, and
        # was fail-closed only by the accident that exit 1 == EXIT_BLOCK.
        _wire(monkeypatch, review_json=json.dumps({"decision": "approve"}))
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
        posted = _wire(monkeypatch, review_json=json.dumps({"decision": "approve"}), diff="")
        assert pr_review.main(ARGV) == pr_review.EXIT_BLOCK
        assert pr_review.DEFAULT_MODEL not in posted["comment"]
        assert "nothing was sent" in posted["comment"]

    def test_api_key_never_logged(self, monkeypatch, capsys):
        # Force the worst path (error message embeds the key) and assert it is
        # never present in any captured output.
        _wire(monkeypatch, raise_call=RuntimeError(f"boom with {FAKE_KEY} in message"))
        pr_review.main(ARGV)
        captured = capsys.readouterr()
        assert FAKE_KEY not in captured.out
        assert FAKE_KEY not in captured.err

    def test_the_default_models_zdr_body_actually_reaches_the_transport(self, monkeypatch):
        # THE regression guard for the whole DeepSeek-routing change: main()
        # must resolve the real policy (not a stub) and pass it through to
        # call_openrouter untouched. Deleting `extra_body=extra_body` at the
        # call site, or short-circuiting resolve_extra_body to always return
        # `{}`, would leave every other case in this file green.
        posted = _wire(monkeypatch, review_json=json.dumps(
            {"decision": "approve", "summary": "lgtm", "blocking": [], "comments": []}))
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

    def test_generated_files_excluded_lets_review_run(self, monkeypatch):
        # THE root-fix behaviour: a diff that WOULD truncate (dominated by a
        # regenerated compliance artifact) fits once generated noise is dropped —
        # so the review RUNS (exit 0 on approve) instead of failing closed on
        # truncation, and the comment discloses the exclusion.
        big_generated = (
            "diff --git a/.shipwright/compliance/test-evidence.md "
            "b/.shipwright/compliance/test-evidence.md\n"
            "--- a/.shipwright/compliance/test-evidence.md\n"
            "+++ b/.shipwright/compliance/test-evidence.md\n"
            "@@ -1 +1 @@\n" + "+x\n" * ((pr_review.MAX_DIFF_CHARS // 3) + 1_000)
        )
        source = ("diff --git a/server/src/real.ts b/server/src/real.ts\n"
                  "--- a/server/src/real.ts\n+++ b/server/src/real.ts\n"
                  "@@ -1 +1 @@\n+code\n")
        assert len(big_generated + source) > pr_review.MAX_DIFF_CHARS
        posted = _wire(
            monkeypatch, diff=big_generated + source,
            review_json=json.dumps(
                {"decision": "approve", "summary": "lgtm", "blocking": [], "comments": []}))
        assert pr_review.main(ARGV) == pr_review.EXIT_OK  # NOT blocked by truncation
        assert "truncat" not in posted["comment"].lower()
        assert "excluded" in posted["comment"].lower()

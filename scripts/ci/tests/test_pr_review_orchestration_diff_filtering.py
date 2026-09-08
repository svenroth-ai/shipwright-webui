"""Tests for scripts/ci/pr_review.py — the fail-closed diff-filtering gate.

Split out of `test_pr_review_orchestration.py` (300-line source guideline):
that file's `TestMainOrchestration` covered both the decision->exit-code
contract and this gate in one 353-line module. This half owns everything
about WHAT reaches the model — truncation, generated-artifact filtering,
and the "nothing left to review" fail-closed cases — sharing `wire()` / ARGV
from `_pr_review_orchestration_wire`. See that module's docstring and
`test_pr_review_orchestration.py`'s docstring for the shared context
(offline suite, vendored from the canonical monorepo).
"""

from __future__ import annotations

import json

import pytest

from _pr_review_orchestration_wire import ARGV, wire
import pr_review  # noqa: E402
from _pr_review_offline import no_real_gh  # noqa: E402,F401


@pytest.mark.usefixtures("no_real_gh")
class TestDiffFilteringGate:

    def test_truncation_fails_closed_needs_human(self, monkeypatch):
        # A partial diff means we did NOT see the whole change, so a large diff
        # must not bypass the gate by size — fail CLOSED even on a partial
        # APPROVE. Rationale in pr_review_diff_filter.MAX_DIFF_CHARS.
        posted = wire(
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
        posted = wire(monkeypatch, review_json=json.dumps({"decision": "approve"}),
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
        posted = wire(monkeypatch, review_json=json.dumps({"decision": "approve"}),
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
        posted = wire(monkeypatch, review_json=json.dumps({"decision": "approve"}), diff="")
        assert pr_review.main(ARGV) == pr_review.EXIT_BLOCK
        assert "messages" not in posted          # the model was never consulted
        assert "no file sections at all" in capsys.readouterr().err

    def test_a_headerless_body_fails_closed(self, monkeypatch, capsys):
        # Same failure from the model's side: a `gh` body that carries no
        # LF-anchored `diff --git` header at all is also "nothing to review".
        posted = wire(monkeypatch, review_json=json.dumps({"decision": "approve"}),
                      diff="warning: something went wrong\nno diff here\n")
        assert pr_review.main(ARGV) == pr_review.EXIT_BLOCK
        assert "messages" not in posted
        assert "no file sections at all" in capsys.readouterr().err

    def test_an_ordinary_pr_with_some_generated_files_still_runs(self, monkeypatch):
        # The fail-closed rule must not swing the other way: a PR that mixes a
        # genuinely generated artifact with real source is reviewed normally —
        # the generated section is dropped and disclosed, the source is sent.
        posted = wire(monkeypatch, review_json=json.dumps({"decision": "approve"}),
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
        posted = wire(monkeypatch, review_json=json.dumps({"decision": "approve"}),
                      diff="diff --git a/server/package-lock.json b/server/package-lock.json\n"
                           "--- a/server/package-lock.json\n+++ b/server/package-lock.json\n"
                           "@@ -1 +1 @@\n-  \"name\": \"safe-pkg\"\n+  \"name\": \"safe-pkq\"\n")
        assert pr_review.main(ARGV) == pr_review.EXIT_OK
        assert "safe-pkq" in posted["messages"][1]["content"], \
            "the lockfile change never reached the model"
        assert "excluded" not in posted["comment"].lower()

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
        posted = wire(
            monkeypatch, diff=big_generated + source,
            review_json=json.dumps(
                {"decision": "approve", "summary": "lgtm", "blocking": [], "comments": []}))
        assert pr_review.main(ARGV) == pr_review.EXIT_OK  # NOT blocked by truncation
        assert "truncat" not in posted["comment"].lower()
        assert "excluded" in posted["comment"].lower()

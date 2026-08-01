"""Tests for scripts/ci/pr_review_gh.py — the `gh`-CLI boundary.

The three wrappers the reviewer has always had (`fetch_pr_diff`,
`post_pr_comment`, `post_pr_review_state`) moved here out of `pr_review.py`
UNCHANGED, so their cases moved here unchanged too — they were
`test_pr_review_script.py::TestGhWrappers` before ADR-117's port. Moving a
function and changing it in the same commit is how a behaviour change hides
inside a refactor, so this module is where that claim is checked.

The three NEW wrappers (`list_pr_reviews`, `fetch_pr_head_sha`,
`dismiss_pr_review`) are ported from the canonical monorepo
(plugins/shipwright-security/tests/test_pr_review_gh.py). Their cases are built
on probes P4 and P6 in ADR-117 — the `--paginate` output shapes and the three
real `PUT …/dismissals` responses — not on reading the API docs.

Canonical's `TestFetchPrDiff` cases about byte-reads and universal-newline
translation are deliberately NOT ported: they pin a later canonical iterate
(the forged-diff-boundary fix) that this repo has not vendored. Porting them
would assert a promise no code here makes.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

CI_DIR = Path(__file__).resolve().parent.parent  # scripts/ci
sys.path.insert(0, str(CI_DIR))

import pr_review_gh as G  # noqa: E402


class _Proc:
    def __init__(self, rc, out="", err=""):
        self.returncode, self.stdout, self.stderr = rc, out, err


# ---------------------------------------------------------------------------
# The three wrappers that MOVED — assertions carried over verbatim
# ---------------------------------------------------------------------------

class TestMovedWrappers:

    def test_fetch_pr_diff_success(self, monkeypatch):
        monkeypatch.setattr(G.subprocess, "run", lambda *a, **k: _Proc(0, "DIFFTEXT"))
        assert G.fetch_pr_diff(1, "o/r") == "DIFFTEXT"

    def test_fetch_pr_diff_failure_raises(self, monkeypatch):
        monkeypatch.setattr(G.subprocess, "run", lambda *a, **k: _Proc(1, "", "no auth"))
        with pytest.raises(RuntimeError):
            G.fetch_pr_diff(1, "o/r")

    def test_post_pr_comment_failure_raises(self, monkeypatch):
        monkeypatch.setattr(G.subprocess, "run", lambda *a, **k: _Proc(1, "", "forbidden"))
        with pytest.raises(RuntimeError):
            G.post_pr_comment(1, "o/r", "body")

    def test_review_state_block_requests_changes(self, monkeypatch):
        captured = {}
        monkeypatch.setattr(G.subprocess, "run",
                            lambda cmd, **k: (captured.update(cmd=cmd), _Proc(0))[1])
        G.post_pr_review_state(1, "o/r", "block", "nope")
        assert "--request-changes" in captured["cmd"]

    def test_review_state_non_block_comments(self, monkeypatch):
        captured = {}
        monkeypatch.setattr(G.subprocess, "run",
                            lambda cmd, **k: (captured.update(cmd=cmd), _Proc(0))[1])
        G.post_pr_review_state(1, "o/r", "approve", "")
        assert "--comment" in captured["cmd"]
        # empty summary must still pass a non-empty body to `gh pr review`
        assert "--body" in captured["cmd"]

    def test_review_state_failure_is_raised_rather_than_discarded(self, monkeypatch):
        # THE ONE disclosed behaviour change in the move, and until the external
        # code review flagged it, the only thing pinning it was a comment.
        #
        # The old wrapper threw the `CompletedProcess` away, so it could not
        # fail — which left `pr_review.py`'s `except` around it dead code. The
        # whole ADR-117 gate now rests on the opposite: `_post_verdict` sets
        # `state_posted = False` from this exception, and that is what stops a
        # run whose review never landed from hunting for an anchor it never
        # posted. The integration test in test_pr_review_stale_verdicts.py
        # monkeypatches `post_pr_review_state` to raise, so it would stay GREEN
        # if this wrapper regressed to discarding the result — the guard has to
        # live here, at the boundary that actually decides.
        monkeypatch.setattr(G.subprocess, "run",
                            lambda *a, **k: _Proc(1, "", "rate limited"))
        with pytest.raises(RuntimeError, match="rate limited"):
            G.post_pr_review_state(1, "o/r", "block", "nope")

    def test_review_state_never_approves(self, monkeypatch):
        # A bot approving its own org's PR would retract a change-request for
        # free — and that is precisely the alternative ADR-117 REJECTED, because
        # `required_approving_review_count` is 0 only for now. The dismissal path
        # exists so this stays false.
        captured = {}
        monkeypatch.setattr(G.subprocess, "run",
                            lambda cmd, **k: (captured.update(cmd=cmd), _Proc(0))[1])
        for decision in ("approve", "comment", "block", ""):
            G.post_pr_review_state(1, "o/r", decision, "body")
            assert "--approve" not in captured["cmd"]


# ---------------------------------------------------------------------------
# list_pr_reviews — the read the whole selection rule stands on
# ---------------------------------------------------------------------------

class TestListReviews:

    def test_it_reads_one_merged_array(self, monkeypatch):
        # gh 2.92 merges the pages itself — measured upstream against PR #446.
        monkeypatch.setattr(G.subprocess, "run",
                            lambda *a, **k: _Proc(0, '[{"id": 1}, {"id": 2}]'))
        assert [r["id"] for r in G.list_pr_reviews(1, "o/r")] == [1, 2]

    def test_it_reads_arrays_concatenated_one_per_page(self, monkeypatch):
        # …and older releases emit one array per page, back to back. Reading
        # only the first would silently see half the PR's review history and,
        # with it, silently leave half the stale verdicts in place.
        monkeypatch.setattr(G.subprocess, "run",
                            lambda *a, **k: _Proc(0, '[{"id": 1}]\n[{"id": 2}]'))
        assert [r["id"] for r in G.list_pr_reviews(1, "o/r")] == [1, 2]

    def test_it_asks_for_every_page(self, monkeypatch):
        captured = {}
        monkeypatch.setattr(G.subprocess, "run",
                            lambda cmd, **k: (captured.update(cmd=cmd), _Proc(0, "[]"))[1])
        G.list_pr_reviews(1, "o/r")
        assert "--paginate" in captured["cmd"]

    def test_a_failure_raises(self, monkeypatch):
        monkeypatch.setattr(G.subprocess, "run", lambda *a, **k: _Proc(1, "", "403"))
        with pytest.raises(RuntimeError, match="403"):
            G.list_pr_reviews(1, "o/r")

    def test_a_zero_exit_body_that_is_not_json_raises(self, monkeypatch):
        # `gh` can exit 0 and still hand back something unparseable. It must
        # raise here so the caller reports "could not read this pull request's
        # reviews" rather than silently reading it as "no reviews", which would
        # look exactly like a clean PR.
        monkeypatch.setattr(G.subprocess, "run", lambda *a, **k: _Proc(0, "not json"))
        with pytest.raises(ValueError):
            G.list_pr_reviews(1, "o/r")

    def test_an_error_object_instead_of_an_array_raises(self, monkeypatch):
        # `gh` exits 0 and hands back `{"message": "Not Found"}`. Returning []
        # here would report a pull request we could not read as one with no
        # reviews — the caller would then say "this run's own review is not
        # visible yet" and the reader would go looking in the wrong place.
        monkeypatch.setattr(G.subprocess, "run",
                            lambda *a, **k: _Proc(0, '{"message": "Not Found"}'))
        with pytest.raises(ValueError, match="array"):
            G.list_pr_reviews(1, "o/r")

    @pytest.mark.parametrize("body", ["", "   ", "\n\t \n"],
                             ids=["empty", "spaces", "whitespace"])
    def test_a_zero_exit_with_no_json_at_all_raises(self, monkeypatch, body):
        # A pull request with no reviews answers `[]`, never nothing. So a
        # zero-exit empty body means `gh` did not tell us what is on the PR —
        # and returning [] would make the caller announce "this run's own review
        # is not visible yet", sending the reader to the wrong place. Divergence
        # from canonical, taken on an external-review finding and filed upstream.
        monkeypatch.setattr(G.subprocess, "run", lambda *a, **k: _Proc(0, body))
        with pytest.raises(ValueError, match="no JSON"):
            G.list_pr_reviews(1, "o/r")

    def test_an_empty_array_is_still_an_empty_list(self, monkeypatch):
        # The other side of the same coin: `[]` is a legitimate answer and must
        # NOT raise, or a genuinely review-less PR would report as unreadable.
        monkeypatch.setattr(G.subprocess, "run", lambda *a, **k: _Proc(0, "[]"))
        assert G.list_pr_reviews(1, "o/r") == []

    def test_a_non_object_entry_is_dropped_rather_than_carried(self, monkeypatch):
        monkeypatch.setattr(G.subprocess, "run",
                            lambda *a, **k: _Proc(0, '[{"id": 1}, "junk", null]'))
        assert [r["id"] for r in G.list_pr_reviews(1, "o/r")] == [1]

    def test_the_body_is_decoded_as_utf8_not_by_locale(self, monkeypatch):
        # Review bodies are model output and always carry non-ASCII (the
        # decision badges). `text=True` decodes with the runner's preferred
        # encoding, so a non-UTF-8 LC_CTYPE would raise here and the cleanup
        # would report "could not read this pull request's reviews" for a
        # reason that has nothing to do with the pull request.
        seen = {}
        monkeypatch.setattr(G.subprocess, "run",
                            lambda cmd, **k: (seen.update(k), _Proc(0, "[]"))[1])
        G.list_pr_reviews(1, "o/r")
        assert seen.get("encoding") == "utf-8"
        assert seen.get("errors") == "replace"


# ---------------------------------------------------------------------------
# fetch_pr_head_sha / dismiss_pr_review
# ---------------------------------------------------------------------------

class TestHeadSha:

    def test_it_returns_the_trimmed_sha(self, monkeypatch):
        monkeypatch.setattr(G.subprocess, "run", lambda *a, **k: _Proc(0, "abc123\n"))
        assert G.fetch_pr_head_sha(1, "o/r") == "abc123"

    def test_a_failure_raises(self, monkeypatch):
        monkeypatch.setattr(G.subprocess, "run", lambda *a, **k: _Proc(1, "", "gone"))
        with pytest.raises(RuntimeError, match="gone"):
            G.fetch_pr_head_sha(1, "o/r")


class TestDismissReview:

    def test_it_sends_a_put_with_the_required_message(self, monkeypatch):
        # Probed live upstream (P6): omitting `message` answers
        # `422 "message" wasn't supplied` BEFORE any other validation, so a
        # wrapper without it would never dismiss anything and the whole feature
        # would sit silently in its best-effort failure path.
        captured = {}
        monkeypatch.setattr(G.subprocess, "run",
                            lambda cmd, **k: (captured.update(cmd=cmd), _Proc(0))[1])
        G.dismiss_pr_review(1, "o/r", 99, "superseded")
        cmd = captured["cmd"]
        assert "--method" in cmd and "PUT" in cmd
        assert "repos/o/r/pulls/1/reviews/99/dismissals" in cmd
        assert "message=superseded" in cmd

    def test_it_does_not_send_the_undocumented_event_field(self, monkeypatch):
        # The same probe showed `event=DISMISS` is accepted but changes nothing.
        # Not part of the documented request, so not sent.
        captured = {}
        monkeypatch.setattr(G.subprocess, "run",
                            lambda cmd, **k: (captured.update(cmd=cmd), _Proc(0))[1])
        G.dismiss_pr_review(1, "o/r", 99, "superseded")
        assert not any("event=" in str(part) for part in captured["cmd"])

    def test_a_failure_raises(self, monkeypatch):
        monkeypatch.setattr(G.subprocess, "run",
                            lambda *a, **k: _Proc(1, "", "Validation Failed"))
        with pytest.raises(RuntimeError, match="Validation Failed"):
            G.dismiss_pr_review(1, "o/r", 99, "superseded")

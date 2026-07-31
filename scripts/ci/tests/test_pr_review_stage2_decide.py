"""Stage 2 decides correctly — executed, not string-matched.

Local addition, no upstream counterpart. Covers the two steps that decide WHAT
gets reviewed: resolving the pull request from the trusted event, and the tier
rules. The verdict half lives in ``test_pr_review_stage2_verdict.py``; the
harness in ``_pr_review_shell.py``.

The vendored shape/trust modules prove the workflow *says* the right things;
nothing proved it *does* them. Every finding external review raised against
this port was behavioural — pagination, waiver ordering, what happens to a file
list bigger than a pipe buffer — and a string match cannot answer any of them.
Each test lifts a ``run:`` body straight out of `pr-review-run.yml` and runs it
in bash with a fake `gh` on PATH, so the code under test is the shipped code.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pr_review_shell import (  # noqa: E402
    HEAD,
    OTHER,
    REPO,
    pages,
    pr,
    requires_shell,
    run,
    step_body,
)

_RESOLVE_ENV = {"REPO": REPO, "HEAD_SHA": HEAD, "GH_TOKEN": "x"}
_TIER_ENV = {"REPO": REPO, "PR_NUMBER": "7", "GH_TOKEN": "x"}


# ---------------------------------------------------------------------------
# Resolving the pull request — ambiguity fails closed, across page boundaries
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "page_list, expect_rc, expect_number",
    [
        pytest.param([[pr(7)]], 0, "7", id="single-match"),
        pytest.param([[pr(7)], [pr(9)]], 1, None, id="two-matches-across-pages"),
        pytest.param([[], []], 1, None, id="no-match"),
        pytest.param([[pr(7, sha=OTHER)]], 1, None, id="head-is-not-this-sha"),
        pytest.param([[pr(7, state="closed")]], 1, None, id="closed-pr-does-not-count"),
        pytest.param([[pr(7)], [pr(9, sha=OTHER)]], 0, "7", id="page-2-non-match-ignored"),
        pytest.param([[pr(7, sha=OTHER)], [pr(9)]], 0, "9", id="match-only-on-page-2"),
        # The case `commits/{sha}/pulls` cannot resolve AT ALL, and the
        # reason this step lists the base repo's open PRs instead.
        pytest.param([[pr(7, fork=True)]], 0, "7", id="fork-pr-resolves"),
    ],
)
def test_resolve_pull_request(tmp_path, page_list, expect_rc, expect_number):
    """One commit can belong to several open PRs; picking one would let stage 2
    review PR A and post a green status onto a SHA that satisfies PR B's gate.

    ``two-matches-across-pages`` and ``match-only-on-page-2`` are the cases that
    motivated ``--paginate --slurp``: reading page 1 alone, the first looks
    unambiguous and the second looks like no match at all.
    """
    requires_shell()
    rc, out, console, _ = run(
        step_body("pr"), tmp_path, _RESOLVE_ENV, open_pulls__json=pages(*page_list)
    )
    assert rc == expect_rc, f"rc={rc} console={console}"
    if expect_number is None:
        assert "number" not in out, "must not emit a PR number when refusing"
        assert "refusing to post a verdict" in console
    else:
        assert out.get("number") == expect_number


def test_harness_rejects_a_dropped_flag(tmp_path):
    """The stub asserts its own contract, so the suite is not flag-blind.

    Without this the behaviour tests would pass on a workflow that dropped
    `--slurp`, while the real `gh` emits a flat array that `.[][]` cannot walk
    — the coverage would rest entirely on a string match in another module,
    which is exactly what this harness exists to replace.
    """
    requires_shell()
    body = step_body("pr").replace("--paginate --slurp", "--paginate")
    rc, _, console, _ = run(
        body, tmp_path, _RESOLVE_ENV, open_pulls__json=pages([pr(7)])
    )
    assert rc != 0, "a dropped --slurp must fail a behaviour test, not pass one"
    assert "--paginate --slurp" in console


# ---------------------------------------------------------------------------
# The tier decision — waiver ordering, sensitive paths, author
# ---------------------------------------------------------------------------


def _tier(tmp_path, files, author="svroch", labels=()):
    return run(
        step_body("tier"),
        tmp_path,
        _TIER_ENV,
        pr__json=json.dumps(
            {"user": {"login": author}, "labels": [{"name": n} for n in labels]}
        ),
        files__txt="\n".join(files) + "\n",
    )


@pytest.mark.parametrize(
    "author, labels, files, needs_review, reason_contains",
    [
        ("svroch", [], ["client/src/App.tsx"], "false", "internal PR"),
        ("dependabot[bot]", [], ["package.json"], "false", "internal PR"),
        ("outsider", [], ["README.md"], "true", "external contributor"),
        ("svroch", [], [".github/workflows/ci.yml"], "true", "sensitive path"),
        ("svroch", [], ["scripts/ci/pr_review.py"], "true", "sensitive path"),
        ("svroch", [], ["scripts/hooks/pre-commit"], "true", "sensitive path"),
        ("svroch", [], [".github/actions/setup/action.yml"], "true", "sensitive path"),
        # The suppression channels: changing what CI is allowed to stay quiet
        # about is changing the checks (DO-NOT #25).
        ("svroch", [], [".trivyignore.yaml"], "true", "sensitive path"),
        ("svroch", [], ["shipwright_accepted_risks.yaml"], "true", "sensitive path"),
        ("svroch", [], [".semgrepignore"], "true", "sensitive path"),
        ("svroch", [], [".claude/settings.json"], "true", "sensitive path"),
        ("svroch", [], ["scripts/install-hooks.ps1"], "true", "sensitive path"),
        ("svroch", [], ["shipwright_bloat_baseline.json"], "true", "sensitive path"),
        ("svroch", ["needs-review"], ["README.md"], "true", "needs-review label"),
        ("svroch", ["skip-pr-review"], ["README.md"], "false", "skip-pr-review label"),
        # The self-exemption rule: a waiver cannot cover a change to the checks.
        ("svroch", ["skip-pr-review"], [".github/workflows/ci.yml"], "true", "sensitive path"),
        ("svroch", ["skip-pr-review"], [".trivyignore.yaml"], "true", "sensitive path"),
        ("outsider", ["skip-pr-review"], ["scripts/ci/x.py"], "true", "sensitive path"),
        # A sensitive path is still sensitive when it is not the first file.
        ("svroch", [], ["README.md", "docs/a.md", "scripts/hooks/pre-push"],
         "true", "sensitive path"),
        # ...and a path that merely CONTAINS a sensitive segment is not one:
        # the rule is anchored at the start of the path.
        ("svroch", [], ["docs/.github/workflows/example.yml"], "false", "internal PR"),
        # `.gitattributes` decides what the reviewer can SEE (`* -diff`
        # renders a diff as "Binary files differ"), so it is policy too.
        ("svroch", [], [".gitattributes"], "true", "sensitive path"),
    ],
)
def test_tier_decision(tmp_path, author, labels, files, needs_review, reason_contains):
    requires_shell()
    rc, out, console, _ = _tier(tmp_path, files, author=author, labels=labels)
    assert rc == 0, f"rc={rc} console={console}"
    assert out.get("needs_review") == needs_review, f"reason={out.get('reason')!r}"
    assert reason_contains in out.get("reason", "")


def test_tier_survives_a_file_list_larger_than_the_pipe_buffer(tmp_path):
    """`printf | grep -q` fails OPEN above 64 KiB, which is why it is not used.

    `grep -q` exits at the first match; the writer then takes SIGPIPE, and
    under `pipefail` the pipeline reports non-zero even though grep matched —
    so the sensitive-path branch is skipped and a workflow edit classifies as
    Tier 1/2. The here-string has no writer to kill. ~2000 paths at ~50 bytes
    is comfortably past the buffer, with the match FIRST so `grep -q` exits
    immediately: the worst case for the old form.
    """
    requires_shell()
    files = [".github/workflows/ci.yml"] + [
        f"client/src/generated/module-{i:05d}/component-{i:05d}.tsx" for i in range(2000)
    ]
    rc, out, console, _ = _tier(tmp_path, files)
    assert rc == 0, console
    assert out.get("needs_review") == "true", (
        "a workflow edit must stay Tier 3 no matter how many other files ride along"
    )
    assert "sensitive path" in out.get("reason", "")


def test_tier_treats_a_truncated_file_list_as_sensitive(tmp_path):
    """`pulls/{n}/files` caps at 3000 entries however it is paginated.

    At the cap "no sensitive path found" only means "none in the part we were
    shown", so unknown must resolve to sensitive rather than to a skipped
    review.
    """
    requires_shell()
    rc, out, console, _ = _tier(tmp_path, [f"docs/page-{i:05d}.md" for i in range(3000)])
    assert rc == 0, console
    assert out.get("needs_review") == "true"


@pytest.mark.parametrize("label", ["needs-review", "skip-pr-review"])
def test_tier_reason_round_trips_through_the_output_file(tmp_path, label):
    """`reason` uses the heredoc form; it must still read back as one line."""
    requires_shell()
    rc, out, console, _ = _tier(tmp_path, ["README.md"], labels=[label])
    assert rc == 0, console
    assert label in out.get("reason", "")
    assert "\n" not in out.get("reason", "")


def test_tier_sees_a_rename_out_of_a_sensitive_directory(tmp_path):
    """`filename` alone is rename-blind, and a rename OUT is the dangerous one.

    The API emits ONE entry per renamed file, carrying the NEW path in
    `filename` and the old one in `previous_filename`. Moving
    `scripts/hooks/pre-commit` to `tools/pre-commit` therefore presents only a
    non-sensitive path — the executed hook leaves the guarded directory without
    the tier ever seeing it. The `--jq` asks for both, which the stub enforces.
    """
    requires_shell()
    rc, out, console, _ = _tier(tmp_path, ["tools/pre-commit", "scripts/hooks/pre-commit"])
    assert rc == 0, console
    assert out.get("needs_review") == "true"
    assert "sensitive path" in out.get("reason", "")

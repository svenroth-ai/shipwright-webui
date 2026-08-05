"""Tests for `filter_generated_paths` — dropping generated sections from a diff.

The MECHANISM: which file sections leave the reviewed diff, that a section is
dropped only when EVERY path it touches is generated (so a rename moving real
source into a generated directory is never silently hidden), and that the whole
point still holds — a diff that would truncate fits once the generated noise is
gone, so the review runs instead of failing closed.

The membership POLICY it consumes is pinned in test_pr_review_generated.py; the
adversarial half — a PR forging a file boundary inside its own diff — in
test_pr_review_forged_boundary.py. Both splits keep each module under the
source-size guideline and mirror the source layout.

Vendored from the canonical monorepo (plugins/shipwright-security/tests/
test_pr_review_filter.py); fixtures re-pointed to the WebUI tree.
"""

from __future__ import annotations

import sys
from pathlib import Path

CI_DIR = Path(__file__).resolve().parent.parent  # scripts/ci
REPO_ROOT = CI_DIR.parent.parent
sys.path.insert(0, str(CI_DIR))

import pr_review_lib as L  # noqa: E402


def _section(path: str, body: str = "@@ -1 +1 @@\n-old\n+new\n") -> str:
    return f"diff --git a/{path} b/{path}\nindex 111..222 100644\n--- a/{path}\n+++ b/{path}\n{body}"


class TestFilterGeneratedPaths:
    def test_drops_generated_keeps_source(self):
        diff = (
            _section("server/src/core/launcher.ts")
            + _section(".shipwright/compliance/dashboard.md")
            + _section(".shipwright/triage.jsonl")
            + _section("client/src/pages/Board.tsx")
        )
        filtered, excluded = L.filter_generated_paths(diff)
        assert "server/src/core/launcher.ts" in filtered
        assert "client/src/pages/Board.tsx" in filtered
        assert ".shipwright/compliance/dashboard.md" not in filtered
        assert excluded == [".shipwright/compliance/dashboard.md",
                            ".shipwright/triage.jsonl"]

    def test_all_source_unchanged(self):
        diff = _section("server/x.ts") + _section("client/y.tsx")
        filtered, excluded = L.filter_generated_paths(diff)
        assert filtered == diff
        assert excluded == []

    def test_no_headers_returned_unchanged(self):
        # A diff with no `diff --git` headers (unexpected) is passed through.
        diff = "not a diff at all\njust text\n"
        filtered, excluded = L.filter_generated_paths(diff)
        assert filtered == diff
        assert excluded == []

    def test_excluded_is_sorted_and_deduped(self):
        # Two sections touching the SAME generated path must report it once, and
        # the unfiltered lockfile must not appear at all.
        diff = (_section("server/package-lock.json") + _section(".shipwright/triage.jsonl")
                + _section(".shipwright/compliance/x.md") + _section(".shipwright/triage.jsonl"))
        _, excluded = L.filter_generated_paths(diff)
        assert excluded == [".shipwright/compliance/x.md", ".shipwright/triage.jsonl"]

    def test_deleted_generated_file_excluded(self):
        # A deletion has `+++ /dev/null`; path must resolve from the `--- a/` side.
        diff = (
            "diff --git a/.shipwright/triage.jsonl b/.shipwright/triage.jsonl\n"
            "deleted file mode 100644\n"
            "index 111..000\n"
            "--- a/.shipwright/triage.jsonl\n"
            "+++ /dev/null\n"
            "@@ -1 +0,0 @@\n-gone\n"
        ) + _section("keep/me.ts")
        filtered, excluded = L.filter_generated_paths(diff)
        assert excluded == [".shipwright/triage.jsonl"]
        assert "keep/me.ts" in filtered

    def test_new_generated_file_excluded(self):
        # An addition has `--- /dev/null`; path resolves from the `+++ b/` side.
        diff = (
            "diff --git a/CHANGELOG-unreleased.d/Added/x_001.md b/CHANGELOG-unreleased.d/Added/x_001.md\n"
            "new file mode 100644\n"
            "index 000..111\n"
            "--- /dev/null\n"
            "+++ b/CHANGELOG-unreleased.d/Added/x_001.md\n"
            "@@ -0,0 +1 @@\n+added\n"
        )
        filtered, excluded = L.filter_generated_paths(diff)
        assert excluded == ["CHANGELOG-unreleased.d/Added/x_001.md"]
        assert filtered.strip() == ""  # everything excluded

    def test_rename_real_source_into_generated_dir_is_kept(self):
        # A rename that MOVES real source into a generated dir must NOT be
        # silently dropped — the real code (and the suspicious move itself) must
        # stay reviewable. Exclude only when EVERY touched path is generated.
        diff = (
            "diff --git a/server/src/real.ts b/.shipwright/compliance/real.ts\n"
            "similarity index 100%\n"
            "rename from server/src/real.ts\n"
            "rename to .shipwright/compliance/real.ts\n"
        )
        filtered, excluded = L.filter_generated_paths(diff)
        assert filtered == diff       # kept in full
        assert excluded == []         # real source side wins

    def test_rename_generated_to_generated_still_excluded(self):
        # A rename where BOTH ends are generated carries no reviewable logic.
        diff = (
            "diff --git a/.shipwright/compliance/old.md b/.shipwright/compliance/new.md\n"
            "similarity index 100%\n"
            "rename from .shipwright/compliance/old.md\n"
            "rename to .shipwright/compliance/new.md\n"
        )
        _, excluded = L.filter_generated_paths(diff)
        assert excluded == [".shipwright/compliance/new.md", ".shipwright/compliance/old.md"]

    def test_filtering_lets_a_big_diff_fit_under_cap(self):
        # The whole point: a diff that WOULD truncate fits once generated noise
        # is dropped, so the review runs instead of failing closed.
        # The fixture is sized FROM the cap: hard-coding a line count silently
        # stops exercising the over-cap path the day the cap is raised.
        filler = "+x\n" * ((L.MAX_DIFF_CHARS // 3) + 1_000)
        big_generated = _section(
            ".shipwright/compliance/test-evidence.md", body="@@ -1 +1 @@\n" + filler)
        small_source = _section("server/src/real.ts")
        diff = big_generated + small_source
        assert len(diff) > L.MAX_DIFF_CHARS
        filtered, excluded = L.filter_generated_paths(diff)
        assert len(filtered) < L.MAX_DIFF_CHARS
        assert L.truncate_diff(filtered).incomplete is False
        assert excluded == [".shipwright/compliance/test-evidence.md"]

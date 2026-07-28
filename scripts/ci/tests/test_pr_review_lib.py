"""Tests for scripts/ci/pr_review_lib.py — the pure (I/O-free) core.

Redaction, prompt loading, strict-JSON parsing and the decision → exit-code
mapping. The other concerns each moved to the module that owns them, and the
test modules followed:

  * the template fill + the shipped prompt  → test_pr_review_prompt_template.py
  * `safe_path`                             → test_pr_review_safe_path.py
  * the two render sinks                    → test_pr_review_render.py
  * boundary truncation                     → test_pr_review_truncation.py
  * membership policy / section filtering    → test_pr_review_{generated,filter}.py
  * the forged-boundary attack               → test_pr_review_forged_boundary.py
  * the `gh` and OpenRouter boundaries       → test_pr_review_{gh,openrouter}.py
  * tool orchestration                       → test_pr_review_script.py

Vendored from the canonical monorepo (plugins/shipwright-security/tests/
test_pr_review_lib.py); paths re-pointed to the WebUI's flat `scripts/ci/` layout.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

CI_DIR = Path(__file__).resolve().parent.parent  # scripts/ci
sys.path.insert(0, str(CI_DIR))

import pr_review_lib as L  # noqa: E402

# Deliberately NOT in any real credential format (no `sk-`/`ghp_`/`xox` prefix) so the
# repo's secret-scan hooks don't flag this synthetic fixture. Redaction is format-agnostic.
FAKE_KEY = "ORTESTKEY-not-a-real-credential-0123456789"


class TestRedaction:

    def test_redact_masks_secret(self):
        out = L._redact(f"Authorization: Bearer {FAKE_KEY} done", FAKE_KEY)
        assert FAKE_KEY not in out
        assert "REDACTED" in out

    def test_redact_handles_none_secret(self):
        assert L._redact("hello", None) == "hello"
        assert L._redact("hello", "") == "hello"

    def test_redact_multiple_secrets(self):
        second = "SECONDFAKE-token-value-abc"
        out = L._redact(f"{FAKE_KEY} and {second}", FAKE_KEY, second)
        assert FAKE_KEY not in out
        assert second not in out


class TestDecisionToExit:

    def test_approve_is_zero(self):
        assert L.decision_to_exit("approve") == L.EXIT_OK == 0

    def test_comment_is_zero(self):
        assert L.decision_to_exit("comment") == 0

    def test_block_is_one(self):
        assert L.decision_to_exit("block") == L.EXIT_BLOCK == 1

    def test_unknown_decision_is_error(self):
        assert L.decision_to_exit("definitely-not-a-decision") == L.EXIT_ERROR == 2

    def test_case_insensitive(self):
        assert L.decision_to_exit("BLOCK") == 1
        assert L.decision_to_exit("Approve") == 0

    def test_non_string_decision_is_error_not_crash(self):
        # A model returning a non-string decision must map to exit 2, not raise.
        assert L.decision_to_exit(["block"]) == 2
        assert L.decision_to_exit(None) == 2


class TestParseResponse:

    def test_valid_json(self):
        raw = json.dumps({"decision": "block", "summary": "bad", "blocking": ["x"], "comments": []})
        review = L.parse_review_response(raw)
        assert review["decision"] == "block"
        assert review["blocking"] == ["x"]

    def test_json_object_in_markdown_fence(self):
        # OpenRouter -> Anthropic ignores response_format and fences the JSON.
        # Verified live on a B4.5 Tier-3 smoke test (exit 2 instead of the real decision).
        obj = {"decision": "block", "summary": "s", "blocking": ["b"], "comments": []}
        raw = "```json\n" + json.dumps(obj, indent=2) + "\n```"
        review = L.parse_review_response(raw)
        assert review["decision"] == "block"
        assert review["blocking"] == ["b"]

    def test_json_object_in_bare_fence(self):
        raw = "```\n" + json.dumps({"decision": "approve", "summary": "ok"}) + "\n```"
        assert L.parse_review_response(raw)["decision"] == "approve"

    def test_json_object_with_surrounding_prose(self):
        raw = 'Here is my review:\n{"decision": "comment", "summary": "nit"}\nThanks!'
        assert L.parse_review_response(raw)["decision"] == "comment"

    def test_invalid_json_raises(self):
        with pytest.raises(ValueError):
            L.parse_review_response("this is not json")

    def test_missing_decision_raises(self):
        with pytest.raises(ValueError):
            L.parse_review_response(json.dumps({"summary": "no decision"}))

    def test_non_object_raises(self):
        with pytest.raises(ValueError):
            L.parse_review_response(json.dumps(["a", "list"]))


class TestPromptLoading:

    def test_load_prompts_reads_both_files(self, tmp_path):
        (tmp_path / "system").write_text("SYS-PROMPT", encoding="utf-8")
        (tmp_path / "user").write_text("USER {PR_META} {DIFF}", encoding="utf-8")
        system, user = L.load_prompts(str(tmp_path))
        assert system == "SYS-PROMPT"
        assert "{DIFF}" in user and "{PR_META}" in user

    def test_load_prompts_missing_raises(self, tmp_path):
        with pytest.raises(OSError):
            L.load_prompts(str(tmp_path))  # no system/user files

    def test_build_messages_fills_placeholders(self):
        msgs = L.build_messages("SYS", "U {PR_META} :: {DIFF}", "DD", "MM")
        assert msgs[0] == {"role": "system", "content": "SYS"}
        assert "MM" in msgs[1]["content"] and "DD" in msgs[1]["content"]


class TestTruncateDiffFacade:
    """`truncate_diff` returns a RECORD, not the old `(str, bool)` tuple.

    Positional unpacking used to work and now fails loudly — which is the point:
    a caller that binds `out, truncated = truncate_diff(...)` would otherwise
    have silently read `.text` into one name and `.incomplete` into the other as
    the contract grew. The cutting behaviour itself is pinned in
    test_pr_review_truncation.py.
    """

    def test_short_diff_unchanged(self):
        diff = "diff --git a/a.ts b/a.ts\n+small change\n"
        out = L.truncate_diff(diff)
        assert out.text == diff
        assert out.incomplete is False

    def test_the_old_two_tuple_unpacking_is_gone(self):
        with pytest.raises(TypeError):
            _out, _truncated = L.truncate_diff("diff --git a/a.ts b/a.ts\n+x\n")

    def test_the_default_cap_is_the_module_constant(self):
        assert L.truncate_diff("x" * (L.MAX_DIFF_CHARS + 1)).incomplete is True
        assert L.truncate_diff("x" * L.MAX_DIFF_CHARS).incomplete is False

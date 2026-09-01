"""Tests for scripts/ci/pr_review.py — the file/shebang/re-export contract.

The `main()` orchestration tests live in `test_pr_review_orchestration.py`
(split out 2026-08-05 to stay inside the 300-line source guideline — merging
the canonical-parity and ADR-117 iterates' test suites for this module pushed
it to 343 lines). This module keeps the checks that are about the FILE itself
rather than about running it: the shebang, the credential-provider guard, the
`pr_review.<symbol>` re-export surface every monkeypatching test relies on, and
the reviewer family's own 300-line guideline.

Vendored from the canonical monorepo (plugins/shipwright-security/tests/
test_pr_review_script.py); paths re-pointed to the WebUI's flat `scripts/ci/`
layout.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

CI_DIR = Path(__file__).resolve().parent.parent  # scripts/ci
sys.path.insert(0, str(CI_DIR))

import pr_review  # noqa: E402

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

    def test_default_model_is_glm(self):
        assert pr_review.DEFAULT_MODEL == pr_review.GLM_MODEL == "z-ai/glm-5.3"

    def test_deepseek_model_constant_still_exists_for_the_operator_override(self):
        assert pr_review.DEEPSEEK_MODEL == "deepseek/deepseek-v4-pro"

    def test_every_re_exported_name_resolves(self):
        # The lib modules are reachable through `pr_review.<symbol>` — that is
        # the contract the workflow and every monkeypatching test rely on, and
        # a module split is exactly what silently breaks it.
        for name in pr_review.__all__:
            assert hasattr(pr_review, name), f"__all__ names {name}, which does not resolve"

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

"""Snapshot test for .github/workflows/pr-review.yml invariants (WebUI Tier-3).

Text-regex based (no PyYAML dep) — guards the tier contract that Branch
Protection relies on: the required status check is the `PR Review` job, the
tier filter lives in a `decide` job, and only Tier-3 PRs reach the OpenRouter
custom script. A drift here could silently auto-merge an unreviewed external or
sensitive-path PR.

Vendored from the canonical monorepo (plugins/shipwright-security/tests/
test_pr_review_workflow_shape.py); assertions re-pointed to the WebUI's vendored
script path + sensitive-path surface. Also pins the B4.5 migration itself: no
`@anthropic-ai/claude-code` package, no `ANTHROPIC_API_KEY`, no dead `develop`
trigger branch, and a `selftest` job that runs the vendored suite.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

# scripts/ci/tests/test_*.py → parents[3] is the repo root.
REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "pr-review.yml"


@pytest.fixture(scope="module")
def workflow_text() -> str:
    assert WORKFLOW_PATH.exists(), f"missing workflow: {WORKFLOW_PATH}"
    return WORKFLOW_PATH.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Trigger + concurrency
# ---------------------------------------------------------------------------

class TestTriggers:

    def test_pull_request_trigger_active(self, workflow_text):
        active = any(
            line.lstrip().startswith("pull_request:") and not line.lstrip().startswith("#")
            for line in workflow_text.splitlines()
        )
        assert active, "pr-review.yml must run on pull_request"

    def test_labeled_event_type_present(self, workflow_text):
        # A `needs-review` / `skip-pr-review` label added AFTER open must re-trigger.
        assert "labeled" in workflow_text, "workflow must trigger on the 'labeled' event type"

    def test_trigger_branch_is_main_only(self, workflow_text):
        # B4.5 migration: the old claude-review.yml triggered on [main, develop];
        # `develop` does not exist in this repo. The new workflow targets main only.
        assert "branches: [main]" in workflow_text, "pull_request must target [main]"
        assert "develop" not in workflow_text, "dead `develop` trigger branch must be gone"


# ---------------------------------------------------------------------------
# Migration invariants — the whole point of this iterate
# ---------------------------------------------------------------------------

class TestMigratedAwayFromAnthropicDirect:

    def test_no_anthropic_claude_code_package(self, workflow_text):
        assert "@anthropic-ai/claude-code" not in workflow_text, (
            "must not install the @anthropic-ai/claude-code package — OpenRouter custom script only"
        )

    def test_no_third_party_claude_action(self, workflow_text):
        assert "anthropics/claude-code-action" not in workflow_text, (
            "must NOT use a 3rd-party Claude action (B4.5 OpenRouter decision)"
        )


# ---------------------------------------------------------------------------
# Fork-PR guard + decide-job tier logic
# ---------------------------------------------------------------------------

class TestDecideJob:

    def test_fork_pr_guard_present(self, workflow_text):
        assert (
            "github.event.pull_request.head.repo.full_name == github.repository"
            in workflow_text
        ), "fork-PR guard (head.repo.full_name == github.repository) missing"

    def test_skip_label_rule(self, workflow_text):
        assert "skip-pr-review" in workflow_text, "skip-pr-review label override missing"

    def test_needs_review_label_rule(self, workflow_text):
        assert "needs-review" in workflow_text, "needs-review label override missing"

    def test_sensitive_paths_rule(self, workflow_text):
        # The decide job must classify the WebUI's supply-chain surface as sensitive:
        # CI workflows, executed git hooks, and the vendored reviewer itself.
        assert ".github/workflows/" in workflow_text, \
            "sensitive-path tier rule (.github/workflows/) missing"
        assert "scripts/hooks/" in workflow_text, \
            "sensitive-path tier rule (scripts/hooks/) missing"
        assert "scripts/ci/" in workflow_text, \
            "sensitive-path tier rule (scripts/ci/) missing"

    def test_external_author_rule(self, workflow_text):
        # External = not Sven and not dependabot.
        assert "svroch" in workflow_text, "external-author tier rule must reference the maintainer login"
        assert re.search(r"needs_review=true", workflow_text), \
            "decide job must be able to emit needs_review=true"


# ---------------------------------------------------------------------------
# Review job — required check name + gating
# ---------------------------------------------------------------------------

class TestReviewJob:

    def test_job_name_is_pr_review(self, workflow_text):
        # Branch Protection's required check matches the job NAME exactly.
        assert re.search(r"^\s*name:\s*PR Review\s*$", workflow_text, re.MULTILINE), \
            "review job name must be exactly 'PR Review' (Branch-Protection required check)"

    def test_needs_decide_with_gate(self, workflow_text):
        assert re.search(r"^\s*needs:\s*decide\b", workflow_text, re.MULTILINE), \
            "review job must declare `needs: decide`"
        assert "needs.decide.outputs.needs_review == 'true'" in workflow_text, \
            "review job must gate on needs.decide.outputs.needs_review == 'true'"

    def test_calls_custom_script_not_third_party_action(self, workflow_text):
        assert "scripts/ci/pr_review.py" in workflow_text, \
            "review job must invoke the vendored pr_review.py script"


# ---------------------------------------------------------------------------
# Selftest job — the vendored copy must verify itself in CI
# ---------------------------------------------------------------------------

class TestSelftestJob:

    def test_selftest_runs_vendored_suite(self, workflow_text):
        assert "scripts/ci/tests" in workflow_text, \
            "a selftest job must run the vendored pytest suite (scripts/ci/tests)"
        assert "pytest" in workflow_text, "selftest job must invoke pytest"


# ---------------------------------------------------------------------------
# Secrets + provider invariants
# ---------------------------------------------------------------------------

class TestSecrets:

    def test_openrouter_secret_used(self, workflow_text):
        assert "secrets.OPENROUTER_API_KEY" in workflow_text, \
            "review job must read OPENROUTER_API_KEY from secrets"

    def test_no_anthropic_key(self, workflow_text):
        assert "ANTHROPIC_API_KEY" not in workflow_text, \
            "OpenRouter is the single provider — no ANTHROPIC_API_KEY"

    def test_no_literal_key(self, workflow_text):
        # No hardcoded OpenRouter/sk- key literal — must come from secrets.
        assert not re.search(r"sk-or-v1-[A-Za-z0-9]{8,}", workflow_text), \
            "hardcoded OpenRouter key literal found — use secrets.OPENROUTER_API_KEY"

    def test_model_env_override(self, workflow_text):
        assert "SHIPWRIGHT_PR_REVIEW_MODEL" in workflow_text, \
            "model must be selectable via SHIPWRIGHT_PR_REVIEW_MODEL env"


# ---------------------------------------------------------------------------
# Supply-chain + injection hardening (this PR is itself security-scanned)
# ---------------------------------------------------------------------------

class TestHardening:

    def test_third_party_actions_sha_pinned(self, workflow_text):
        # Any action NOT in the GitHub first-party `actions/` org is third-party
        # and MUST be pinned to a 40-char commit SHA (supply-chain hardening).
        for m in re.finditer(r"uses:\s*(\S+)", workflow_text):
            ref = m.group(1)
            if ref.startswith("actions/"):
                continue  # first-party — conventional tag pin is allowed
            _, _, version = ref.partition("@")
            assert re.fullmatch(r"[0-9a-f]{40}", version), \
                f"third-party action {ref!r} must be SHA-pinned"

    def test_no_direct_github_context_in_run_body(self, workflow_text):
        # run-shell-injection guard: never interpolate ${{ github.* }} directly
        # inside a `run:` shell body — hoist into env first. Tracks the run-block
        # by indentation so the legitimate `${{ github.* }}` in `env:` blocks is
        # not flagged (only deeper-indented run-block lines count).
        offenders = []
        run_indent = None
        for line in workflow_text.splitlines():
            if not line.strip():
                continue
            indent = len(line) - len(line.lstrip())
            if run_indent is not None:
                if indent > run_indent:
                    if "${{ github." in line:
                        offenders.append(line.strip())
                    continue
                run_indent = None  # block ended (dedent to <= run: indent)
            stripped = line.strip()
            if stripped.startswith("run:"):
                if "${{ github." in line:  # inline run on the same line
                    offenders.append(stripped)
                if stripped in ("run: |", "run: >") or stripped.startswith(("run: |", "run: >")):
                    run_indent = indent
        assert not offenders, f"raw ${{{{ github.* }}}} in run body (injection risk): {offenders}"

"""Snapshot test for the two-stage Tier-3 PR review workflows (WebUI).

Text-regex based (**no PyYAML dep**) and deliberately kept that way: it guards
the shape even if the selftest job's dependency set ever shrinks again.

**The shape changed in iterate-2026-07-31-two-stage-pr-review**, porting
shipwright#437. It used to be one workflow whose `PR Review` JOB was the
required check, guarded by ``head.repo.full_name == github.repository`` so it
never ran on a fork. That guard was the hole: a guarded job is SKIPPED on fork
PRs, `review` was skipped through ``needs:``, and GitHub scores a skipped job
as a **successful** required check — so a fork PR satisfied the gate having
been reviewed by nobody.

Now:
  * stage 1 (`pr-review.yml`) runs on every PR including forks, holds NO
    secret, carries NO policy, and uploads the diff as an audit artifact;
  * stage 2 (`pr-review-run.yml`) is triggered by stage 1 completing, holds the
    credentials, never checks out the PR head, and posts the required
    ``PR Review`` context as a COMMIT STATUS.

**Division of labour.** The trust and fail-closed invariants that the whole
family shares live in the modules vendored verbatim from the monorepo —
``test_pr_review_fail_closed.py`` and ``test_pr_review_fork_trust.py`` — which
read PARSED structure (``if:`` expressions, comment-stripped ``run:`` bodies)
because these workflows document the holes they close and a raw-text match
would hit the explanatory comment. This module deliberately does NOT restate
them; it keeps only what is local to this repo (script paths, the sensitive-path
surface, the `Reviewer Selftest` job name the ruleset requires by exact string)
plus the stdlib-only trigger/provider/hardening checks.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

# scripts/ci/tests/test_*.py → parents[3] is the repo root.
REPO_ROOT = Path(__file__).resolve().parents[3]
CI_DIR = REPO_ROOT / "scripts" / "ci"
STAGE1_PATH = REPO_ROOT / ".github" / "workflows" / "pr-review.yml"
STAGE2_PATH = REPO_ROOT / ".github" / "workflows" / "pr-review-run.yml"


def _read(path: Path) -> str:
    assert path.exists(), f"missing workflow: {path}"
    return path.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def stage1() -> str:
    return _read(STAGE1_PATH)


@pytest.fixture(scope="module")
def stage2() -> str:
    return _read(STAGE2_PATH)


@pytest.fixture(scope="module")
def both() -> str:
    return _read(STAGE1_PATH) + "\n" + _read(STAGE2_PATH)


# ---------------------------------------------------------------------------
# Triggers
# ---------------------------------------------------------------------------

class TestTriggers:

    def test_pull_request_trigger_active(self, stage1):
        active = any(
            line.lstrip().startswith("pull_request:") and not line.lstrip().startswith("#")
            for line in stage1.splitlines()
        )
        assert active, "stage 1 must run on pull_request"

    def test_label_event_types_present(self, stage1):
        # A `needs-review` / `skip-pr-review` label added AFTER open must
        # re-trigger — and so must its REMOVAL, or a waiver can never be
        # revoked. Parsed assertion: test_pr_review_fail_closed.
        assert "labeled" in stage1, "workflow must trigger on the 'labeled' event type"
        assert "unlabeled" in stage1, "workflow must trigger on the 'unlabeled' event type"

    def test_trigger_branch_is_main_only(self, stage1):
        # B4.5 migration: the old claude-review.yml triggered on [main, develop];
        # `develop` does not exist in this repo.
        assert "branches: [main]" in stage1, "pull_request must target [main]"
        assert "develop" not in stage1, "dead `develop` trigger branch must be gone"


# ---------------------------------------------------------------------------
# Migration invariants — B4.5 OpenRouter decision
# ---------------------------------------------------------------------------

class TestMigratedAwayFromAnthropicDirect:

    def test_no_anthropic_claude_code_package(self, both):
        assert "@anthropic-ai/claude-code" not in both, (
            "must not install the @anthropic-ai/claude-code package — "
            "OpenRouter custom script only"
        )

    def test_no_third_party_claude_action(self, both):
        assert "anthropics/claude-code-action" not in both, (
            "must NOT use a 3rd-party Claude action (B4.5 OpenRouter decision)"
        )


# ---------------------------------------------------------------------------
# Stage 1 — the parts local to this repo
# ---------------------------------------------------------------------------

class TestStage1:

    def test_carries_no_policy(self, stage1):
        """Policy here is policy the reviewee can edit.

        `pull_request` runs this file FROM THE PR HEAD. A tier or waiver rule
        living here reads as enforcement while being entirely under the
        contributor's control — worse than no rule, because it looks like one.

        Stricter than its parsed sibling on purpose: that one reads only the
        shell bodies, and this repo's maintainer login is a tier input that
        must not appear in this file at all.
        """
        assert "skip-pr-review" not in stage1, \
            "waiver rule must live in stage 2 (default-branch code)"
        assert "svroch" not in stage1, \
            "author-tier rule must live in stage 2 (default-branch code)"

    def test_keeps_the_reviewer_selftest_job(self, stage1):
        """`Reviewer Selftest` is itself a required context.

        It is offline and credential-free, so it belongs on the untrusted side;
        moving it into stage 2 would change which workflow reports a name the
        `main-protection` ruleset requires by exact string.
        """
        # Four-space indent pins it to a JOB. `^\s*name:` would also be
        # satisfied by a STEP called `Reviewer Selftest` (steps sit at six
        # spaces behind a `- `), and a step of that name reports no check —
        # the guard would read as green while the required context vanished.
        assert re.search(r"^    name: Reviewer Selftest\s*$", stage1, re.MULTILINE), \
            "stage 1 must keep the `Reviewer Selftest` JOB under that exact name"
        assert "scripts/ci/tests" in stage1, \
            "the selftest job must run the vendored pytest suite (scripts/ci/tests)"
        assert "pytest" in stage1, "selftest job must invoke pytest"
        assert "pyyaml" in stage1.lower(), (
            "the selftest job must install PyYAML — the vendored accepted-risk "
            "contract tests and the two-stage workflow guards both parse YAML"
        )


# ---------------------------------------------------------------------------
# Stage 2 — the parts local to this repo
# ---------------------------------------------------------------------------

class TestStage2:

    def test_posts_the_required_context_as_a_status(self, stage2):
        assert 'context="PR Review"' in stage2, (
            "stage 2 must post the required `PR Review` context as a commit "
            "status — it is the sole producer, and an absent status blocks"
        )
        assert "statuses: write" in stage2, "posting the status needs statuses:write"

    def test_calls_vendored_script_not_third_party_action(self, stage2):
        assert "scripts/ci/pr_review.py" in stage2, \
            "review job must invoke the vendored pr_review.py script"

    def test_tier_inputs_are_read_from_the_api(self, stage2):
        """The tier rules must run in default-branch code, on trusted input."""
        assert "skip-pr-review" in stage2, "waiver rule must be evaluated here"
        assert "needs-review" in stage2, "needs-review override must be here"
        assert "svroch" in stage2, "external-author rule must be here"
        assert re.search(r'gh api "repos/\$REPO/pulls/\$PR_NUMBER"', stage2), \
            "labels/author must be read from the API, not from stage 1"

    def test_sensitive_paths_rule(self, stage2):
        # The tier step must classify the WebUI's supply-chain surface as
        # sensitive: CI workflows, composite actions, executed git hooks, and
        # the vendored reviewer + gate scripts. `.github/actions/` is listed
        # although the directory does not exist yet — creating a composite
        # action needs a workflow edit (caught), but editing one later would
        # not be.
        for path in (".github/workflows/", ".github/actions/",
                     "scripts/hooks/", "scripts/ci/"):
            assert path in stage2, f"sensitive-path tier rule ({path}) missing"


# ---------------------------------------------------------------------------
# Secrets + provider invariants
# ---------------------------------------------------------------------------

class TestSecrets:

    def test_openrouter_secret_used(self, stage2):
        assert "secrets.OPENROUTER_API_KEY" in stage2, \
            "review job must read OPENROUTER_API_KEY from secrets"

    def test_no_anthropic_key(self, both):
        assert "ANTHROPIC_API_KEY" not in both, \
            "OpenRouter is the single provider — no ANTHROPIC_API_KEY"

    def test_no_literal_key(self, both):
        # No hardcoded OpenRouter/sk- key literal — must come from secrets.
        assert not re.search(r"sk-or-v1-[A-Za-z0-9]{8,}", both), \
            "hardcoded OpenRouter key literal found — use secrets.OPENROUTER_API_KEY"

    def test_model_env_override(self, stage2):
        assert "SHIPWRIGHT_PR_REVIEW_MODEL" in stage2, \
            "model must be selectable via SHIPWRIGHT_PR_REVIEW_MODEL env"

    def test_model_env_matches_code_default(self, stage2):
        # The workflow's hardcoded value and pr_review_openrouter.DEFAULT_MODEL
        # must agree — this is the one place a model swap can silently drift
        # (the workflow file's literal is never executed by the code path
        # this suite otherwise exercises).
        sys.path.insert(0, str(CI_DIR))
        import pr_review_openrouter as O
        assert f"SHIPWRIGHT_PR_REVIEW_MODEL: {O.DEFAULT_MODEL}" in stage2


# ---------------------------------------------------------------------------
# Supply-chain + injection hardening (this PR is itself security-scanned)
# ---------------------------------------------------------------------------

class TestHardening:

    @pytest.mark.parametrize("path", [STAGE1_PATH, STAGE2_PATH])
    def test_third_party_actions_sha_pinned(self, path):
        # Any action NOT in the GitHub first-party `actions/` org is third-party
        # and MUST be pinned to a 40-char commit SHA (DO-NOT #25: the posture is
        # asymmetric — GitHub-owned on mutable tags, third-party SHA-pinned).
        # ANCHORED to a YAML key, and that is load-bearing rather than tidy:
        # the inherited pattern was the unanchored `uses:\s*(\S+)`, which finds
        # the substring "uses: write" inside `stat`+`uses: write` and reports
        # the permission scope as an unpinned third-party action. Latent until
        # stage 2 became the first workflow here to need `statuses: write`.
        text = _read(path)
        for m in re.finditer(r"^\s*(?:-\s+)?uses:\s*(\S+)", text, re.MULTILINE):
            ref = m.group(1)
            if ref.startswith("actions/"):
                continue  # GitHub-owned — mutable tag is the required form
            _, _, version = ref.partition("@")
            assert re.fullmatch(r"[0-9a-f]{40}", version), \
                f"third-party action {ref!r} must be SHA-pinned"

    @pytest.mark.parametrize("path", [STAGE1_PATH, STAGE2_PATH])
    def test_no_direct_github_context_in_run_body(self, path):
        # run-shell-injection guard: never interpolate ${{ github.* }} directly
        # inside a `run:` shell body — hoist into env first. Tracks the run-block
        # by indentation so the legitimate `${{ github.* }}` in `env:` blocks is
        # not flagged (only deeper-indented run-block lines count).
        text = _read(path)
        offenders = []
        run_indent = None
        for line in text.splitlines():
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

#!/usr/bin/env python3
"""Tier-3 PR reviewer — OpenRouter-backed code review for a single PR.

Vendored from the canonical shipwright monorepo — the WebUI has no Python
``shared/``/``plugins/`` tree on the CI runner (same convention as
``scripts/hooks/anti_ratchet_check.py``).

# canonical-source-hash: f45d991470093e504323caea4a670f2310b482913dbea829264ad0dcbc38c915
# canonical-source-repo: https://github.com/svenroth-ai/shipwright
# canonical-source-paths:
#   plugins/shipwright-security/scripts/tools/pr_review.py
# canonical-source-version: iterate-2026-06-17-pr-review-truncation-failclosed
#
# THE HASH ABOVE PINS THE 2026-06-12 VENDOR POINT AND NO LONGER DESCRIBES THIS
# FILE. This is a PARTIAL vendor in both directions and the header says so
# rather than letting a reader infer byte-identity that is not there:
#   (1) sibling import — `pr_review_lib` lives next to this file in `scripts/ci/`,
#       so the sys.path insert points at SCRIPT_DIR (canonical: PLUGIN_ROOT/scripts/lib).
#   (2) default --prompt-dir → `scripts/ci/pr_reviewer`.
#   (3) OpenRouter attribution headers (HTTP-Referer / X-Title) → the webui repo.
#   (4) one docstring sentence ("uv run" → "the CI runner's Python").
#   (5) ADR-117 PORTED (iterate-2026-08-01-pr-review-stale-verdict): a passing
#       verdict retracts its own superseded change-requests. The ownership rule
#       is vendored verbatim into `pr_review_dismiss_select`; what lives HERE is
#       only what no other module can know — the nonce this run stamped and the
#       head it actually read.
#   (6) the `gh` + OpenRouter boundaries were split out to buy room for (5)
#       under the 300-line guideline; canonical keeps OpenRouter inline.
#   NOT ported, deliberately: canonical's diff filter, `pr_review_render`, the
#   byte-level diff read, `nothing_reviewed_summary`. Full divergence table and
#   rationale: the iterate spec §3/§4, which is the authority.

Invoked by `.github/workflows/pr-review-run.yml` (stage 2) for Tier-3 PRs only
(external contributors, sensitive paths, `needs-review`). The tier filter lives
in stage 2's `tier` step — default-branch code over API data, moved there by
iterate-2026-07-31-two-stage-pr-review; Step 8 covers Tier 1/2 locally.

Steps: read the PR head (BEFORE the diff — a review's own `commit_id` is stamped
at submission, so it cannot say what was reviewed) → fetch the diff → load
prompts → POST to OpenRouter (strict JSON) → parse the decision → post a comment
+ (best-effort) review state stamped with this run's nonce → on a passing
verdict, retract its own superseded change-requests → exit per decision.

Usage:
    python scripts/ci/pr_review.py \
        --pr-number 42 --repo owner/repo \
        --prompt-dir scripts/ci/pr_reviewer

Environment:
    OPENROUTER_API_KEY          required — OpenRouter credential (never logged)
    SHIPWRIGHT_PR_REVIEW_MODEL  optional — model id (default below)
    GH_TOKEN / GITHUB_TOKEN     used by `gh` for diff + comment + review + dismiss

Exit codes:
    0  decision approve | comment
    1  decision block  (also: a truncated/partial review fails closed — needs human)
    2  error (no key, OpenRouter down/rate-limited, JSON parse failure, unknown
       decision, prompt/diff fetch failure)
"""

from __future__ import annotations

import argparse
import io
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

# Pure review-logic helpers live in the lib module (no network / no subprocess)
# so this tool stays small and the logic is unit-testable. Re-exposed here so
# `pr_review.<symbol>` keeps working for callers and tests.
from pr_review_lib import (  # noqa: E402
    EXIT_BLOCK,
    EXIT_ERROR,
    EXIT_OK,
    MAX_DIFF_CHARS,
    _redact,
    build_messages,
    decision_to_exit,
    load_prompts,
    parse_review_response,
    render_comment,
    truncate_diff,
)
# Every `gh` call lives behind one module, so the subprocess surface is
# reviewable on its own and this tool stays inside the source-size guideline.
from pr_review_openrouter import (  # noqa: E402
    DEFAULT_MODEL,
    OPENROUTER_URL,
    call_openrouter,
)
from pr_review_gh import (  # noqa: E402
    fetch_pr_diff,
    post_pr_comment,
    post_pr_review_state,
)
# Retracting this reviewer's OWN superseded change-requests (ADR-117). The
# ownership rule is `pr_review_dismiss_select`; this tool only supplies the two
# things no other module can know — the nonce it stamped, and the commit it read.
from pr_review_dismiss import (  # noqa: E402
    dismiss_own_stale_verdicts,
    new_nonce,
    read_reviewed_head,
    stamp_review_body,
    strip_display_unsafe,
)

__all__ = [
    "EXIT_BLOCK", "EXIT_ERROR", "EXIT_OK", "MAX_DIFF_CHARS", "_redact",
    "build_messages", "decision_to_exit", "load_prompts", "parse_review_response",
    "render_comment", "truncate_diff", "DEFAULT_MODEL", "OPENROUTER_URL",
    "dismiss_own_stale_verdicts", "fetch_pr_diff", "new_nonce", "post_pr_comment",
    "post_pr_review_state", "read_reviewed_head", "stamp_review_body",
    "strip_display_unsafe",
]


def _fix_windows_encoding() -> None:
    if sys.platform == "win32":
        try:
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _build_pr_meta(pr_number: int, repo: str, truncated: bool) -> str:
    return f"Repository: {repo}\nPR number: {pr_number}\nDiff truncated: {truncated}\n"


def _post_verdict(args, api_key: str, body: str, decision: str, summary: str,
                  nonce: str) -> bool:
    """Post the comment + review state. Best-effort: a posting failure must not
    flip the gate, which reflects the review outcome (the exit code), not the
    side-effect.

    The review-state body is stamped with this run's nonce, which is how the
    stale-verdict cleanup later recognises its OWN review among the PR's.
    Returns whether that state landed: without it there is no anchor, and a
    cleanup that cannot identify itself must not guess.
    """
    # Stamped BEFORE the loop, not inside its iterable: Python builds that tuple
    # before entering the body, so a `stamp_review_body` that raised would
    # escape the try/except below — turning a passing review into exit 1 on the
    # one call in this construct that the best-effort contract does not cover.
    stamped = stamp_review_body(summary, nonce)
    state_posted = True
    for fn, call_args, what in (
        (post_pr_comment, (args.pr_number, args.repo, body), "PR comment"),
        (post_pr_review_state, (args.pr_number, args.repo, decision, stamped), "review state"),
    ):
        try:
            fn(*call_args)
        except Exception as e:  # noqa: BLE001
            # Scrubbed AND redacted (Stage-3). This diff made
            # `post_pr_review_state` raise, so this print is live for the first
            # time and its payload is raw `gh` stderr — which carries newlines
            # (HTTP 422 field errors). `_redact` masks only the key; without the
            # scrub a line starting `::error::` forges an Actions workflow
            # command. The sibling sink in `pr_review_dismiss` already guards it.
            print(_redact(strip_display_unsafe(f"[pr_review] failed to post {what}: {e}"),
                          api_key), file=sys.stderr)
            if fn is post_pr_review_state:
                state_posted = False
    return state_posted


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Tier-3 OpenRouter PR reviewer")
    parser.add_argument("--pr-number", type=int, required=True, help="PR number to review")
    parser.add_argument("--repo", required=True, help="owner/repo slug")
    parser.add_argument(
        "--prompt-dir",
        default="scripts/ci/pr_reviewer",
        help="Directory holding the `system` and `user` prompt files",
    )
    parser.add_argument("--timeout", type=int, default=120, help="OpenRouter timeout (seconds)")
    args = parser.parse_args(argv)

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("[pr_review] OPENROUTER_API_KEY is not set — cannot review.", file=sys.stderr)
        return EXIT_ERROR
    model = os.environ.get("SHIPWRIGHT_PR_REVIEW_MODEL", DEFAULT_MODEL)
    # Minted before the first post, because EVERY posting path stamps it.
    nonce = new_nonce()

    try:
        system_prompt, user_prompt = load_prompts(args.prompt_dir)
    except OSError as e:
        print(_redact(f"[pr_review] failed to read prompt dir: {e}", api_key), file=sys.stderr)
        return EXIT_ERROR

    # The head as it stands just before the diff is read. A review's own
    # `commit_id` is stamped when it is SUBMITTED, so it cannot say what was
    # actually reviewed — and the cleanup below needs exactly that.
    reviewed_sha = read_reviewed_head(args.pr_number, args.repo)

    try:
        diff = fetch_pr_diff(args.pr_number, args.repo)
    except Exception as e:  # noqa: BLE001 — subprocess / runtime errors are varied
        print(_redact(f"[pr_review] failed to fetch PR diff: {e}", api_key), file=sys.stderr)
        return EXIT_ERROR

    diff, truncated = truncate_diff(diff)
    pr_meta = _build_pr_meta(args.pr_number, args.repo, truncated)
    messages = build_messages(system_prompt, user_prompt, diff, pr_meta)

    est_tokens = (len(system_prompt) + len(user_prompt) + len(diff)) // 4
    print(
        f"[pr_review] reviewing PR #{args.pr_number} with {model} "
        f"(~{est_tokens} input tokens, truncated={truncated})",
        file=sys.stderr,
    )

    try:
        raw = call_openrouter(api_key, model, messages, args.timeout)
    except Exception as e:  # noqa: BLE001 — any transport/shape failure is a non-blocking error
        print(_redact(f"[pr_review] OpenRouter call failed: {e}", api_key), file=sys.stderr)
        return EXIT_ERROR

    try:
        review = parse_review_response(raw)
    except ValueError as e:
        print(
            _redact(f"[pr_review] could not parse review JSON: {e}\n--- raw response ---\n{raw}", api_key),
            file=sys.stderr,
        )
        return EXIT_ERROR

    decision = str(review.get("decision", ""))
    # A truncated diff is a PARTIAL review — we never saw the whole change. For a
    # required gate on an untrusted (external/sensitive) PR, neither auto-passing
    # nor trusting the partial verdict is safe: a large diff must not be able to
    # BYPASS review by exceeding the size cap. Fail CLOSED — force a
    # request-changes state + non-zero exit (below) so a human must review; the
    # red check is also what lets the gh-pr-ci triage producer track the PR.
    # (Until iterate-2026-06-17-pr-review-truncation-failclosed this returned
    # EXIT_OK — a silent size-bypass.)
    effective_decision = "block" if truncated else decision
    body = render_comment(review, model=model, truncated=truncated)

    state_posted = _post_verdict(args, api_key, body, effective_decision,
                                 str(review.get("summary", "")), nonce)

    if truncated:
        # Partial review fails closed — needs human (see comment above).
        # `skip-pr-review` is no longer a general override (stage 2's tier step
        # ignores it on a sensitive path, which an oversize diff often touches).
        print(
            "[pr_review] diff was truncated — failing closed (needs human review). "
            "Split it below the size cap; `skip-pr-review` overrides this only on "
            "a NON-sensitive-path PR, else it needs an admin merge.",
            file=sys.stderr,
        )
        return EXIT_BLOCK

    exit_code = decision_to_exit(decision)
    if exit_code == EXIT_ERROR:
        print(f"[pr_review] unknown decision '{decision}' — treating as error.", file=sys.stderr)
    if exit_code == EXIT_OK and state_posted:
        # This run said yes, so its own earlier NOs about commits that are gone
        # must stop holding the PR. Only on a passing verdict, and never allowed
        # to change what the review earned — hence the outer guard as well as
        # the ones inside. GitHub does not let a COMMENTED review retract a
        # CHANGES_REQUESTED one, and `dismiss_stale_reviews_on_push` clears
        # approvals only, so without this a green PR stays BLOCKED in silence.
        #
        # ORDERING (Stage-2 review): this irreversible write runs in the
        # `Run Tier-3 PR review` step, BEFORE the workflow's own head-moved /
        # impostor-context checks in `Post the PR Review verdict`. Tolerable
        # because the cleanup keys on `reviewed_sha` rather than
        # `workflow_run.head_sha`, and a concurrent run's block about B is
        # stamped B and hits the `current_commit` skip.
        #
        # It is NOT airtight, and an earlier version of this comment claimed it
        # was (Stage-3 review). `reviewed_sha` is FRESH, not EXACT: nothing
        # couples the head read to the `gh pr diff` that follows it, and that
        # fetch resolves the PR by NUMBER, so A→B→A leaves all three terms
        # agreeing on A while the diff actually reviewed was B. Bounded, not
        # closed — a verdict at the current head is still skipped as
        # `current_commit`. Authority: iterate spec §5b(d).
        try:
            dismiss_own_stale_verdicts(args.pr_number, args.repo, nonce=nonce,
                                       reviewed_sha=reviewed_sha)
        except Exception as e:  # noqa: BLE001 — housekeeping never flips the gate
            print(_redact(f"[pr_review] stale-verdict cleanup failed: {e}", api_key),
                  file=sys.stderr)
    return exit_code


if __name__ == "__main__":
    _fix_windows_encoding()
    sys.exit(main())

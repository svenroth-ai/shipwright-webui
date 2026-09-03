#!/usr/bin/env python3
"""Tier-3 PR reviewer — OpenRouter-backed code review for a single PR.

Vendored from the canonical shipwright monorepo — the WebUI has no Python
``shared/``/``plugins/`` tree on the CI runner (same convention as
``scripts/hooks/anti_ratchet_check.py``).

# canonical-source-repo: https://github.com/svenroth-ai/shipwright
# canonical-source-paths:
#   plugins/shipwright-security/scripts/tools/pr_review.py
# canonical-source-version: iterate-2026-07-27-pr-review-forged-boundary
#   + iterate-2026-08-01-pr-review-stale-verdict (ADR-117)
#   + iterate-2026-08-31-pr-review-deepseek-model (DeepSeek ZDR routing)
#
# THIS FILE MERGES TWO INDEPENDENT CANONICAL PORTS and is not byte-identical to
# either, so no canonical-source-hash line is claimed (see the same discipline
# in `pr_review_gh.py` / `pr_review_openrouter.py`). Adaptations from both:
#   (1) sibling imports (`scripts/ci/`, canonical: PLUGIN_ROOT/scripts/lib);
#       (2) default --prompt-dir → `scripts/ci/pr_reviewer`; (3) OpenRouter
#       attribution headers (HTTP-Referer / X-Title) → the webui repo.
#   (4) ADR-117: a passing verdict retracts its own superseded change-requests.
#       The ownership rule is vendored verbatim into `pr_review_dismiss_select`;
#       what lives HERE is only what no other module can know — the nonce this
#       run stamped and the head it actually read.
#   (5) canonical-parity hardening (iterate-2026-07-28-pr-review-parity): one-
#       pass template fill, bytes-safe diff fetch, LF-anchored section
#       splitting, generated-artifact filter + `safe_path` sanitiser, 200k→1M
#       cap cut at a file boundary — logic lives in `pr_review_diff_filter` /
#       `pr_review_render` / `pr_review_safe_path`, this file only wires it in.
#   Both ports split OpenRouter and `gh` into their own boundary module, so
#   this file holds orchestration only.

Invoked by `.github/workflows/pr-review-run.yml` (stage 2) for Tier-3 PRs only
(external contributors, sensitive paths, `needs-review`); the tier filter lives
in stage 2's `tier` step (default-branch code over API data), Step 8 covers
Tier 1/2 locally.

Steps: read the PR head (before the diff, since a review's own `commit_id` is
stamped at submission) → fetch the diff (as bytes) → drop producer-generated
sections → refuse if nothing reviewable is left → truncate at a file boundary
if still oversize → load prompts → build messages → POST to OpenRouter (strict
JSON) → parse the decision → post a comment + (best-effort) review state
stamped with this run's nonce → on a pass, retract its own superseded
change-requests → exit per decision.

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
    1  block — also when nothing/not everything was reviewed (fails closed)
    2  error (no key, OpenRouter down/rate-limited, JSON parse failure, unknown
       decision, prompt/diff fetch failure, a template missing a placeholder,
       invalid DeepSeek ZDR routing policy)
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
    build_pr_meta,
    decision_to_exit,
    filter_generated_paths,
    load_prompts,
    nothing_reviewed_summary,
    parse_review_response,
    render_comment,
    safe_path,
    truncate_diff,
)
from pr_review_diff_filter import count_sections  # noqa: E402
# The two I/O boundaries each own a module — `gh` subprocess and OpenRouter HTTP.
# Re-exported here so existing call sites and their monkeypatch targets
# (`pr_review.fetch_pr_diff`, `pr_review.call_openrouter`, ...) are unchanged.
from pr_review_gh import (  # noqa: E402
    fetch_pr_diff,
    post_pr_comment,
    post_pr_review_state,
)
from pr_review_openrouter import (  # noqa: E402
    DEEPSEEK_MODEL, DEFAULT_MODEL, DEFAULT_TIMEOUT, GLM_MODEL, OPENROUTER_URL, call_openrouter,
)
# ZDR provider-routing constraint for the DeepSeek/GLM namespaces; `{}` for any
# other override, which never reads `pr_review_routing.json` (see module docstring).
from pr_review_model_policy import DeepSeekRoutingPolicyError, GlmRoutingPolicyError, resolve_extra_body  # noqa: E402
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

# The re-export surface every caller/test reaches via `pr_review.<symbol>` —
# kept complete since a name imported above but missing here reads as private.
__all__ = [
    "EXIT_BLOCK", "EXIT_ERROR", "EXIT_OK", "MAX_DIFF_CHARS", "_redact",
    "build_messages", "build_pr_meta", "count_sections", "decision_to_exit",
    "dismiss_own_stale_verdicts", "fetch_pr_diff", "filter_generated_paths",
    "load_prompts", "new_nonce", "nothing_reviewed_summary",
    "parse_review_response", "post_pr_comment", "post_pr_review_state",
    "read_reviewed_head", "render_comment", "safe_path", "stamp_review_body",
    "strip_display_unsafe", "truncate_diff", "call_openrouter", "DEFAULT_MODEL",
    "DEFAULT_TIMEOUT", "OPENROUTER_URL", "DEEPSEEK_MODEL", "GLM_MODEL",
    "DeepSeekRoutingPolicyError", "GlmRoutingPolicyError", "resolve_extra_body",
]


def _fix_windows_encoding() -> None:
    if sys.platform == "win32":
        try:
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _post_verdict(args, api_key: str, body: str, decision: str, summary: str,
                  nonce: str) -> bool:
    """Post the comment + review state. Best-effort: a posting failure must not
    flip the gate, which reflects the review outcome, not the side-effect.

    Stamped with this run's nonce, so the stale-verdict cleanup can recognise
    its OWN review later. Returns whether the state landed: without an anchor,
    a cleanup that cannot identify itself must not guess.
    """
    # Stamped BEFORE the loop: the tuple below is built before the try/except,
    # so a raising `stamp_review_body` would escape it — the one call here the
    # best-effort contract does not cover.
    stamped = stamp_review_body(summary, nonce)
    state_posted = True
    for fn, call_args, what in (
        (post_pr_comment, (args.pr_number, args.repo, body), "PR comment"),
        (post_pr_review_state, (args.pr_number, args.repo, decision, stamped), "review state"),
    ):
        try:
            fn(*call_args)
        except Exception as e:  # noqa: BLE001
            # Scrubbed AND redacted: `_redact` masks only the key, and this
            # payload is raw `gh` stderr, which carries newlines — without the
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
    # One default, defined with the transport it belongs to (pr_review_openrouter).
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT,
                        help="OpenRouter timeout (seconds)")
    args = parser.parse_args(argv)

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("[pr_review] OPENROUTER_API_KEY is not set — cannot review.", file=sys.stderr)
        return EXIT_ERROR
    model = os.environ.get("SHIPWRIGHT_PR_REVIEW_MODEL", DEFAULT_MODEL)
    # Resolved before any network I/O: a model outside the DeepSeek/GLM
    # namespaces never touches pr_review_routing.json; a gated model's
    # missing/malformed config or invalid ZDR policy must fail this REQUIRED
    # gate closed before the diff is even fetched.
    try:
        extra_body = resolve_extra_body(model)
    except Exception as e:  # noqa: BLE001 — any loader/policy failure must
        # fail closed, not escape as a bare traceback; type name keeps a real
        # code bug diagnosable.
        print(_redact(
            f"[pr_review] reviewer misconfigured (ZDR routing policy) — "
            f"not your change: {type(e).__name__}: {e}", api_key), file=sys.stderr)
        return EXIT_ERROR
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

    # Drop producer-generated artifacts (compliance MDs, agent-docs, changelog
    # drops, state logs, prior review records — NOT lockfiles, which left this
    # set in iterate-2026-07-27-pr-review-forged-boundary since on an untrusted
    # PR the lockfile IS the supply-chain surface) before truncation: they
    # dominate a shipwright diff but carry no reviewable logic and would trip
    # the size cap. The excluded list is surfaced to model + humans, never silent.
    diff, excluded = filter_generated_paths(diff)

    # ...but "everything was generated" is not a review. This script runs ONLY
    # when the tier step decided the PR needs one (an ordinary internal PR never
    # reaches here). A filtered diff that comes back empty means a PR that had
    # to be reviewed was handed nothing — and the system prompt answers an empty
    # diff with `approve`: a green required check over an unread change. The
    # invariant is "saw at least one file section", not "everything was
    # filtered" — an empty fetch, a headerless `gh` body, and a fully-filtered
    # PR are the same failure from the model's side.
    if not count_sections(diff):
        summary = nothing_reviewed_summary(excluded)
        # `model=` names who reviewed. On this branch nobody did — we return
        # before call_openrouter — so the footer must not attribute the verdict
        # to a model that was never sent anything.
        _post_verdict(args, api_key,
                      render_comment({"decision": "block", "summary": summary},
                                     model="no model — nothing was sent",
                                     truncated=False,
                                     excluded_generated=excluded),
                      "block", summary, nonce)
        print(f"[pr_review] {summary}", file=sys.stderr)
        return EXIT_BLOCK

    reviewed = truncate_diff(diff)
    diff, truncated = reviewed.text, reviewed.incomplete
    missing = {"omitted": reviewed.omitted, "partial": reviewed.partial,
               "unidentified": reviewed.unidentified}
    pr_meta = build_pr_meta(args.pr_number, args.repo, truncated, excluded, **missing)
    try:
        messages = build_messages(system_prompt, user_prompt, diff, pr_meta)
    except ValueError as e:
        # A template that lost a placeholder. Mapped like every other boundary
        # in main() — redacted, EXIT_ERROR — rather than escaping as a raw
        # traceback that happens to exit non-zero.
        print(_redact(f"[pr_review] {e}", api_key), file=sys.stderr)
        return EXIT_ERROR

    est_tokens = (len(system_prompt) + len(user_prompt) + len(diff)) // 4
    print(
        f"[pr_review] reviewing PR #{args.pr_number} with {model} "
        f"(~{est_tokens} input tokens, truncated={truncated}, "
        f"generated-excluded={len(excluded)})",
        file=sys.stderr,
    )

    try:
        raw = call_openrouter(api_key, model, messages, args.timeout, extra_body=extra_body)
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
    # A truncated diff is a PARTIAL review. On a required gate for an untrusted
    # PR, neither auto-passing nor trusting the partial verdict is safe — a
    # large diff must not BYPASS review by exceeding the size cap. Fail CLOSED:
    # force request-changes + non-zero exit so a human must review (until
    # iterate-2026-06-17-pr-review-truncation-failclosed this returned EXIT_OK).
    effective_decision = "block" if truncated else decision
    body = render_comment(
        review, model=model, truncated=truncated, excluded_generated=excluded, **missing)

    state_posted = _post_verdict(args, api_key, body, effective_decision,
                                 str(review.get("summary", "")), nonce)

    if truncated:
        # Partial review fails closed — needs human. `skip-pr-review` is
        # ignored on a sensitive path (needs an admin merge instead). Sanitised
        # like every sink: a raw Git path can carry terminal escapes.
        unseen = ", ".join(safe_path(p) for p in reviewed.omitted + reviewed.partial)
        extra = f" (+{reviewed.unidentified} unnamed)" if reviewed.unidentified else ""
        print(
            "[pr_review] diff exceeded the review limit — failing closed (needs human "
            f"review). Not reviewed in full: {unseen or 'unidentifiable'}{extra}. Apply "
            "`skip-pr-review` after a manual review to override — on a sensitive path "
            "that label is ignored and needs an admin merge instead.",
            file=sys.stderr)
        return EXIT_BLOCK

    exit_code = decision_to_exit(decision)
    # Unconditional, unlike the check below it — a correct block/approve/comment
    # used to print NOTHING past the "reviewing PR..." line above, making a
    # legitimate gate outcome indistinguishable from a hang in the CI log
    # (canonical shipwright PR #672: 4 CI runs misdiagnosed as an infra flake for
    # exactly this reason, while the full findings sat unread in the PR comment
    # the whole time — see render_comment/_post_verdict above). Bounded to keep
    # this a log LINE, and scrubbed like every other untrusted-text sink in this
    # file (the model's summary is as untrusted as `gh`'s own error bodies).
    summary_excerpt = strip_display_unsafe(str(review.get("summary", ""))[:300])
    print(_redact(
        f"[pr_review] decision={decision} exit={exit_code} — {summary_excerpt!r} "
        "(full findings posted as PR comment)", api_key), file=sys.stderr)
    if exit_code == EXIT_ERROR:
        print(f"[pr_review] unknown decision '{decision}' — treating as error.", file=sys.stderr)
    if exit_code == EXIT_OK and state_posted:
        # This run said yes, so its own earlier NOs about commits that are gone
        # must stop holding the PR — only on a passing verdict, never allowed to
        # change what the review earned. GitHub does not let a COMMENTED review
        # retract CHANGES_REQUESTED, and `dismiss_stale_reviews_on_push` clears
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

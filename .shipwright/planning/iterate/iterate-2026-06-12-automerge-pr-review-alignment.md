# Iterate Spec — iterate-2026-06-12-automerge-pr-review-alignment

- **Intent:** CHANGE (migrate the existing automated PR-review mechanism)
- **Complexity:** medium
- **Risk:** touches `.github/workflows/` (CI / supply-chain surface) → mandatory
  full review (Step 8) + workflow-shape regression test.
- **Canonical pattern:** monorepo B4.5 Phase 2 (`trg-52cd3143`, merged via
  PR #193 + parser-fix #196). This iterate ports that pattern to the WebUI.

## Problem

`.github/workflows/claude-review.yml` (the WebUI's current automated reviewer) is
misaligned with the monorepo's B4.5 PR-review architecture on three axes:

1. **Provider:** installs `@anthropic-ai/claude-code` and calls Anthropic directly
   via `ANTHROPIC_API_KEY`. B4.5 standardised on **OpenRouter** + a custom script
   we own (no marketplace LLM-review action, single provider, model-swappable).
2. **No tier filter:** it reviews **every** PR. B4.5 reviews only **Tier-3** PRs
   (external contributors, sensitive/supply-chain paths, or the `needs-review`
   label). Tier 1/2 PRs (the maintainer's own iterate PRs) are already reviewed
   locally at `/shipwright-iterate` Step 8 — re-reviewing them in CI burns tokens
   and adds noise.
3. **Dead trigger branch:** triggers on `[main, develop]`; `develop` does not
   exist in this repo.

## Solution

Replace `claude-review.yml` with `pr-review.yml`, mirroring the canonical
monorepo workflow, and **vendor** the reviewer (script + lib + prompts) into the
WebUI — the WebUI has no monorepo `plugins/`/`shared/` tree on the CI runner, so
the reviewer must live in-repo. This follows the established WebUI vendoring
convention already used for `scripts/hooks/anti_ratchet_check.py`
(canonical-source header → drift-detectable).

### Affected Boundaries

- **CI workflow contract:** `.github/workflows/pr-review.yml` — the `PR Review`
  job is the (future) required status check; the `decide` job is the tier gate.
- **OpenRouter HTTP boundary:** `pr_review.py` POSTs to `/chat/completions`
  (strict JSON). Vendored verbatim-logic from canonical (already tested).
- **`gh` CLI boundary:** diff fetch + comment + review-state.
- **Prompt-file boundary:** `scripts/ci/pr_reviewer/{system,user}` (extension-less,
  `{PR_META}`/`{DIFF}` placeholders).
- **Secret boundary:** `OPENROUTER_API_KEY` (repo secret, never logged — redacted).

### Acceptance Criteria

- **AC1** — `claude-review.yml` is removed; `pr-review.yml` exists and triggers
  only on `pull_request: [main]` (+ `labeled` type for label overrides). No
  `develop` branch. No `ANTHROPIC_API_KEY`, no `@anthropic-ai/claude-code`.
- **AC2** — `pr-review.yml` has a `decide` job (fork-guarded) implementing the
  tier filter: `skip-pr-review` label → skip; `needs-review` label → review;
  sensitive path (`.github/workflows/`, `scripts/hooks/`, `scripts/ci/`) → review;
  external author (≠ `svroch`, ≠ `dependabot[bot]`) → review; otherwise skip.
- **AC3** — the `review` job is named exactly `PR Review`, `needs: decide`, gates
  on `needs.decide.outputs.needs_review == 'true'`, reads `OPENROUTER_API_KEY`
  from secrets, sets `SHIPWRIGHT_PR_REVIEW_MODEL`, and invokes the vendored
  `scripts/ci/pr_review.py` (custom script, not a 3rd-party action).
- **AC4** — the vendored `pr_review.py` + `pr_review_lib.py` are byte-faithful to
  canonical logic (lib verbatim; tool adapted only for the flat in-repo layout +
  default prompt-dir, documented in the vendor header). Exit codes preserved:
  0 approve/comment, 1 block, 2 error; truncated diff → never auto-block.
- **AC5** — the vendored prompts preserve the strict-JSON contract, the
  untrusted-diff inoculation, and the security/correctness decision rules;
  sensitive-path references are re-pointed to the WebUI's surface.
- **AC6** — a `Reviewer Selftest` job runs the vendored pytest suite
  (`scripts/ci/tests/`) on every PR (offline, no secrets) so a broken vendored
  copy or a workflow-tier regression fails red in CI.

### Out of scope / follow-ups (documented, not built here)

- **Branch protection:** `main` is currently unprotected. For the tier gate to
  actually block merge (and for B4.5 Phase 3 auto-merge), the user must add
  `PR Review` as a required status check. (User action — GitHub settings.)
- **Secret provisioning:** the user must add `OPENROUTER_API_KEY` to the WebUI
  repo secrets and may remove the now-unused `ANTHROPIC_API_KEY`. Without the
  key the `review` job fails closed (script exits 2 with a clear message).

## Confidence Calibration

- **Boundaries touched:** CI workflow contract (`pr-review.yml`), OpenRouter HTTP
  boundary, `gh` CLI boundary, prompt-file boundary, `OPENROUTER_API_KEY` secret.

- **Empirical probes run:**
  - **Probe A** — `diff` of the vendored `pr_review_lib.py` code body (from
    `from __future__` to EOF) vs canonical → **IDENTICAL** (byte-for-byte).
  - **Probe B** — parsed `pr-review.yml` with PyYAML → valid; jobs ==
    `{selftest, decide, review}`; `review.name == "PR Review"`, `needs == decide`,
    `if == needs.decide.outputs.needs_review == 'true'`; trigger branches `[main]`.
  - **Probe C** — ran `python scripts/ci/pr_review.py` standalone (CI shape, no
    pytest) with `OPENROUTER_API_KEY` unset → exit **2** + clear message (entrypoint
    + sibling import resolve outside the test harness).
  - **Probe D** — applied the decide-job tier regex to 7 representative changed
    paths → `.github/workflows/`, `scripts/hooks/`, `scripts/ci/` classify SENSITIVE;
    `client/**`, `server/**`, `scripts/dev-restart.js`, `README.md` classify ordinary
    (the regex anchors `scripts/hooks/`+`scripts/ci/`, NOT bare `scripts/`).
  - **Probe E** — `diff` of vendored `pr_review.py` vs canonical → only the 4
    documented non-logic deltas (sibling import, default prompt-dir, attribution
    headers, one docstring sentence). No review-logic drift.
  - 72/72 vendored unit tests pass; `ruff --select F scripts/ci/` clean.

- **Test Completeness Ledger** (principle: testable ⇒ tested; 0 testable-but-untested):

  | # | Behavior | Status | Evidence |
  |---|---|---|---|
  | 1 | Trigger = PR→main + `labeled`, no `develop` | tested | `test_trigger_branch_is_main_only`, `test_labeled_event_type_present` |
  | 2 | No `@anthropic-ai/claude-code`, no `ANTHROPIC_API_KEY` | tested | `test_no_anthropic_claude_code_package`, `test_no_anthropic_key`, `test_uses_openrouter_key_not_anthropic` |
  | 3 | decide tier: sensitive-path classification | tested | Probe D (7 paths) + `test_sensitive_paths_rule` |
  | 4 | decide tier: label-precedence + external-author branches | tested | `test_skip_label_rule`, `test_needs_review_label_rule`, `test_external_author_rule` (structural contract pins, same strategy the canonical repo applies to this YAML construct); end-to-end Actions exec is integration-level, exercised live on the first PR |
  | 5 | review job: name `PR Review`, `needs: decide`, gate on `needs_review=='true'` | tested | `test_job_name_is_pr_review`, `test_needs_decide_with_gate` + Probe B |
  | 6 | review job: invokes vendored script w/ OpenRouter secret + model env | tested | `test_calls_custom_script_not_third_party_action`, `test_openrouter_secret_used`, `test_model_env_override` |
  | 7 | script: decision→exit (approve/comment=0, block=1, error=2) | tested | `TestDecisionToExit`, `TestMainOrchestration` |
  | 8 | script: truncated diff never auto-blocks | tested | `test_truncation_forces_exit_0_even_on_block`, `test_over_limit_truncates` |
  | 9 | script: markdown-fence / prose JSON tolerance | tested | `test_json_object_in_markdown_fence` / `_bare_fence` / `_with_surrounding_prose` |
  | 10 | script: API key never logged (redaction) | tested | `test_api_key_never_logged`, `TestRedaction` |
  | 11 | script: OpenRouter request shape (auth, json_object) | tested | `test_builds_authorized_json_request` |
  | 12 | script: gh wrappers error handling | tested | `TestGhWrappers` |
  | 13 | script: standalone CLI entrypoint, missing key → exit 2 | tested | Probe C |
  | 14 | vendored lib byte-identical to canonical | tested | Probe A |
  | 15 | vendored tool diff = only documented deltas | tested | Probe E |
  | 16 | prompts: strict-JSON contract + untrusted-diff inoculation | tested | `TestPromptContent` |
  | 17 | selftest job runs vendored suite | tested | `test_selftest_runs_vendored_suite` |
  | 18 | third-party actions SHA-pinned (none present) | tested | `test_third_party_actions_sha_pinned` (future-proof) |
  | 19 | no raw `${{ github.* }}` in run bodies (injection guard) | tested | `test_no_direct_github_context_in_run_body` |

- **Confidence-pattern check:**
  - *Asymptote (depth):* the reviewer logic is vendored **byte-identical** from a
    production-validated source (monorepo B4.5, incl. the live-verified #196 fence
    fix + #193 truncation). Probes A/E prove zero logic drift — re-deriving its
    correctness asymptotes against the canonical ground truth.
  - *Coverage (breadth):* 72 unit tests + 5 probes span script (HTTP/gh/parse/exit/
    redact/truncate), prompts (contract + injection), workflow (trigger/tier/gate/
    secrets/hardening), and the migration deltas. The single integration gap — the
    `decide` bash executing in the live Actions runtime with a real PR payload —
    is breadth only the first real PR exercises; documented (row 4), not hidden.

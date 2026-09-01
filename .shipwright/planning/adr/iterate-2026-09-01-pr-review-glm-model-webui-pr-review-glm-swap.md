# ADR: Swap the vendored Tier-3 PR-review gate's default model to GLM 5.3

## Context

The canonical shipwright monorepo's Tier-3 PR-review gate — this repo's
vendored, self-contained equivalent — defaulted to `deepseek/deepseek-v4-pro`
(iterate-2026-08-31-pr-review-deepseek-model). On real PR #668 in the
monorepo, DeepSeek repeatedly (3x, deterministically) produced a confident
BLOCK verdict citing a `NameError` that did not exist in the diff — a
model-quality regression, verified via direct git-blob archaeology, not an
infra bug. The monorepo swapped its default to GLM 5.3 after ZDR
(zero-data-retention) OpenRouter provider vetting and a live production-route
probe (iterate-2026-09-01-pr-review-glm-model, PR #669), confirming GLM avoids
the hallucination and finds real, grounded issues on the same diff instead.

## Decision

Ported the identical swap into shipwright-webui's own vendored copy of the
gate. Generalized the DeepSeek-only ZDR routing-validation logic in
`scripts/ci/pr_review_model_policy.py` into a shared
`_provider_openrouter_extra_body(config, *, routing_key, error_cls,
approved_endpoints)` helper reused by both the DeepSeek and new GLM arms.
Renamed the vendored routing config from `deepseek_routing.json` to
`pr_review_routing.json` (now holding both a `deepseek_routing` and a
`glm_routing` block), mirroring the monorepo's single shared
`external_review.json`. `DEFAULT_MODEL` flips from `DEEPSEEK_MODEL` to the new
`GLM_MODEL` constant; `DEEPSEEK_MODEL` stays fully wired as a live
`SHIPWRIGHT_PR_REVIEW_MODEL` operator override with its own ZDR routing
untouched.

## Consequences

The Tier-3 gate now reviews PRs with GLM 5.3 by default; DeepSeek remains one
env-var override away for rollback or experimentation. The GLM ZDR
verification (data-policy API + live production-route probe) is
vendored/cited from the canonical monorepo's own evidence rather than
re-probed independently in this repo, since it validates OpenRouter's own
service, not anything repo-specific — same precedent as this repo's original
DeepSeek routing config, which was also vendored rather than independently
re-verified. A rollback PR editing the model back is itself reviewed by the
default branch's own (possibly still-broken) copy of the workflow
(`workflow_run` semantics), so recovery from a future GLM outage still needs a
maintainer's `gh pr merge --admin` — confirmed live on 2026-09-01 that the
`main-protection` ruleset still grants that bypass.

## Rejected alternatives

Independently re-running a live GLM ZDR probe inside webui was considered and
rejected: it would duplicate infrastructure for a claim that is about
OpenRouter's own service, not this repo, and the DeepSeek port already
established the precedent of vendoring rather than re-probing.

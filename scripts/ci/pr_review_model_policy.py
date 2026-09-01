"""Model-identity policy for the Tier-3 PR reviewer's OpenRouter call.

Vendored from the canonical shipwright monorepo — merges
`pr_review_model_policy.py` (the policy) and the ZDR-routing-relevant slice of
`external_review_routing.py` (the validation logic, generalized across the
DeepSeek and GLM arms) into one self-contained module, since the WebUI CI
runner has no `shared/scripts/lib` tree to import from (same convention as
`pr_review.py` / `scripts/hooks/anti_ratchet_check.py`).

# canonical-source-repo: https://github.com/svenroth-ai/shipwright
# canonical-source-paths:
#   plugins/shipwright-security/scripts/lib/pr_review_model_policy.py
#   shared/scripts/lib/external_review_routing.py (deepseek_openrouter_extra_body
#     + glm_openrouter_extra_body + the shared _provider_openrouter_extra_body
#     helper + DeepSeekRoutingPolicyError/GlmRoutingPolicyError +
#     APPROVED_DEEPSEEK_ENDPOINTS/APPROVED_GLM_ENDPOINTS)
# canonical-source-version: iterate-2026-08-31-pr-review-deepseek-model
#   + iterate-2026-09-01-pr-review-glm-model (generalized the DeepSeek-only
#     validation into a shared per-namespace helper; added the GLM arm)
#
# THIS FILE MERGES TWO INDEPENDENT CANONICAL SOURCES and is not byte-identical
# to either, so no canonical-source-hash line is claimed (same discipline as
# `pr_review.py` / `pr_review_openrouter.py`). Adaptations:
#   (1) the routing config is a self-contained vendored JSON file
#       (`pr_review_routing.json`, sibling of this module) instead of
#       `shared/config/external_review.json` — the WebUI CI runner has no
#       shared config tree to read from.
#   (2) the config loader (the DeepSeek/GLM-relevant slice of
#       `load_review_config`) is inlined here rather than kept in a separate
#       `external_review_config` lib module.

Owns the ONE decision this gate needs beyond a bare model string: whether the
resolved `SHIPWRIGHT_PR_REVIEW_MODEL` is in a ZDR-gated vendor namespace
(DeepSeek or GLM) and, if so, must carry the fail-closed ZDR (zero-data-
retention) provider-routing constraint. A model outside both namespaces (a
Sonnet rollback, a one-off experiment) must resolve to `{}` WITHOUT ever
reading `pr_review_routing.json`, so a broken/absent routing config cannot
break PR review for a model that never needed it (mirrors
iterate-2026-08-31-pr-review-deepseek-model, independently found by both the
internal and the external plan review on the canonical change).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

__all__ = [
    "DeepSeekRoutingPolicyError",
    "GlmRoutingPolicyError",
    "is_deepseek_model",
    "is_glm_model",
    "resolve_extra_body",
]

_ROUTING_CONFIG_PATH = Path(__file__).resolve().parent / "pr_review_routing.json"

# Authorization is code-owned, same as canonical: the vendored config declares
# the active ordered allowlist and its verification metadata, but cannot bless
# an arbitrary slug by labelling it safe. Adding a verified EU endpoint is
# deliberately a code + config + test review, not an unreviewed project
# override.
APPROVED_DEEPSEEK_ENDPOINTS: tuple[tuple[str, str], ...] = (
    ("novita", "US"),
    ("together", "US"),
)
APPROVED_GLM_ENDPOINTS: tuple[tuple[str, str], ...] = (
    ("novita", "US"),
    ("together", "US"),
)
_ALLOWED_REGIONS = frozenset({"US", "EU"})


class DeepSeekRoutingPolicyError(ValueError):
    """The DeepSeek request cannot be routed under the verified ZDR policy."""


class GlmRoutingPolicyError(ValueError):
    """The GLM request cannot be routed under the verified ZDR policy."""


def is_deepseek_model(model: str) -> bool:
    """True if `model` names an OpenRouter model in the `deepseek/` namespace.

    Normalized (trimmed, casefolded) and namespace-matched rather than an
    exact-string comparison — a variant suffix (`:free`, `:nitro`) or a
    casing/whitespace difference must still get the ZDR constraint, not
    silently bypass it.
    """
    return model.strip().casefold().startswith("deepseek/")


def is_glm_model(model: str) -> bool:
    """True if `model` names an OpenRouter model in the `z-ai/` namespace.

    Same normalization discipline as `is_deepseek_model` — see there.
    """
    return model.strip().casefold().startswith("z-ai/")


def _load_routing_config() -> dict[str, Any]:
    return json.loads(_ROUTING_CONFIG_PATH.read_text(encoding="utf-8"))


def _configured_endpoints(
    config: dict[str, Any], *, routing_key: str, error_cls: type[ValueError]
) -> list[dict[str, Any]]:
    routing = config.get(routing_key)
    if not isinstance(routing, dict):
        raise error_cls(f"{routing_key} is missing or not an object")
    endpoints = routing.get("provider_allowlist")
    if not isinstance(endpoints, list) or not endpoints:
        raise error_cls(f"{routing_key}.provider_allowlist must be a non-empty list")
    if not all(isinstance(item, dict) for item in endpoints):
        raise error_cls(f"every {routing_key} provider entry must be an object")
    return endpoints


def _provider_openrouter_extra_body(
    config: dict[str, Any],
    *,
    routing_key: str,
    error_cls: type[ValueError],
    approved_endpoints: tuple[tuple[str, str], ...],
) -> dict[str, Any]:
    """Return the complete provider policy for one ZDR-gated namespace, or raise
    before network I/O.

    The vendored configuration must match the code-owned approval registry
    exactly, including order. This makes today's outbound body deterministic
    while keeping the declaration intentionally configurable for a future,
    reviewed US/EU ZDR endpoint addition. Shared by both the DeepSeek and GLM
    arms so the validation logic exists once, not twice.
    """
    endpoints = _configured_endpoints(config, routing_key=routing_key, error_cls=error_cls)
    configured: list[tuple[str, str]] = []
    for index, endpoint in enumerate(endpoints):
        slug = endpoint.get("provider")
        region = endpoint.get("region")
        verified = endpoint.get("zero_retention_verified")
        if not isinstance(slug, str) or not slug.strip():
            raise error_cls(f"provider entry {index} has no valid slug")
        if region not in _ALLOWED_REGIONS:
            raise error_cls(f"provider {slug!r} region must be explicitly US or EU")
        if verified is not True:
            raise error_cls(f"provider {slug!r} lacks explicit zero-retention verification")
        configured.append((slug, region))

    if tuple(configured) != approved_endpoints:
        raise error_cls(
            f"configured {routing_key} providers do not exactly match the approved "
            "ordered ZDR endpoint registry"
        )

    providers = [slug for slug, _region in configured]
    return {
        "provider": {
            "only": providers,
            "order": list(providers),
            "allow_fallbacks": False,
            "data_collection": "deny",
            "zdr": True,
        }
    }


def _deepseek_openrouter_extra_body(config: dict[str, Any]) -> dict[str, Any]:
    return _provider_openrouter_extra_body(
        config,
        routing_key="deepseek_routing",
        error_cls=DeepSeekRoutingPolicyError,
        approved_endpoints=APPROVED_DEEPSEEK_ENDPOINTS,
    )


def _glm_openrouter_extra_body(config: dict[str, Any]) -> dict[str, Any]:
    return _provider_openrouter_extra_body(
        config,
        routing_key="glm_routing",
        error_cls=GlmRoutingPolicyError,
        approved_endpoints=APPROVED_GLM_ENDPOINTS,
    )


def resolve_extra_body(model: str) -> dict[str, Any]:
    """Return the OpenRouter `extra_body` for `model`, or `{}`.

    For any model outside the `deepseek/` and `z-ai/` namespaces, returns `{}`
    WITHOUT reading `pr_review_routing.json` at all — the short-circuit that
    keeps a non-gated override immune to that config's health.

    For a gated model, loads the vendored config and returns the matching
    namespace's provider policy. Raises `DeepSeekRoutingPolicyError` /
    `GlmRoutingPolicyError` (routing policy invalid) or the loader's own
    exceptions (missing file, malformed JSON) uncaught — `pr_review.py` is the
    single place that maps any of these to the gate's fail-closed
    `EXIT_ERROR`, before any network call.
    """
    if is_deepseek_model(model):
        return _deepseek_openrouter_extra_body(_load_routing_config())
    if is_glm_model(model):
        return _glm_openrouter_extra_body(_load_routing_config())
    return {}

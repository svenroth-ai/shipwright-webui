"""Model-identity policy for the Tier-3 PR reviewer's OpenRouter call.

Vendored from the canonical shipwright monorepo — merges
`pr_review_model_policy.py` (the policy) and the `deepseek_routing`-relevant
slice of `external_review_routing.py` (the validation logic) into one
self-contained module, since the WebUI CI runner has no `shared/scripts/lib`
tree to import from (same convention as `pr_review.py` /
`scripts/hooks/anti_ratchet_check.py`).

# canonical-source-repo: https://github.com/svenroth-ai/shipwright
# canonical-source-paths:
#   plugins/shipwright-security/scripts/lib/pr_review_model_policy.py
#   shared/scripts/lib/external_review_routing.py (deepseek_openrouter_extra_body
#     + DeepSeekRoutingPolicyError + APPROVED_DEEPSEEK_ENDPOINTS)
# canonical-source-version: iterate-2026-08-31-pr-review-deepseek-model
#
# THIS FILE MERGES TWO INDEPENDENT CANONICAL SOURCES and is not byte-identical
# to either, so no canonical-source-hash line is claimed (same discipline as
# `pr_review.py` / `pr_review_openrouter.py`). Adaptations:
#   (1) the routing config is a self-contained vendored JSON file
#       (`deepseek_routing.json`, sibling of this module) instead of
#       `shared/config/external_review.json` — the WebUI CI runner has no
#       shared config tree to read from.
#   (2) the config loader (`load_review_config`'s DeepSeek-relevant slice) is
#       inlined here rather than kept in a separate `external_review_config`
#       lib module.

Owns the ONE decision this gate needs beyond a bare model string: whether the
resolved `SHIPWRIGHT_PR_REVIEW_MODEL` is in the DeepSeek vendor namespace and,
if so, must carry the fail-closed ZDR (zero-data-retention) provider-routing
constraint. A non-DeepSeek override (a Sonnet rollback, a one-off experiment)
must resolve to `{}` WITHOUT ever reading `deepseek_routing.json`, so a
broken/absent routing config cannot break PR review for a model that never
needed it (mirrors iterate-2026-08-31-pr-review-deepseek-model, independently
found by both the internal and the external plan review on the canonical
change).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

__all__ = ["DeepSeekRoutingPolicyError", "is_deepseek_model", "resolve_extra_body"]

_ROUTING_CONFIG_PATH = Path(__file__).resolve().parent / "deepseek_routing.json"

# Authorization is code-owned, same as canonical: the vendored config declares
# the active ordered allowlist and its verification metadata, but cannot bless
# an arbitrary slug by labelling it safe. Adding a verified EU endpoint is
# deliberately a code + config + test review, not an unreviewed project
# override.
APPROVED_DEEPSEEK_ENDPOINTS: tuple[tuple[str, str], ...] = (
    ("novita", "US"),
    ("together", "US"),
)
_ALLOWED_REGIONS = frozenset({"US", "EU"})


class DeepSeekRoutingPolicyError(ValueError):
    """The DeepSeek request cannot be routed under the verified ZDR policy."""


def is_deepseek_model(model: str) -> bool:
    """True if `model` names an OpenRouter model in the `deepseek/` namespace.

    Normalized (trimmed, casefolded) and namespace-matched rather than an
    exact-string comparison — a variant suffix (`:free`, `:nitro`) or a
    casing/whitespace difference must still get the ZDR constraint, not
    silently bypass it.
    """
    return model.strip().casefold().startswith("deepseek/")


def _load_routing_config() -> dict[str, Any]:
    return json.loads(_ROUTING_CONFIG_PATH.read_text(encoding="utf-8"))


def _configured_endpoints(config: dict[str, Any]) -> list[dict[str, Any]]:
    routing = config.get("deepseek_routing")
    if not isinstance(routing, dict):
        raise DeepSeekRoutingPolicyError("deepseek_routing is missing or not an object")
    endpoints = routing.get("provider_allowlist")
    if not isinstance(endpoints, list) or not endpoints:
        raise DeepSeekRoutingPolicyError(
            "deepseek_routing.provider_allowlist must be a non-empty list"
        )
    if not all(isinstance(item, dict) for item in endpoints):
        raise DeepSeekRoutingPolicyError("every DeepSeek provider entry must be an object")
    return endpoints


def _deepseek_openrouter_extra_body(config: dict[str, Any]) -> dict[str, Any]:
    """Return the complete provider policy, or raise before network I/O.

    The vendored configuration must match the code-owned approval registry
    exactly, including order. This makes today's outbound body deterministic
    while keeping the declaration intentionally configurable for a future,
    reviewed US/EU ZDR endpoint addition.
    """
    endpoints = _configured_endpoints(config)
    configured: list[tuple[str, str]] = []
    for index, endpoint in enumerate(endpoints):
        slug = endpoint.get("provider")
        region = endpoint.get("region")
        verified = endpoint.get("zero_retention_verified")
        if not isinstance(slug, str) or not slug.strip():
            raise DeepSeekRoutingPolicyError(f"provider entry {index} has no valid slug")
        if region not in _ALLOWED_REGIONS:
            raise DeepSeekRoutingPolicyError(
                f"provider {slug!r} region must be explicitly US or EU"
            )
        if verified is not True:
            raise DeepSeekRoutingPolicyError(
                f"provider {slug!r} lacks explicit zero-retention verification"
            )
        configured.append((slug, region))

    if tuple(configured) != APPROVED_DEEPSEEK_ENDPOINTS:
        raise DeepSeekRoutingPolicyError(
            "configured DeepSeek providers do not exactly match the approved "
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


def resolve_extra_body(model: str) -> dict[str, Any]:
    """Return the OpenRouter `extra_body` for `model`, or `{}`.

    For any model outside the `deepseek/` namespace, returns `{}` WITHOUT
    reading `deepseek_routing.json` at all — the short-circuit that keeps a
    non-DeepSeek override immune to that config's health.

    For a DeepSeek model, loads the vendored config and returns
    `_deepseek_openrouter_extra_body(config)`. Raises `DeepSeekRoutingPolicyError`
    (routing policy invalid) or the loader's own exceptions (missing file,
    malformed JSON) uncaught — `pr_review.py` is the single place that maps
    any of these to the gate's fail-closed `EXIT_ERROR`, before any network
    call.
    """
    if not is_deepseek_model(model):
        return {}
    return _deepseek_openrouter_extra_body(_load_routing_config())

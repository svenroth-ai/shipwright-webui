"""Tests for scripts/ci/pr_review_model_policy.py — the DeepSeek/GLM ZDR gate.

Covers the short-circuit (a model outside both gated namespaces never reads
pr_review_routing.json), namespace matching (not exact-string, which a variant
suffix/casing form would bypass), and fail-closed propagation on a broken
routing config — for both the DeepSeek and GLM arms.

Vendored from the canonical monorepo (plugins/shipwright-security/tests/
test_pr_review_model_policy.py); adapted for the self-contained, vendored-JSON
config this module reads instead of `shared/config/external_review.json`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

CI_DIR = Path(__file__).resolve().parent.parent  # scripts/ci
sys.path.insert(0, str(CI_DIR))

import pr_review_model_policy as P  # noqa: E402

_VALID_DEEPSEEK_CONFIG = {
    "deepseek_routing": {
        "provider_allowlist": [
            {"provider": slug, "region": region, "zero_retention_verified": True}
            for slug, region in P.APPROVED_DEEPSEEK_ENDPOINTS
        ]
    }
}

_VALID_GLM_CONFIG = {
    "glm_routing": {
        "provider_allowlist": [
            {"provider": slug, "region": region, "zero_retention_verified": True}
            for slug, region in P.APPROVED_GLM_ENDPOINTS
        ]
    }
}


class TestIsDeepseekModel:

    @pytest.mark.parametrize("model", [
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-v4-pro:free",
        "DeepSeek/DeepSeek-V4-Pro",
        "  deepseek/deepseek-v4-pro  ",
        "deepseek/deepseek-chat",
    ])
    def test_matches_the_deepseek_namespace(self, model):
        assert P.is_deepseek_model(model) is True

    @pytest.mark.parametrize("model", [
        "anthropic/claude-sonnet-4.6",
        "openai/gpt-5.6-terra",
        "not-deepseek/deepseek-v4-pro",
        "z-ai/glm-5.3",
        "",
    ])
    def test_rejects_everything_else(self, model):
        assert P.is_deepseek_model(model) is False


class TestIsGlmModel:

    @pytest.mark.parametrize("model", [
        "z-ai/glm-5.3",
        "z-ai/glm-5.3:free",
        "Z-AI/GLM-5.3",
        "  z-ai/glm-5.3  ",
    ])
    def test_matches_the_glm_namespace(self, model):
        assert P.is_glm_model(model) is True

    @pytest.mark.parametrize("model", [
        "anthropic/claude-sonnet-4.6",
        "deepseek/deepseek-v4-pro",
        "not-z-ai/glm-5.3",
        "",
    ])
    def test_rejects_everything_else(self, model):
        assert P.is_glm_model(model) is False


class TestResolveExtraBody:

    def test_non_gated_model_returns_empty_without_loading_config(self, monkeypatch):
        def boom(*a, **k):
            raise AssertionError("must not load config for a non-gated model")
        monkeypatch.setattr(P, "_load_routing_config", boom)
        assert P.resolve_extra_body("anthropic/claude-sonnet-4.6") == {}

    def test_deepseek_model_returns_the_zdr_body(self, monkeypatch):
        monkeypatch.setattr(P, "_load_routing_config", lambda: _VALID_DEEPSEEK_CONFIG)
        body = P.resolve_extra_body("deepseek/deepseek-v4-pro")
        assert body["provider"]["only"] == [slug for slug, _ in P.APPROVED_DEEPSEEK_ENDPOINTS]
        assert body["provider"]["zdr"] is True
        assert body["provider"]["data_collection"] == "deny"

    def test_deepseek_variant_form_also_gets_the_zdr_body(self, monkeypatch):
        monkeypatch.setattr(P, "_load_routing_config", lambda: _VALID_DEEPSEEK_CONFIG)
        body = P.resolve_extra_body(" DeepSeek/DeepSeek-V4-Pro:free ")
        assert body["provider"]["zdr"] is True

    def test_glm_model_returns_the_zdr_body(self, monkeypatch):
        monkeypatch.setattr(P, "_load_routing_config", lambda: _VALID_GLM_CONFIG)
        body = P.resolve_extra_body("z-ai/glm-5.3")
        assert body["provider"]["only"] == [slug for slug, _ in P.APPROVED_GLM_ENDPOINTS]
        assert body["provider"]["zdr"] is True
        assert body["provider"]["data_collection"] == "deny"

    def test_glm_variant_form_also_gets_the_zdr_body(self, monkeypatch):
        monkeypatch.setattr(P, "_load_routing_config", lambda: _VALID_GLM_CONFIG)
        body = P.resolve_extra_body("  Z-AI/GLM-5.3:free  ")
        assert body["provider"]["zdr"] is True

    def test_broken_deepseek_routing_config_propagates(self, monkeypatch):
        monkeypatch.setattr(P, "_load_routing_config", lambda: {})
        with pytest.raises(P.DeepSeekRoutingPolicyError):
            P.resolve_extra_body("deepseek/deepseek-v4-pro")

    def test_broken_glm_routing_config_propagates(self, monkeypatch):
        monkeypatch.setattr(P, "_load_routing_config", lambda: {})
        with pytest.raises(P.GlmRoutingPolicyError):
            P.resolve_extra_body("z-ai/glm-5.3")

    def test_glm_and_deepseek_routing_errors_are_distinct_types(self):
        # The generic helper must not blur which family failed — a caller
        # narrowing an except clause on one must not silently swallow the other.
        assert not issubclass(P.GlmRoutingPolicyError, P.DeepSeekRoutingPolicyError)
        assert not issubclass(P.DeepSeekRoutingPolicyError, P.GlmRoutingPolicyError)

    def test_the_vendored_deepseek_config_on_disk_is_valid(self):
        # No monkeypatch: proves the actual shipped pr_review_routing.json
        # resolves cleanly for DeepSeek, not just the in-memory fixture above.
        body = P.resolve_extra_body("deepseek/deepseek-v4-pro")
        assert body["provider"]["only"] == [slug for slug, _ in P.APPROVED_DEEPSEEK_ENDPOINTS]
        assert body["provider"]["allow_fallbacks"] is False

    def test_the_vendored_glm_config_on_disk_is_valid(self):
        # No monkeypatch: proves the actual shipped pr_review_routing.json
        # resolves cleanly for GLM, not just the in-memory fixture above.
        body = P.resolve_extra_body("z-ai/glm-5.3")
        assert body["provider"]["only"] == [slug for slug, _ in P.APPROVED_GLM_ENDPOINTS]
        assert body["provider"]["allow_fallbacks"] is False


def _deep_copy(config):
    import copy
    return copy.deepcopy(config)


@pytest.mark.parametrize(
    "routing_key,error_cls,base_config,mutate",
    [
        (rk, ec, base, mutate)
        for rk, ec, base in [
            ("deepseek_routing", P.DeepSeekRoutingPolicyError, _VALID_DEEPSEEK_CONFIG),
            ("glm_routing", P.GlmRoutingPolicyError, _VALID_GLM_CONFIG),
        ]
        for mutate in [
            lambda c, rk=rk: c.pop(rk),
            lambda c, rk=rk: c[rk].update(provider_allowlist=[]),
            lambda c, rk=rk: c[rk]["provider_allowlist"].reverse(),
            lambda c, rk=rk: c[rk]["provider_allowlist"].pop(),
            lambda c, rk=rk: c[rk]["provider_allowlist"][0].update(region="SG"),
            lambda c, rk=rk: c[rk]["provider_allowlist"][0].update(
                zero_retention_verified=False),
            lambda c, rk=rk: c[rk]["provider_allowlist"][0].pop("zero_retention_verified"),
            lambda c, rk=rk: c[rk]["provider_allowlist"].__setitem__(0, "not-an-object"),
            lambda c, rk=rk: c[rk]["provider_allowlist"][0].pop("provider"),
        ]
    ],
)
def test_changed_or_unverified_provider_config_fails_closed(
        routing_key, error_cls, base_config, mutate):
    config = _deep_copy(base_config)
    mutate(config)
    extra_body_fn = (
        P._deepseek_openrouter_extra_body if routing_key == "deepseek_routing"
        else P._glm_openrouter_extra_body
    )
    with pytest.raises(error_cls):
        extra_body_fn(config)

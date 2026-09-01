"""Tests for scripts/ci/pr_review_model_policy.py — the DeepSeek ZDR gate.

Covers the short-circuit (a non-DeepSeek model never reads
deepseek_routing.json), namespace matching (not exact-string, which a variant
suffix/casing form would bypass), and fail-closed propagation on a broken
routing config.

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

_VALID_CONFIG = {
    "deepseek_routing": {
        "provider_allowlist": [
            {"provider": slug, "region": region, "zero_retention_verified": True}
            for slug, region in P.APPROVED_DEEPSEEK_ENDPOINTS
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
        "",
    ])
    def test_rejects_everything_else(self, model):
        assert P.is_deepseek_model(model) is False


class TestResolveExtraBody:

    def test_non_deepseek_model_returns_empty_without_loading_config(self, monkeypatch):
        def boom(*a, **k):
            raise AssertionError("must not load config for a non-DeepSeek model")
        monkeypatch.setattr(P, "_load_routing_config", boom)
        assert P.resolve_extra_body("anthropic/claude-sonnet-4.6") == {}

    def test_deepseek_model_returns_the_zdr_body(self, monkeypatch):
        monkeypatch.setattr(P, "_load_routing_config", lambda: _VALID_CONFIG)
        body = P.resolve_extra_body("deepseek/deepseek-v4-pro")
        assert body["provider"]["only"] == [slug for slug, _ in P.APPROVED_DEEPSEEK_ENDPOINTS]
        assert body["provider"]["zdr"] is True
        assert body["provider"]["data_collection"] == "deny"

    def test_deepseek_variant_form_also_gets_the_zdr_body(self, monkeypatch):
        monkeypatch.setattr(P, "_load_routing_config", lambda: _VALID_CONFIG)
        body = P.resolve_extra_body(" DeepSeek/DeepSeek-V4-Pro:free ")
        assert body["provider"]["zdr"] is True

    def test_broken_routing_config_propagates(self, monkeypatch):
        monkeypatch.setattr(P, "_load_routing_config", lambda: {})
        with pytest.raises(P.DeepSeekRoutingPolicyError):
            P.resolve_extra_body("deepseek/deepseek-v4-pro")

    def test_the_vendored_config_file_on_disk_is_valid(self):
        # No monkeypatch: proves the actual shipped deepseek_routing.json
        # resolves cleanly, not just the in-memory fixture above.
        body = P.resolve_extra_body("deepseek/deepseek-v4-pro")
        assert body["provider"]["only"] == [slug for slug, _ in P.APPROVED_DEEPSEEK_ENDPOINTS]
        assert body["provider"]["allow_fallbacks"] is False

"""Tests for scripts/ci/pr_review_openrouter.py — the OpenRouter HTTP boundary.

Moved here unchanged from ``test_pr_review_script.py`` when the ADR-117 port
split the boundary out of the tool script (one module per external boundary,
mirroring ``pr_review_gh``). Only the module under test changed; every
assertion is the one that guarded these two functions before the move, which is
the point — a refactor must not be able to quietly relax them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

CI_DIR = Path(__file__).resolve().parent.parent  # scripts/ci
sys.path.insert(0, str(CI_DIR))

import pr_review_openrouter as ORT  # noqa: E402

FAKE_KEY = "ORTESTKEY-not-a-real-credential-0123456789"


# ---------------------------------------------------------------------------
# _post_openrouter — HTTP boundary (urllib monkeypatched)
# ---------------------------------------------------------------------------

class TestPostOpenRouter:

    def test_builds_authorized_json_request(self, monkeypatch):
        captured = {}

        class _FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return json.dumps(
                    {"choices": [{"message": {"content": "{\"decision\":\"approve\"}"}}]}
                ).encode("utf-8")

        def fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["headers"] = {k.lower(): v for k, v in req.header_items()}
            captured["body"] = json.loads(req.data.decode("utf-8"))
            return _FakeResp()

        monkeypatch.setattr(ORT.urllib.request, "urlopen", fake_urlopen)
        data = ORT._post_openrouter(FAKE_KEY, "some/model", [{"role": "user", "content": "hi"}], 30)

        assert captured["url"] == ORT.OPENROUTER_URL
        assert captured["headers"]["authorization"] == f"Bearer {FAKE_KEY}"
        assert captured["body"]["model"] == "some/model"
        assert captured["body"]["response_format"] == {"type": "json_object"}
        assert data["choices"][0]["message"]["content"] == '{"decision":"approve"}'


# ---------------------------------------------------------------------------
# call_openrouter — content extraction + error wrapping (_post_openrouter mocked)
# ---------------------------------------------------------------------------

class TestCallOpenRouter:

    def test_success_extracts_content(self, monkeypatch):
        monkeypatch.setattr(
            ORT, "_post_openrouter",
            lambda k, m, msgs, t: {"choices": [{"message": {"content": "OK"}}]},
        )
        assert ORT.call_openrouter("k", "m", [], 1) == "OK"

    def test_bad_shape_raises_runtime(self, monkeypatch):
        monkeypatch.setattr(ORT, "_post_openrouter", lambda *a: {"unexpected": 1})
        with pytest.raises(RuntimeError):
            ORT.call_openrouter("k", "m", [], 1)

    def test_http_error_wrapped(self, monkeypatch):
        def boom(*a):
            raise ORT.urllib.error.HTTPError("u", 429, "rate limit", {}, None)
        monkeypatch.setattr(ORT, "_post_openrouter", boom)
        with pytest.raises(RuntimeError):
            ORT.call_openrouter("k", "m", [], 1)

    def test_url_error_wrapped(self, monkeypatch):
        def boom(*a):
            raise ORT.urllib.error.URLError("connection refused")
        monkeypatch.setattr(ORT, "_post_openrouter", boom)
        with pytest.raises(RuntimeError):
            ORT.call_openrouter("k", "m", [], 1)

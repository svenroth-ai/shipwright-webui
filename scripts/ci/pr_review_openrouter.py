"""The OpenRouter HTTP boundary for the Tier-3 PR reviewer.

Split out of ``pr_review.py`` — one module per external boundary
(``pr_review_gh`` owns the subprocess one), so the tool script is pure
orchestration and stays inside the source-size guideline, and each boundary
(with its timeout, its error mapping and, here, its Semgrep suppression) is
reviewable on its own.

Stdlib urllib only: the script carries no third-party HTTP dependency and runs
under whatever environment the CI runner's Python resolves.

# canonical-source-repo: https://github.com/svenroth-ai/shipwright
# canonical-source-commit: fee93227c391e3d641aec75fba99eb1ef0908bff
# canonical-source-paths:
#   plugins/shipwright-security/scripts/lib/pr_review_openrouter.py
#   plugins/shipwright-security/scripts/tools/pr_review.py  (the ADR-117 extraction)
# canonical-source-version: iterate-2026-07-27-pr-review-forged-boundary
#   + iterate-2026-07-31-it7a-pr-review-stale-verdict (ADR-117, extraction wording)
#   + iterate-2026-08-31-pr-review-deepseek-model (DEFAULT_MODEL swap +
#     `extra_body` merge, mirroring the monorepo's DeepSeek ZDR routing)
#   + iterate-2026-09-01-pr-review-glm-model (DEFAULT_MODEL swap to GLM 5.3,
#     DeepSeek kept as the named operator-override constant)
#   + iterate-2026-09-03-pr-review-sonnet-default (DEFAULT_MODEL swap to
#     GPT-5.6 Luna after GLM 5.3 was found to silently hang on the shared ZDR
#     provider pool; GLM kept as the named operator-override constant)
# adaptation: NOT byte-identical, so no canonical-source-hash line is claimed
#   (spelled without the leading marker on purpose; `tests/test_accepted_risks_vendored.py`
#   scans for that literal string). Divergences from any single upstream blob:
#   (1) OpenRouter attribution headers (HTTP-Referer / X-Title) name the webui
#   repo; (2) `DEFAULT_TIMEOUT` is 600s, not upstream's 120s — see the comment
#   at its definition for why the size-cap increase requires it.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

__all__ = [
    "DEEPSEEK_MODEL", "GLM_MODEL", "LUNA_MODEL", "DEFAULT_MODEL",
    "DEFAULT_TIMEOUT", "OPENROUTER_URL", "call_openrouter",
]

# Named constants — DEFAULT_MODEL, the ZDR-routing model match in
# pr_review_model_policy.py, and every test/workflow assertion all read these,
# so they cannot drift into separate copies of the same literal. DeepSeek and
# GLM stay fully wired operator overrides (SHIPWRIGHT_PR_REVIEW_MODEL=...)
# after the Luna swap below — never treat "kept as a constant" as dead code.
# Full swap history and rationale (DeepSeek -> GLM 5.3 -> GPT-5.6 Luna; GLM's
# silent-hang availability defect on the shared ZDR provider pool; the
# Luna-vs-Sonnet benchmark/price check): mirrors the canonical shipwright
# monorepo's iterate-2026-09-03-pr-review-sonnet-default.
DEEPSEEK_MODEL = "deepseek/deepseek-v4-pro"
GLM_MODEL = "z-ai/glm-5.3"
LUNA_MODEL = "openai/gpt-5.6-luna"
DEFAULT_MODEL = LUNA_MODEL
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# ONE default for the whole tool — the CLI flag and the direct call share it.
# 120s was sized for a 200k-char cap. The cap is now 1M chars (~250k input
# tokens) and the request is non-streaming, so a single blocking read must cover
# prompt processing AND generation. A socket timeout maps to EXIT_ERROR — still
# fail-closed, but it lands on exactly the large PRs the raise exists to
# unblock, and it returns before any comment is posted.
DEFAULT_TIMEOUT = 600


def _post_openrouter(api_key: str, model: str, messages: list[dict], timeout: int,
                      *, extra_body: dict | None = None) -> dict:
    """POST the chat-completion request and return the parsed JSON body.

    `extra_body` (e.g. a DeepSeek ZDR provider-routing constraint) is merged
    UNDER the transport's own keys — `{**extra_body, **payload}`, not the
    reverse — so a config-derived dict can never overwrite `model`,
    `messages`, or `response_format`, even if it later grows a colliding key.
    """
    payload = {
        **(extra_body or {}),
        "model": model,
        "messages": messages,
        "response_format": {"type": "json_object"},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # OpenRouter attribution headers (optional, recommended).
            "HTTP-Referer": "https://github.com/svenroth-ai/shipwright-webui",
            "X-Title": "Shipwright WebUI PR Review",
        },
        method="POST",
    )
    # OPENROUTER_URL is a fixed `https://` module constant; no user/dynamic input reaches
    # the request URL, so the dynamic-scheme (`file://`) / SSRF concern this Semgrep rule
    # guards against cannot occur here — confirmed false positive, suppressed on the match line.
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        body = resp.read().decode("utf-8")
    return json.loads(body)


def call_openrouter(api_key: str, model: str, messages: list[dict],
                    timeout: int = DEFAULT_TIMEOUT, *,
                    extra_body: dict | None = None) -> str:
    """Call OpenRouter and return the assistant message content string.

    Raises RuntimeError on transport failure (HTTP error, timeout) or an
    unexpected response shape — the caller maps that to exit 2.
    """
    try:
        data = _post_openrouter(api_key, model, messages, timeout, extra_body=extra_body)
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001 — best-effort body read
            pass
        raise RuntimeError(f"OpenRouter HTTP {e.code}: {detail}") from e
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
        raise RuntimeError(f"OpenRouter request failed: {e}") from e
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"unexpected OpenRouter response shape: {e}") from e

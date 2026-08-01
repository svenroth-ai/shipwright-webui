"""The OpenRouter HTTP boundary for the Tier-3 PR reviewer.

Split out of ``pr_review.py`` by the ADR-117 port for the same reason as
``pr_review_gh``: one module per external boundary, so the tool script is pure
orchestration and stays inside the source-size guideline. That guideline was
already the binding constraint here — the previous iterate
(iterate-2026-07-31-two-stage-pr-review) recorded "pr_review.py had grown to 299
with one line of headroom" as a finding, and ADR-117's wiring is what spent it.

Divergence from canonical, stated rather than discovered: canonical keeps these
two functions in the tool. It can afford to, because it carries no vendor
provenance header; this copy does, and a header is not something a vendored file
may trade away for line budget.

# canonical-source-repo: https://github.com/svenroth-ai/shipwright
# canonical-source-commit: 4146a610295e900d01af3865228a0ec9af028918
# canonical-source-paths:
#   plugins/shipwright-security/scripts/tools/pr_review.py  (these four symbols)
# canonical-source-version: iterate-2026-07-31-it7a-pr-review-stale-verdict (ADR-117)
# adaptation: EXTRACTION, not a copy of any upstream file — upstream keeps these
#   four symbols inside the tool. No canonical-source-hash line is claimed (spelled
#   without the marker on purpose; `tests/test_accepted_risks_vendored.py` scans for
#   that literal string), because there is no upstream blob with these bounds to
#   compare against. Recorded here anyway so a future re-vendor of `pr_review.py`
#   can DISCOVER that these symbols moved out — prose in the other file's header
#   is not something a tool can find (Stage-3 review).
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

__all__ = ["DEFAULT_MODEL", "OPENROUTER_URL", "call_openrouter"]


DEFAULT_MODEL = "anthropic/claude-sonnet-4.6"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def _post_openrouter(api_key: str, model: str, messages: list[dict], timeout: int) -> dict:
    """POST the chat-completion request to OpenRouter and return the parsed JSON body.

    Uses stdlib urllib so the script carries no third-party HTTP dependency — it
    runs under whatever environment the CI runner's Python resolves.
    """
    payload = {
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


def call_openrouter(api_key: str, model: str, messages: list[dict], timeout: int = 120) -> str:
    """Call OpenRouter and return the assistant message content string.

    Raises RuntimeError on transport failure (HTTP error, timeout) or an
    unexpected response shape — the caller maps that to exit 2.
    """
    try:
        data = _post_openrouter(api_key, model, messages, timeout)
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

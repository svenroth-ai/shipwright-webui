"""The one chokepoint every PR-controlled path passes through.

Vendored from the canonical shipwright monorepo, where this lives inside
``pr_review_render``. The WebUI has no Python ``shared/``/``plugins/`` tree on
the CI runner, so the reviewer lives in-repo (same convention as
``scripts/hooks/anti_ratchet_check.py``).

# canonical-source-hash: 317f3ec84c70d5c94b027f32809e3af89f4495c70f828abae8d97127f8f96fed
# canonical-source-repo: https://github.com/svenroth-ai/shipwright
# canonical-source-paths:
#   plugins/shipwright-security/scripts/lib/pr_review_render.py
# canonical-source-version: iterate-2026-07-27-pr-review-forged-boundary
# canonical-source-hash = sha256(the canonical file's bytes at the version above)
# adaptation (declared):
#   (a) FILE SPLIT — canonical keeps `safe_path` in `pr_review_render`; the fixes
#       on iterate-2026-07-28-pr-review-parity pushed that file past the 300-line
#       guideline, so the sanitiser (which is the security chokepoint, and which
#       changes for its own reasons) got its own module. `pr_review_render`
#       re-exports it, so every existing call site is unchanged.
#   (b) the class is assembled from explicit CODEPOINTS rather than the literal
#       characters canonical embeds in its regex string (adaptation #7).
#   (c) `_LOCAL_ADDITIONS` widens the alphabet beyond canonical (adaptation #9).

A path name rendered into the PR comment or the model's metadata block comes
from the pull request's own diff, so on an untrusted PR it is attacker-chosen.
Everything that makes such a name inert and bounded lives here.
"""

from __future__ import annotations

import re

__all__ = ["safe_path"]

# Canonical's alphabet, transcribed range by range from
# `plugins/shipwright-security/scripts/lib/pr_review_render.py`, where it is
# written as literal characters inside the regex string. This is the PARITY
# FLOOR: the shipped class must be a superset of it, pinned by
# `test_pr_review_safe_path.test_the_alphabet_covers_canonicals_literal_class`.
_CANONICAL_RANGES = (
    (0x0000, 0x001f),  # C0 - incl. TAB LF VT FF CR and the FS/GS/RS separators
    (0x007f, 0x009f),  # DEL + the rest of C1 - incl. NEL (U+0085)
    (0x0060, 0x0060),  # ` - must not open or close a Markdown code span
    (0x007b, 0x007b),  # { - must not be renderable as a template placeholder
    (0x007d, 0x007d),  # }
    (0x200b, 0x200f),  # zero-width space/non-joiner/joiner + LRM/RLM
    (0x2028, 0x2029),  # LINE SEPARATOR / PARAGRAPH SEPARATOR
    (0x202a, 0x202e),  # bidi embedding + override
    (0x2066, 0x2069),  # bidi isolates
    (0xfeff, 0xfeff),  # BOM / zero-width no-break space
)

# WebUI additions (adaptation #9) - strictly a WIDENING, so the parity floor
# above still holds. Every one is a character that renders as nothing, or as
# something other than its bytes, in the two places these names land: a
# maintainer's PR comment and a tokenizer's prompt. The stated purpose of this
# sanitiser is that "a name that renders differently from its bytes is a name a
# maintainer cannot check against the PR" - canonical's list predates the Tags
# block becoming the standard channel for smuggling invisible ASCII into an LLM
# prompt, and omits the one Bidi_Control character outside its ranges.
# Found by the Stage-3 adversarial pass on iterate-2026-07-28-pr-review-parity.
_LOCAL_ADDITIONS = (
    (0x00ad, 0x00ad),    # SOFT HYPHEN - invisible in most renderers
    (0x061c, 0x061c),    # ARABIC LETTER MARK - the Bidi_Control canonical misses
    (0x2060, 0x2060),    # WORD JOINER
    (0xfe00, 0xfe0f),    # variation selectors
    (0xe0000, 0xe007f),  # Tags block - 128 invisible codepoints that decode as ASCII
    (0xe0100, 0xe01ef),  # variation selectors supplement
)

_UNSAFE_RANGES = _CANONICAL_RANGES + _LOCAL_ADDITIONS

# `re.escape` on every endpoint: nothing in the table needs it today, but a
# future range ending at `]`, `\`, `^` or `-` would otherwise silently
# re-interpret the class rather than extend it.
_UNSAFE_IN_DISPLAY = re.compile(
    "["
    + "".join(re.escape(chr(lo)) if lo == hi
              else f"{re.escape(chr(lo))}-{re.escape(chr(hi))}"
              for lo, hi in _UNSAFE_RANGES)
    + "]"
)

# The metadata block sits OUTSIDE the fence in the user template, so a rendered
# name is unfenced prose in the prompt. `_path_list` bounds how MANY names are
# rendered; this bounds how LONG each one is, so 30 path components chained into
# sentences cannot become ~100KB of attacker-authored text above the fence.
_MAX_RENDERED_PATH = 160

_TRUNCATION_MARKER = "…(truncated)"


def safe_path(path: str) -> str:
    """Render a PR-controlled path as inert, bounded display data.

    The bound is on the RESULT, marker included — reserving the marker's own
    length is what makes ``_MAX_RENDERED_PATH`` the number it claims to be rather
    than that number plus twelve.
    """
    text = _UNSAFE_IN_DISPLAY.sub("?", str(path or ""))
    if len(text) > _MAX_RENDERED_PATH:
        text = text[:_MAX_RENDERED_PATH - len(_TRUNCATION_MARKER)] + _TRUNCATION_MARKER
    return text

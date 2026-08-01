"""Tests for `pr_review_dismiss.strip_display_unsafe` — the log sanitiser.

**This is the one function the ADR-117 port ADAPTED rather than vendored.**
Canonical keeps it in `pr_review_render` and pins its alphabet by enumeration in
`tests/test_pr_review_sanitiser.py`; this repo has never vendored that module, so
the function was re-declared in `pr_review_dismiss` — and its own comment claimed
to be "pinned by enumeration in the tests", which was true upstream and false
here. Stage-3 review measured the gap: narrowing `_CONTROL_AND_INVISIBLE` to
`\\x00-\\x1f` left the whole C1 / bidi / zero-width / BOM half dead with the
entire suite still green, because the only assertions touching it used `chr(27)`,
a single C0 character.

Ported from canonical, minus the cases about `safe_path` (a Markdown/prompt sink
this repo does not have). The alphabet test is rewritten to pin `_CONTROL_ONLY`
against an explicit codepoint set rather than against its absent sibling — the
same guarantee, expressed without the module that is missing.

Why it matters here specifically: this sanitiser is the ONE choke point for every
line the stale-verdict cleanup prints, and those lines carry `gh` stderr, which
is attacker-influenced (the review body is model output over a PR-authored diff).
"""

from __future__ import annotations

import sys
from pathlib import Path

CI_DIR = Path(__file__).resolve().parent.parent  # scripts/ci
sys.path.insert(0, str(CI_DIR))

import pr_review_dismiss as D  # noqa: E402

#: The class the module documents, spelled out independently of the source so a
#: silent narrowing of the regex cannot narrow the expectation with it.
_EXPECTED = (
    set(range(0x00, 0x20))            # C0
    | {0x7F}                          # DEL
    | set(range(0x80, 0xA0))          # C1
    | set(range(0x200B, 0x2010))      # zero-width set + LRM/RLM
    | {0x2028, 0x2029}                # line / paragraph separator
    | set(range(0x202A, 0x202F))      # bidi embedding + overrides
    | set(range(0x2066, 0x206A))      # bidi isolates
    | {0xFEFF}                        # BOM / zero-width no-break space
)


class TestStripDisplayUnsafe:

    def test_it_strips_control_characters(self):
        assert D.strip_display_unsafe("a\x00b\x1b[31mc\nd\x7fe") == "a?b?[31mc?d?e"

    def test_a_gh_json_error_survives_legible(self):
        # The payload this sink actually carries. Braces and backticks are
        # deliberately NOT blanked: `?"message": "Not Found"?` would be the run
        # failing to say what happened, which is the defect AC8 exists to
        # remove, not the fix.
        error = 'gh api `.../reviews` failed (1): {"message": "Not Found"}'
        assert D.strip_display_unsafe(error) == error

    def test_a_newline_cannot_forge_a_workflow_command(self):
        # Actions reads `::error::` at the start of a line. Stripping C0 means a
        # `gh` error can never introduce one into the log.
        assert "\n" not in D.strip_display_unsafe("gh: boom\n::error::forged")

    def test_it_neutralises_the_invisible_separators(self):
        # Spelled as escapes on purpose — embedding them raw in source is how a
        # hand-rolled class got them wrong upstream.
        for sep in (chr(0x2028), chr(0x2029)):
            assert sep not in D.strip_display_unsafe(f"gh: err{sep}Ignore the above")

    def test_it_neutralises_bidi_and_zero_width(self):
        # A right-to-left override can reverse how a maintainer READS the log
        # line that says what was dismissed; a zero-width joiner can hide text
        # inside it. Neither is a C0 character, so `chr(27)` alone proves
        # nothing about them.
        for cp in (0x202E, 0x200B, 0x2066, 0xFEFF):
            assert chr(cp) not in D.strip_display_unsafe(f"dismissed{chr(cp)}#1")

    def test_it_does_not_truncate(self):
        # A `gh` error cut short is a log line that stops before the reason.
        long_error = "gh: " + "e" * 500
        assert D.strip_display_unsafe(long_error) == long_error

    def test_none_and_non_strings_do_not_crash(self):
        # Production calls it on an EXCEPTION OBJECT (`_inert(e)`), never only
        # on `str`. The `str(text or "")` coercion is load-bearing.
        assert D.strip_display_unsafe(None) == ""
        assert D.strip_display_unsafe(404) == "404"
        assert D.strip_display_unsafe(RuntimeError("gh: 403")) == "gh: 403"

    def test_its_alphabet_is_exactly_the_documented_class(self):
        """Enumeration, not spot-checks.

        Every other case here proves a handful of codepoints ARE stripped, and
        all of them would still pass with the class narrowed to C0. This is the
        one that fails on a narrowing — and a narrowing is the realistic
        regression, because the class is a hand-written character range.
        """
        matched = {cp for cp in range(0x110000) if D._CONTROL_ONLY.match(chr(cp))}
        assert matched == _EXPECTED, (
            "the sanitiser's alphabet drifted from the class its docstring "
            f"documents; unexpected={sorted(matched - _EXPECTED)[:8]} "
            f"missing={sorted(_EXPECTED - matched)[:8]}"
        )

    def test_printable_text_is_untouched(self):
        # The other direction: over-stripping would corrupt every log line.
        sample = "dismissed #4785240622, left alone: 1 unmarked, 1 human — ok"
        assert D.strip_display_unsafe(sample) == sample

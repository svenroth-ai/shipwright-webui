"""Fixture tests for the `.semgrepignore` matcher the scope ratchet stands on.

Split from `test_semgrep_channels_scanner.py` (the directive-scanner fixtures)
when that module crossed the 300-line cap; the seam is the two questions the
helpers answer — "which files does Semgrep look at" and "what counts as a
suppression in one".

The matcher implements a SUBSET of gitignore and rejects the rest, so these
fixtures cover every shape it claims AND every shape it refuses. A guard that
silently misreads a pattern would certify the misreading.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from semgrep_channels import (
    UnsupportedPattern,
    classify_pattern,
    excluded,
    live_patterns,
)

# ------------------------------------------------------- the .semgrepignore matcher


@pytest.mark.parametrize(
    ("pattern", "shape"),
    [
        ("*.test.ts", "basename-glob"),
        ("*.spec.tsx", "basename-glob"),
        ("dist/", "any-depth-dir"),
        ("node_modules/", "any-depth-dir"),
        ("client/e2e/", "anchored-dir"),
        # Slash-free, so gitignore matches it at ANY depth — not just the root
        # one this repo happens to have. Classified by shape, not by intent.
        (".shipwright/", "any-depth-dir"),
        ("server/scripts/sdk-poc.ts", "anchored-file"),
    ],
)
def test_classify_pattern_recognises_every_supported_shape(pattern, shape) -> None:
    assert classify_pattern(pattern) == shape


@pytest.mark.parametrize(
    "pattern",
    [
        "!keep-me.ts",          # ordered negation — changes the meaning of the whole file
        "src/**/gen/",          # globstar
        "*.[jt]s",              # character class
        "/anchored-at-root",    # leading slash
        "weird\\escape",        # backslash escape
        "*.test.*",             # two globs — not the single-suffix form
        "plainfile.ts",         # slash-free file: gitignore matches it at ANY depth
    ],
)
def test_classify_pattern_rejects_what_the_matcher_does_not_implement(pattern) -> None:
    """Rejecting is the point: a misread pattern would be CERTIFIED by the ratchet.

    A silently-misinterpreted negation or globstar would report a file as in
    scope while Semgrep excludes it (or the reverse), and the scope ratchet would
    then vouch for the misreading. Fail closed instead. (External plan review,
    G1/O1.)
    """
    with pytest.raises(UnsupportedPattern) as excinfo:
        classify_pattern(pattern)
    # The message must tell a developer what to do, not just what broke.
    assert "Supported shapes" in str(excinfo.value)


def test_excluded_implements_anchoring_and_depth() -> None:
    patterns = ["*.test.ts", "dist/", "client/e2e/", "server/scripts/sdk-poc.ts"]

    # basename glob: any depth, by basename only
    assert excluded("server/src/core/thing.test.ts", patterns)
    assert not excluded("server/src/core/thing.ts", patterns)

    # slash-free directory: matches at ANY depth, not just the root
    assert excluded("client/dist/assets/index.js", patterns)
    assert excluded("dist/index.js", patterns)
    # ...but only as a DIRECTORY component, never as the file itself
    assert not excluded("server/src/dist", patterns)

    # anchored directory: root-relative only
    assert excluded("client/e2e/flows/a.spec.ts", patterns)
    assert not excluded("server/client/e2e/flows/a.spec.ts", patterns)

    # anchored file: exact path, and it does not become a prefix match
    assert excluded("server/scripts/sdk-poc.ts", patterns)
    assert not excluded("server/scripts/copy-assets.mjs", patterns)
    assert not excluded("server/scripts/sdk-poc.ts.bak", patterns)


def test_basename_matching_is_case_sensitive() -> None:
    """`fnmatchcase`, not `fnmatch`: the latter is case-insensitive on Windows.

    This repo is developed on Windows and ENFORCED on a Linux runner. A matcher
    that answers differently in the two places is worse than no matcher.
    (Stage-2 code review, F5.)
    """
    assert excluded("src/a.test.ts", ["*.test.ts"])
    assert not excluded("src/a.TEST.ts", ["*.test.ts"])


def test_live_patterns_ignores_comments_and_blank_lines(tmp_path: Path) -> None:
    (tmp_path / ".semgrepignore").write_text(
        "# a comment\n\n*.test.ts\n   \n  dist/  \n# trailing note\n",
        encoding="utf-8",
    )
    assert live_patterns(tmp_path) == ["*.test.ts", "dist/"]

"""Fixture tests for the discovery the two Semgrep ratchets stand on.

The sibling ratchets assert that the LIVE tree equals a pinned set. That proves
the guard works today; it does not protect the guard from itself. A regression in
`live_patterns`, `excluded` or `directives` that made discovery return less would
leave both ratchets green while newly added suppressions became invisible — the
one failure this design cannot tolerate. (External plan review, O5.)

So every claim the ratchets rely on is exercised here against temp-dir fixtures,
through the SAME production helpers, in both directions.

No marker literal appears in this file — not in a comment, not in a docstring.
Everything is built from `_STEM`, for the reason `semgrep_channels.py` documents:
`scripts/ci/tests/` is in scan scope, and the scanner is deliberately
language-blind, so a literal anywhere would make this file its own unregistered
suppression site. Two docstrings here DID carry one until the parser was made
Semgrep-faithful, and the ratchet caught them itself.

Sibling: `test_semgrep_ignore_matcher.py` covers the `.semgrepignore` matcher.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from semgrep_channels import directives, in_scan_scope, tracked_files

_STEM = "no" + "sem"
_LONG = _STEM + "grep"
_RULE = "javascript.lang.security.audit.detect-non-literal-regexp"


def _write(tmp_path: Path, rel: str, body: str) -> Path:
    path = tmp_path / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    return path


def _ids(path: Path) -> list[str]:
    return [rule_id for (_, _, rule_id) in directives(path)]


# ------------------------------------------------------------- directive discovery


def test_a_named_directive_is_found_in_both_comment_syntaxes(tmp_path: Path) -> None:
    ts = _write(tmp_path, "a.ts", f"const re = build(p); // {_LONG}: {_RULE}\n")
    py = _write(tmp_path, "a.py", f"resp = get(u)  # {_LONG}: {_RULE}\n")
    for path in (ts, py):
        found = directives(path)
        assert len(found) == 1, found
        line_no, _text, rule_id = found[0]
        assert (line_no, rule_id) == (1, _RULE)


def test_the_legacy_short_stem_is_found_too(tmp_path: Path) -> None:
    """The short spelling is the original and is still honoured.

    Missing it would be a FALSE NEGATIVE — a working directive the ratchet cannot
    see — which is the only failure direction that voids this guard.
    (External plan review, G4.)
    """
    ts = _write(tmp_path, "a.ts", f"spawn(x); // {_STEM}: {_RULE}\n")
    assert _ids(ts) == [_RULE]


def test_the_marker_match_is_case_insensitive(tmp_path: Path) -> None:
    """Semgrep's inline matcher ignores case, so an upper-case one still bites.

    Matching only lower-case would leave a WORKING directive invisible — the
    same class as the missing short stem. The captured rule id stays
    case-SENSITIVE, because Semgrep rule ids are. (Stage-2 code review, F1.)
    """
    for marker in (_LONG.upper(), _STEM.upper(), _LONG.capitalize()):
        path = _write(tmp_path, f"{marker}.ts", f"spawn(x); // {marker}: {_RULE}\n")
        assert _ids(path) == [_RULE], marker


def test_the_marker_is_not_matched_inside_a_longer_token(tmp_path: Path) -> None:
    """`.json` is a SCANNED extension, so noise must not read as a suppression.

    Without an identifier boundary the short stem matches inside any word
    containing it — a base64 blob in a JSON fixture would eventually turn the
    build red for nothing. The leading boundary matters too: a marker glued to a
    preceding identifier character must not read as a directive.
    """
    noisy = _write(
        tmp_path,
        "a.json",
        '{"blob": "AB' + _STEM + 'antic", "other": "x' + _LONG + ': rule.id"}\n',
    )
    assert directives(noisy) == []


def test_a_bare_directive_is_reported_with_no_rule(tmp_path: Path) -> None:
    """The most dangerous shape: it silences EVERY rule on the line."""
    ts = _write(tmp_path, "a.ts", f"spawn(x); // {_LONG}\n")
    assert _ids(ts) == [""]


def test_multiple_ids_register_separately_however_they_are_separated(
    tmp_path: Path,
) -> None:
    """Semgrep tokenizes the tail on commas AND whitespace; so must this.

    A regex capturing only the first comma-run would let
    `<marker>: blessed.rule other.rule` register just the blessed one, leaving
    the pinned map unchanged while Semgrep honoured both — a working evasion
    against the exact protection the count-pinning exists for.
    (Stage-2 code review, F4.)
    """
    commas = _write(tmp_path, "a.ts", f"x(); // {_LONG}: rule.one,rule.two\n")
    assert sorted(_ids(commas)) == ["rule.one", "rule.two"]

    spaces = _write(tmp_path, "b.ts", f"x(); // {_LONG}: rule.one rule.two\n")
    assert sorted(_ids(spaces)) == ["rule.one", "rule.two"]

    # A block-comment terminator must not become a bogus third id.
    block = _write(tmp_path, "c.ts", f"x(); /* {_LONG}: rule.one */\n")
    assert _ids(block) == ["rule.one"]


def test_a_malformed_rule_id_makes_the_whole_directive_rule_less(
    tmp_path: Path,
) -> None:
    """A partly parseable tail is exactly where a semantic change would hide.

    So any malformed token voids the whole directive rather than registering the
    part that happened to parse. (Stage-2 code review, O4/F4.)
    """
    bad = _write(tmp_path, "a.ts", f"x(); // {_LONG}: !!!\n")
    assert _ids(bad) == [""]

    # Trailing prose parses as ids and is therefore UNREGISTERED — still red,
    # which is the safe direction. The repo convention puts the justification on
    # its own line above, not after the rule.
    prose = _write(tmp_path, "b.ts", f"x(); // {_LONG}: see ADR-067 for why\n")
    assert sorted(_ids(prose)) == ["ADR-067", "for", "see", "why"]


def test_python_is_scanned_line_by_line_exactly_like_every_other_language(
    tmp_path: Path,
) -> None:
    """Semgrep does not parse comments, and neither does this.

    An earlier version used `tokenize` for `.py` so that docstring prose would
    not count. That was a strict SUBSET of Semgrep's behaviour: Semgrep honours a
    marker inside a Python STRING on a finding's line, so a real suppression
    could hide there — the false-negative class the design rejects for every
    other language. The vendored module that cannot be reworded is handled by an
    explicit, rot-guarded exemption instead. (Stage-2 code review, F2.)
    """
    # The marker sits on its own line INSIDE a docstring — a STRING token, which
    # the old tokenize path skipped entirely and Semgrep would have honoured.
    doc = _write(tmp_path, "a.py", f'"""Doc.\n\nMentions {_LONG}: {_RULE}\n"""\n')
    assert _ids(doc) == [_RULE]

    literal = _write(tmp_path, "b.py", f'HEADERS = {{"x": "{_LONG}"}}\n')
    assert _ids(literal) == [""]


def test_a_marker_in_a_typescript_string_is_reported_not_skipped(tmp_path: Path) -> None:
    """DELIBERATE, and pinned here so it stays a choice rather than folklore.

    A marker inside a string literal surfaces as a rule-less directive and turns
    the build red, asking the author to move it. That is the FAIL-SAFE direction:
    the alternative — extracting comments per language — fails toward not seeing
    a real suppression, and an unseen suppression is the one outcome that makes
    the ratchet worthless. (External plan review, G2/O2 — rejected with reasons.)
    """
    ts = _write(tmp_path, "a.ts", f'const doc = "write {_LONG} to silence a rule";\n')
    assert _ids(ts) == [""]


# ------------------------------------------------------------- end-to-end discovery


def test_in_scan_scope_honours_the_ignore_file_of_the_repo_it_is_given(
    tmp_path: Path,
) -> None:
    """The scope filter and the directive scan compose, on a real git tree.

    This is the join the ratchets depend on: a file excluded from the scan must
    also drop out of suppression discovery, or the two channels disagree.

    `core.excludesFile=` is load-bearing, not hygiene: a developer's global
    gitignore containing `vendor/` or `*.test.ts` (both common) would stop
    `git add` from tracking those fixtures, and the two negative assertions would
    then pass for the WRONG reason — a vacuous pass in the one test that proves
    scope and directive discovery compose. (Stage-2 code review, F10.)
    """
    git = ["git", "-c", "core.excludesFile=", "-c", "init.defaultBranch=main"]
    subprocess.run([*git, "init", "-q", str(tmp_path)], check=True)
    _write(tmp_path, ".semgrepignore", "# fixture\n*.test.ts\nvendor/\n")
    _write(tmp_path, "src/keep.ts", f"x(); // {_LONG}: {_RULE}\n")
    _write(tmp_path, "src/keep.test.ts", f"x(); // {_LONG}: {_RULE}\n")
    _write(tmp_path, "vendor/dep.ts", f"x(); // {_LONG}: {_RULE}\n")
    subprocess.run([*git, "-C", str(tmp_path), "add", "-A"], check=True)

    # Positive control FIRST: without it, both negatives below could pass simply
    # because nothing was tracked at all.
    assert set(tracked_files(tmp_path)) == {
        ".semgrepignore",
        "src/keep.ts",
        "src/keep.test.ts",
        "vendor/dep.ts",
    }

    in_scope = in_scan_scope(tmp_path)
    assert "src/keep.ts" in in_scope
    assert "src/keep.test.ts" not in in_scope
    assert "vendor/dep.ts" not in in_scope

    # Adding ONE exclusion line REMOVES a file from suppression discovery — the
    # whole reason the scope channel needs a ratchet of its own, and not just
    # the per-site one.
    _write(tmp_path, ".semgrepignore", "# fixture\n*.test.ts\nvendor/\nsrc/keep.ts\n")
    assert "src/keep.ts" not in in_scan_scope(tmp_path)

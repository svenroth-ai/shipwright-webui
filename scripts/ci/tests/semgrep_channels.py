"""Discovery for the two Semgrep suppression channels the register gate cannot see.

NOT a test module and NOT vendored — it carries no provenance header, so
`test_accepted_risks_vendored.py`'s reverse-drift guard ignores it (that guard
also skips `tests/` outright). Same role as `accepted_risks_paths.py`, for a
different subject.

Two channels, both live in this repo and neither reconcilable against
`shipwright_accepted_risks.yaml` (see the ratchet modules for WHY registering
them was rejected): the scan-SCOPE exclusion list `.semgrepignore`, and inline
per-site suppression directives in scanned source.

THE MARKER MUST NEVER APPEAR AS A LITERAL ANYWHERE IN THIS FILE OR ITS SIBLINGS
— not in a comment, not in a docstring. It is assembled from `_STEM` at import
time. These modules live under `scripts/ci/tests/`, which `.semgrepignore` does
not exclude, so a literal makes the file its own unregistered suppression site,
and a self-exemption is exactly the hole a suppression ratchet must not have.
NOT THEORETICAL: the first version put both spellings in a `#:` comment below and
would have turned CI red on the commit that introduced it — the new files were
still UNTRACKED and discovery reads `git ls-files`. Falsify with the files staged
(`git add -N`), or you falsify against a tree excluding the thing under test.
(Stage-1 spec review.)

PARSING — FAITHFUL TO SEMGREP, NOT TO THE LANGUAGE. Every scanned file is read
LINE BY LINE, in every language including Python, and a marker line that does not
parse as a rule-naming directive is a VIOLATION rather than a shrug. Semgrep does
not parse comments at all (it cannot — it is multi-language); it regex-matches
the marker against a finding's raw line, case-insensitively, accepting the short
stem as well as the long one. Anything narrower than that is a strict SUBSET of
Semgrep's behaviour, and every gap in the subset is a working suppression the
guard cannot see. An earlier version used `tokenize` for `.py`, calling COMMENT
tokens "the exact answer"; it re-opened that class inside `scripts/ci/` and
`scripts/hooks/` — the CI trust boundary. So a marker in a string literal now
turns the build red and asks the author to move it: annoying, rare, and the safe
direction. The one file that cannot comply gets an explicit, rot-guarded
exemption below, never an invisible parser asymmetry.
(External plan review G4; Stage-2 review F1/F2; Stage-3 doubt review D-1/D-2/D-3.)
"""

from __future__ import annotations

import re
import subprocess
from fnmatch import fnmatchcase
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SEMGREPIGNORE = REPO_ROOT / ".semgrepignore"

#: Rationale floor for both channel registries: long enough that "legacy" alone
#: does not pass. Audit metadata, NOT an approval control — the approval control
#: is that both guarded surfaces are Tier-3a sensitive paths in pr-review-run.yml.
MIN_RATIONALE = 40

#: Assembled, never written literally — see the module docstring.
_STEM = "no" + "sem"

#: The id grammar is explicit and CLOSED: a permissive tail would swallow
#: trailing prose into the "rule id" and let a semantic change hide behind an
#: unchanged pinned map. (External plan review, O4.)
_RULE_ID_RE = re.compile(r"[A-Za-z0-9._-]+")

#: Identifier boundaries on BOTH sides: without the trailing one the short stem
#: matches inside any word containing it (and `.json` is scanned, so a base64
#: blob would eventually turn the build red for nothing); without the leading
#: one, a marker glued to a preceding identifier character still reads as a
#: directive. Fail-safe is not fail-noisy. Fixtured both ways.
_LEAD = r"(?<![A-Za-z0-9_])"
_TAIL = r"(?![A-Za-z0-9_])"
_MARK = _STEM + r"(?:grep)?"

MARKER_RE = re.compile(_LEAD + _MARK + _TAIL, re.IGNORECASE)

#: Comment terminators. Unstripped, `/* <marker>: rule */` registers `*/` as an id.
_COMMENT_END_RE = re.compile(r"\*/|-->")

#: (repo-relative path, 1-based line) -> why this marker line is NOT a directive.
#: The ONLY exemptions, and both are in a VENDORED module: byte-identical to
#: upstream below its header, so its prose cannot be reworded here and its line
#: numbers cannot drift without a deliberate re-vendor. Every one of those
#: premises is ENFORCED, not assumed, by
#: `test_semgrep_ratchet_integrity.test_the_prose_exemptions_cannot_become_a_self_service_bypass`
#: — vendored-only, rule-less-only, and a pinned entry count.
PROSE_EXEMPT: dict[tuple[str, int], str] = {
    ("scripts/ci/accepted_risk_scan.py", 12):
        "Vendored, byte-identical below the header, so the prose cannot be "
        "reworded here. Inert: docstring text, no finding on the line.",
    ("scripts/ci/accepted_risk_scan.py", 239):
        "Same vendored module, same reasoning: docstring prose describing the "
        "channel, with no finding on the line for it to suppress.",
}


class UnsupportedPattern(ValueError):
    """A `.semgrepignore` line whose semantics this matcher does not implement."""

    def __init__(self, pattern: str) -> None:
        super().__init__(
            f"{pattern!r} in .semgrepignore uses a construct this matcher does "
            "not implement. Supported shapes: '*.ext' (basename glob), 'dir/' "
            "(directory at any depth), 'a/b/' (anchored directory), "
            "'a/b/c.ext' (anchored file). A negation, '**', a character class, "
            "a leading '/' or a backslash escape is REJECTED rather than "
            "silently misread — a misread pattern would be certified by the "
            "scope ratchet as if it had been understood. Rewrite it in a "
            "supported shape, or extend classify_pattern() AND its fixtures."
        )
        self.pattern = pattern


def live_patterns(repo_root: Path | None = None) -> list[str]:
    """Non-comment, non-blank lines of `.semgrepignore`, in file order."""
    path = (repo_root / ".semgrepignore") if repo_root else SEMGREPIGNORE
    return [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def _is_basename_glob(pattern: str) -> bool:
    """`*.test.ts` — a single leading `*` on a slash-free, non-directory name."""
    return (
        pattern.startswith("*.")
        and pattern.count("*") == 1
        and "/" not in pattern
        and set("![]\\").isdisjoint(pattern)
    )


def classify_pattern(pattern: str) -> str:
    """One of the four shapes this matcher implements, or raise.

    REJECTING the rest is the point. Using `pathspec` instead was considered and
    rejected: it is a new CI dependency (both jobs install only pytest + PyYAML,
    so adding it means editing a workflow and dragging the CI trust boundary into
    this change) and it implements GIT's semantics, not Semgrep's, so it would
    not buy parity either. (External plan review, G1/O1.)
    """
    if _is_basename_glob(pattern):
        return "basename-glob"
    # Everything below is a plain path. Any glob/negation/escape metacharacter
    # left at this point is a construct this matcher does not implement.
    if pattern.startswith("/") or not set("!*[]\\").isdisjoint(pattern):
        raise UnsupportedPattern(pattern)
    if "/" in pattern.rstrip("/"):
        return "anchored-dir" if pattern.endswith("/") else "anchored-file"
    if pattern.endswith("/"):
        return "any-depth-dir"
    raise UnsupportedPattern(pattern)


def excluded(rel_path: str, patterns: list[str]) -> bool:
    """Is `rel_path` (repo-relative, forward slashes) out of Semgrep's scan scope?

    `fnmatchcase`, not `fnmatch`: the latter applies `os.path.normcase`, which is
    case-INSENSITIVE on Windows and case-SENSITIVE on Linux. This repo is
    developed on one and enforced on the other, and a guard that says which files
    Semgrep scans must not answer differently in the two. (Stage-2 review, F5.)
    """
    parts = rel_path.split("/")
    for pattern in patterns:
        shape = classify_pattern(pattern)
        bare = pattern.rstrip("/")
        if shape == "basename-glob":
            if fnmatchcase(parts[-1], bare):
                return True
        elif shape == "any-depth-dir":
            # gitignore: a slash-free `dist/` matches a directory of that name at
            # ANY depth, so `client/dist/x.js` is excluded too.
            if bare in parts[:-1]:
                return True
        elif shape == "anchored-dir":
            if rel_path.startswith(bare + "/"):
                return True
        elif shape == "anchored-file":
            if rel_path == bare:
                return True
    return False


def tracked_files(repo_root: Path | None = None) -> list[str]:
    """Every tracked path, repo-relative with forward slashes.

    `git ls-files` rather than a filesystem walk: it is what CI checks out, it
    cannot pick up untracked scratch files, and it needs no ignore handling of
    its own. `-z` + `core.quotePath=false` because the default output C-QUOTES
    any non-ASCII name (`"client/e2e/caf\\303\\251.spec.ts"`); the surrounding
    quotes break both the anchored-prefix and the basename-glob match, so such a
    file would silently stay "in scope" under a nonsense suffix.
    (Stage-2 code review, F8.)
    """
    root = repo_root or REPO_ROOT
    out = subprocess.run(
        ["git", "-C", str(root), "-c", "core.quotePath=false", "ls-files", "-z"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [name for name in out.split("\0") if name]


def in_scan_scope(repo_root: Path | None = None) -> list[str]:
    """Tracked files Semgrep is NOT told to skip. Extension-agnostic."""
    root = repo_root or REPO_ROOT
    patterns = live_patterns(root)
    # Classify every pattern ONCE, up front. `excluded()` short-circuits on the
    # first match, so a later unsupported pattern could otherwise go unclassified
    # for every file — and an unsupported pattern must fail loudly regardless of
    # which file happens to be tested first.
    for pattern in patterns:
        classify_pattern(pattern)
    return [f for f in tracked_files(root) if not excluded(f, patterns)]


def has_shebang(path: Path) -> bool:
    """Does this file start with `#!`?

    Semgrep's language guesser falls back to the shebang for a file with no
    extension, so `scripts/hooks/pre-commit` IS analysed as bash. Classifying
    every extensionless file as "not source" would have skipped it — and it is
    the bloat anti-ratchet gate, executable, and behind the Tier-3a
    `scripts/hooks` review path. (Stage-2 code review, F3.)
    """
    try:
        with path.open("rb") as handle:
            return handle.read(2) == b"#!"
    except OSError:
        return False


def parse_line(text: str) -> list[str] | None:
    """`None` = no marker. `[]` = marker(s) naming no rule. Otherwise every id.

    EVERY marker occurrence on the line is parsed, not just the first with a
    colon, and one bare marker anywhere makes the whole line rule-less. Both
    halves are earned:

    * `<marker>, ADR-067 - <marker>: blessed.rule` — Semgrep matches the FIRST
      occurrence, finds no `:ids`, and applies the BLANKET form silencing every
      rule on the line; a first-colon-wins parse saw only the blessed id at its
      pinned count and stayed green. (Stage-3 doubt review, D-2.)
    * `/* <marker>: blessed */ /* <marker>: second */` — truncating at the first
      comment terminator discarded the second directive entirely. (D-3.)

    The tail is split on commas AND whitespace, the way Semgrep tokenizes it,
    and ANY malformed token voids the whole directive: a partly parseable tail
    is exactly where a semantic change would hide. (Stage-2 review, F4/O4.)
    """
    marks = list(MARKER_RE.finditer(text))
    if not marks:
        return None
    ids: list[str] = []
    for index, mark in enumerate(marks):
        stop = marks[index + 1].start() if index + 1 < len(marks) else len(text)
        segment = _COMMENT_END_RE.split(text[mark.end():stop])[0]
        colon = re.match(r"\s*:", segment)
        if not colon:
            return []  # a bare marker — the blanket form
        tokens = [tok for tok in re.split(r"[,\s]+", segment[colon.end():].strip()) if tok]
        if not tokens or any(not _RULE_ID_RE.fullmatch(tok) for tok in tokens):
            return []
        ids.extend(tokens)
    return ids


def _relative(path: Path) -> str | None:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return None

def directives(path: Path) -> list[tuple[int, str, str]]:
    """`(line_no, raw_text, rule_id)` for every suppression directive in `path`.

    A candidate line that carries the marker but names no rule is returned with
    `rule_id = ""`. Callers must treat that as a failure, not skip it: the bare
    form silences EVERY rule on the line and is the most dangerous shape this
    channel can take.
    """
    source = path.read_text(encoding="utf-8", errors="replace")
    rel = _relative(path)
    found: list[tuple[int, str, str]] = []
    # `.split("\n")`, NOT `.splitlines()`. The latter also breaks on \v \f \x1c
    # \x1d \x1e \x85 U+2028 U+2029, which Semgrep's line reader does not — so
    # `<marker>: blessed.rule\x0csecond.rule` was ONE line to Semgrep (both ids
    # honoured) and TWO to this scanner, the second carrying no marker and thus
    # invisible, with the blessed count unchanged. `read_text` already
    # normalises CR/CRLF. (Stage-3 doubt review, D-1.)
    for line_no, text in enumerate(source.split("\n"), 1):
        rule_ids = parse_line(text)
        if rule_ids is None:
            continue
        if rel is not None and (rel, line_no) in PROSE_EXEMPT:
            continue
        if not rule_ids:
            found.append((line_no, text.strip(), ""))
            continue
        found.extend((line_no, text.strip(), rule_id) for rule_id in rule_ids)
    return found

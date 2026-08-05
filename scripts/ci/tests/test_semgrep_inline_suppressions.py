"""RATCHET over the inline per-site Semgrep suppression channel.

The second of the two channels `accepted_risks_cli.py check` cannot see (the
first is `.semgrepignore` — `test_semgrep_scan_scope.py`). A directive silences
a real finding at a real line, with no expiry and nothing else able to report it.

WHY A RATCHET AND NOT REGISTER ENTRIES. Decided after a Codex cross-check
(triage trg-ab54e3d1). Inline directives have no matching entry type in
`shipwright_accepted_risks.yaml`'s vocabulary at all, and the shared tooling
documents that treating them as if they did is a misreading; every one of these
is a FALSE POSITIVE rather than an accepted risk, so registering them would
create perpetual-renewal entries with no security value. A genuine risk being
accepted is a different thing and still belongs in the register.

The set is pinned as `(file, rule) -> count`. COUNTS are pinned too, so a second
directive for an already-listed pair is a change that must be justified as well —
without that, the easiest way to add a suppression would be to add it beside one
that is already blessed.

Discovery, the two directive stems, the rule-id grammar and the direction the
parser fails in all live in `semgrep_channels.py`; which files it reads at all
lives in `semgrep_scan_surface.py`.
`test_semgrep_channels_scanner.py` drives those same helpers against fixtures,
so a regression in discovery cannot leave this module green while it quietly
stops seeing anything.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

from semgrep_channels import MIN_RATIONALE, REPO_ROOT, directives, in_scan_scope
from semgrep_scan_surface import SCANNED_EXTENSIONS, UNSCANNED_EXTENSIONS, is_scanned

#: Shared positive control for the exemption-integrity test. Keeping this key
#: beside the registry means a future relocation has one source of truth: the
#: inline ratchet reports the move, while the integrity test still proves that
#: exempted prose disappears without hiding a real directive.
INLINE_POSITIVE_CONTROL = (
    "scripts/ci/pr_review_openrouter.py",
    "python.lang.security.audit.dynamic-urllib-use-detected."
    "dynamic-urllib-use-detected",
)

#: (repo-relative file, semgrep rule id) -> (exact count, why it is a FALSE
#: POSITIVE).
INLINE_SUPPRESSIONS: dict[tuple[str, str], tuple[int, str]] = {
    INLINE_POSITIVE_CONTROL: (
        1,
        "The URL is the OpenRouter completions endpoint composed by this module; "
        "it is never attacker-supplied. The rule flags any non-literal urlopen, "
        "which every HTTP client trips by construction. Relocated from "
        "pr_review.py by #343 (ADR-117 port) — a pure move, same rule, same count.",
    ),
    (
        "server/src/core/actions-schema-validator.ts",
        "javascript.lang.security.audit.detect-non-literal-regexp."
        "detect-non-literal-regexp",
    ): (
        2,
        "Compiles a pattern out of the TRUSTED bundled action schema, not user "
        "input. That schema ships with the server; a hostile pattern in it would "
        "mean the artifact itself is compromised, which this rule cannot help with.",
    ),
    (
        "server/src/core/parameter-resolver.ts",
        "javascript.lang.security.audit.detect-non-literal-regexp."
        "detect-non-literal-regexp",
    ): (
        1,
        "Compiles a placeholder pattern from the trusted action definition, not "
        "from request data. Same reasoning as actions-schema-validator.ts.",
    ),
    (
        "server/src/core/parameter-resolver.ts",
        "generic.unicode.security.bidi.contains-bidirectional-characters",
    ): (
        1,
        "The bidirectional characters ARE the defence: this is the regex that "
        "strips bidi-injection characters out of resolved parameters. The rule "
        "flags the very literal it needs in order to do that.",
    ),
    (
        "server/src/terminal/routes.ts",
        "javascript.lang.security.audit.spawn-shell-true.spawn-shell-true",
    ): (
        2,
        "`ptyManager.spawn()`'s `shell` option is a whitelisted binary NAME "
        "(ADR-067 allowlist), not child_process's boolean flag; the rule matches "
        "on the option name alone. Also pinned by "
        "server/src/test/no-shell-true-spawn.test.ts, which additionally reaches "
        "into bootstrapper/ (not a vitest workspace) — deliberate duplication "
        "across two different CI jobs, kept per Chesterton-Fence.",
    ),
    (
        "server/src/terminal/ws-upgrade-handler.ts",
        "javascript.lang.security.audit.spawn-shell-true.spawn-shell-true",
    ): (
        1,
        "Same ADR-067 pty allowlist as terminal/routes.ts: a whitelisted shell "
        "binary NAME, not child_process's boolean flag.",
    ),
}


def _discovered() -> tuple[dict[tuple[str, str], int], list[str]]:
    """`(file, rule) -> count` over scanned files, plus any rule-less markers."""
    counts: Counter[tuple[str, str]] = Counter()
    unnamed: list[str] = []
    for rel in in_scan_scope():
        if not is_scanned(rel):
            continue
        for line_no, text, rule_id in directives(REPO_ROOT / rel):
            if rule_id:
                counts[(rel, rule_id)] += 1
            else:
                unnamed.append(f"{rel}:{line_no}  {text[:100]}")
    return dict(counts), unnamed


def test_inline_suppressions_match_the_pinned_set() -> None:
    """Both directions, counts included."""
    discovered, _ = _discovered()
    pinned = {key: count for key, (count, _) in INLINE_SUPPRESSIONS.items()}
    mismatched = {
        key: f"live={discovered[key]} pinned={pinned[key]}"
        for key in set(discovered) & set(pinned)
        if discovered[key] != pinned[key]
    }
    assert discovered == pinned, (
        "the inline suppression set has drifted.\n"
        f"  live but NOT pinned : {sorted(set(discovered) - set(pinned))}\n"
        f"  pinned but NOT live : {sorted(set(pinned) - set(discovered))}\n"
        f"  count mismatches    : {mismatched}\n"
        "An inline directive silences a real finding at a real line, with no "
        "expiry and nothing else able to see it. Add the (file, rule) entry with "
        "a reason the finding is a FALSE POSITIVE — or, if it is a genuine risk "
        "being accepted, that belongs in shipwright_accepted_risks.yaml instead."
    )


def test_every_inline_suppression_carries_a_rationale() -> None:
    thin = sorted(
        key
        for key, (_, rationale) in INLINE_SUPPRESSIONS.items()
        if len(rationale.strip()) < MIN_RATIONALE
    )
    assert not thin, (
        f"these suppressions have no usable rationale: {thin}.\n"
        "Say why the finding is a false positive, or point at the ADR that does."
    )


def test_every_directive_names_the_rule_it_silences() -> None:
    """The bare form silences EVERY rule on the line — it must not enter unseen."""
    _, unnamed = _discovered()
    assert not unnamed, (
        "every suppression must NAME THE RULE it silences; these lines do not:\n  "
        + "\n  ".join(unnamed)
        + "\nA bare directive silences every rule on that line, so it can hide a "
        "finding nobody chose to accept. Name the rule: `<marker>: <rule-id>`.\n"
        "If the line is PROSE that merely mentions the syntax, it still has to "
        "move or be reworded: in a SCANNED file any marker is treated as a "
        "directive on purpose, because the alternative (parse comments per "
        "language) fails toward not seeing a real suppression. See "
        "semgrep_channels.py."
    )


def test_every_in_scope_extension_is_classified() -> None:
    """A new language must not land in a blind spot unannounced.

    The scanner reads an extension allowlist. Left unguarded, the first `.go`,
    `.rb` or `.tf` file in this repo would be analysed by Semgrep and ignored
    here, so a directive in it would be invisible. (External plan review, O3.)
    """
    present = {Path(rel).suffix.lower() for rel in in_scan_scope()}
    unclassified = sorted(present - set(SCANNED_EXTENSIONS) - set(UNSCANNED_EXTENSIONS))
    assert not unclassified, (
        "these file types are in Semgrep's scan scope but this ratchet has no "
        f"policy for them: {unclassified}.\n"
        "Decide, in this change: does Semgrep analyse them (add to "
        "SCANNED_EXTENSIONS, and the directive ratchet starts covering them) or "
        "not (add to UNSCANNED_EXTENSIONS with the reason a directive there "
        "would suppress nothing)?"
    )
    overlap = sorted(set(SCANNED_EXTENSIONS) & set(UNSCANNED_EXTENSIONS))
    assert not overlap, f"classified BOTH scanned and unscanned: {overlap}"


def test_the_scanner_actually_reads_files() -> None:
    """Floor guard: broken discovery must fail, not pass vacuously.

    Without this, a bad checkout or a wrong repo root would make the ratchet
    above trivially true — the failure mode that hides a regression while
    reporting green. These are FLOORS, not expected values.
    """
    in_scope = in_scan_scope()
    assert len(in_scope) > 300, (
        f"only {len(in_scope)} tracked files are in scan scope. Discovery is "
        "broken; the ratchet above would be passing on an empty set."
    )
    scanned = [r for r in in_scope if is_scanned(r)]
    assert len(scanned) > 200, (
        f"only {len(scanned)} scanned-language files found — discovery is broken."
    )

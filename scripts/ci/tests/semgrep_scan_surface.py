"""Which files would Semgrep actually ANALYSE, so a directive in them would bite?

NOT a test module and NOT vendored (no provenance header), like its siblings
`semgrep_channels.py` and `accepted_risks_paths.py`.

Split out of `test_semgrep_inline_suppressions.py` when that module crossed the
300-line cap. The seam is real rather than arithmetic: "which files does the
scanner read" is a different question from "which suppressions are pinned", and
only the first one has to track what Semgrep supports.

Both maps are asserted against what is actually in scan scope
(`test_every_in_scope_extension_is_classified`), in both directions, so the first
`.go`, `.rb` or `.tf` file to land in this repo turns the suite red and asks for
a decision instead of quietly falling into a blind spot.
(External plan review, O3.)
"""

from __future__ import annotations

from pathlib import Path

from semgrep_channels import REPO_ROOT, has_shebang

#: Extensions the directive scanner READS. A directive in one of these is real.
SCANNED_EXTENSIONS: dict[str, str] = {
    ".ts": "TypeScript — the server and client source language.",
    ".tsx": "TypeScript + JSX — client components.",
    ".js": "JavaScript — plain-ESM helpers and config.",
    ".mjs": "ES modules — bootstrapper and build scripts.",
    ".py": "Python — scripts/ci. Read line by line, exactly as Semgrep does.",
    ".yml": "YAML — GitHub workflows. Semgrep analyses these and honours `#` directives.",
    ".yaml": "YAML — same as .yml.",
    ".sh": "Shell — Semgrep analyses bash and honours `#` directives.",
    ".html": "HTML — Semgrep analyses it, so a directive would be honoured.",
    ".json": "JSON — analysed by Semgrep. Strict JSON admits no comments, so a "
             "directive is unreachable in practice, but reading these costs "
             "nothing and removes the question.",
}

#: Extensions the scanner deliberately SKIPS, and why a directive in one would
#: suppress nothing anyway.
UNSCANNED_EXTENSIONS: dict[str, str] = {
    ".md": "Markdown. Not a Semgrep language, so a directive suppresses nothing "
           "— and this repo's docs legitimately QUOTE the directive syntax "
           "(CLAUDE.md DO-NOT #25 and #31, CHANGELOG.md, decision_log.md).",
    ".jsonl": "Append-only event/triage logs. Data, not code.",
    ".css": "Stylesheets. Not a Semgrep language.",
    ".ps1": "PowerShell. Semgrep ships no PowerShell analyser, so it reads "
            "nothing here and a directive would be inert. KNOWN RESIDUAL: if "
            "Semgrep ever adds PowerShell this becomes a blind spot, and this "
            "entry must move to SCANNED_EXTENSIONS.",
    ".png": "Binary image asset.",
    ".jpg": "Binary image asset.",
    ".txt": "Plain-text notes and fixtures.",
    ".log": "Captured terminal-output fixture.",
    ".toml": "Tool configuration data.",
    ".example": "`.env.example` — a documented template, never executed.",
    "": "Extensionless files WITHOUT a shebang (.semgrepignore, .gitattributes, "
        "LICENSE, Makefile, scripts/ci/pr_reviewer/{system,user}, .gitkeep). "
        "Semgrep detects no language for them, so a directive would be inert. "
        "Extensionless files WITH a shebang ARE scanned — see is_scanned().",
}


#: Extensions Semgrep certainly analyses. `SCANNED_EXTENSIONS` must contain all
#: of them: without this floor, moving `.yml` into UNSCANNED_EXTENSIONS with a
#: plausible sentence is a ONE-LINE green disarm — and `.github/workflows` is
#: exactly where `yaml.github-actions.security.run-shell-injection` lives.
#: The classification test demands *a* classification; this demands the RIGHT
#: one for the cases that are not debatable. (Stage-3 doubt review, D-6.)
REQUIRED_SCANNED = frozenset(
    {".ts", ".tsx", ".js", ".mjs", ".py", ".yml", ".yaml", ".sh"}
)

#: Files Semgrep detects by NAME rather than extension. `Path("Dockerfile")`
#: has an empty suffix and no shebang, so it would otherwise land in the
#: extensionless "inert" bucket — already classified, so the coverage test would
#: stay green while a directive in it was honoured. No such file exists today;
#: this is a landmine defused, not a live hole. (Stage-3 doubt review, D-5.)
SCANNED_FILENAMES = frozenset({"dockerfile", "containerfile"})


def is_scanned(rel: str, repo_root: Path | None = None) -> bool:
    """Extension, then filename, then the shebang fallback.

    Semgrep's language guesser reads the shebang when a file has no extension,
    so `scripts/hooks/pre-commit` (`#!/usr/bin/env bash`) IS analysed as bash.
    Classifying every extensionless file as "not source" would have skipped it —
    and it is the bloat anti-ratchet gate, executable, and sits behind the
    Tier-3a `scripts/hooks` PR-review path. (Stage-2 code review, F3.)
    """
    path = Path(rel)
    if path.suffix.lower() in SCANNED_EXTENSIONS:
        return True
    if path.name.lower().split(".")[0] in SCANNED_FILENAMES:
        return True
    return path.suffix == "" and has_shebang((repo_root or REPO_ROOT) / rel)

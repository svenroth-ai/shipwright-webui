"""Shared paths + workflow reading for this repo's accepted-risk invariants.

NOT a test module and NOT vendored — it carries no provenance header, so
`test_accepted_risks_vendored.py`'s reverse-drift guard ignores it (that guard
also skips `tests/` outright).

Extracted when `test_accepted_risks_repo_invariants.py` crossed the 300-line cap
in iterate-2026-07-31-revendor-accepted-risk-gate. The three test modules that
import from here split along the seam their own docstrings already drew:

* ``test_accepted_risks_ignorefile_shape.py`` — will Trivy actually APPLY the
  ignore file this repo ships?
* ``test_accepted_risks_repo_invariants.py`` — the suppression channels this repo
  actually uses, including the one the shared gate structurally cannot see.
* ``test_accepted_risks_ci_wiring.py`` — is the gate wired, armed, and unarmed by
  nothing, on every trigger it must run on?

Workflows are PARSED, never substring-scanned: a `#` in front of a `run:` line
must fail the tests, and a scan cannot tell the difference.
"""

from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
SECURITY_YML = REPO_ROOT / ".github" / "workflows" / "security.yml"
PR_REVIEW_YML = REPO_ROOT / ".github" / "workflows" / "pr-review.yml"
TRIVYIGNORE = REPO_ROOT / ".trivyignore.yaml"
CLAUDE_SETTINGS = REPO_ROOT / ".claude" / "settings.json"
REGISTER = REPO_ROOT / "shipwright_accepted_risks.yaml"


def workflow(path: Path) -> dict:
    """Parsed workflow. NOTE: PyYAML reads the `on:` key as the boolean True.

    `accepted_risk_scan` deliberately does NOT `safe_load` a workflow, citing an
    unquoted `if: ${{ ... }}`. That stated mechanism is wrong - `${{ ... }}` is a
    plain scalar starting with `$`, which PyYAML reads as a string. The REAL trap
    is a bare `!expr`: GitHub allows `if: !cancelled()` without the braces, and
    `!` is YAML tag notation, so PyYAML raises a ConstructorError naming nothing
    useful. Parsing is worth it here (a substring scan cannot see a commented-out
    step), so the trap is caught and explained instead of avoided.
    (Stage-3 doubt review, D-7.)
    """
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise AssertionError(
            f"{path.name} could not be parsed as YAML: {exc}\n"
            "If this names a tag like `!cancelled()`, a workflow used a BARE "
            "expression in an `if:`. GitHub accepts it; YAML reads `!` as a tag. "
            "Wrap it: `if: ${{ !cancelled() }}`."
        ) from exc


def triggers(doc: dict) -> dict:
    return doc.get("on") or doc.get(True) or {}


def steps(doc: dict, job: str) -> list[dict]:
    return doc["jobs"][job]["steps"]


def runs(doc: dict, job: str) -> list[str]:
    return [s["run"] for s in steps(doc, job) if isinstance(s.get("run"), str)]


def commands(doc: dict, job: str) -> list[str]:
    """Every command LINE of every `run:` in a job, stripped.

    Line-level, not blob-level: matching a fragment anywhere in a `run:` body
    passes for `# python ... check` and for `true || python ... check`, which is
    the same evasion one level down from the one parsing was meant to close.
    (Stage-3 doubt review, D-9.)
    """
    return [ln.strip() for r in runs(doc, job) for ln in r.splitlines() if ln.strip()]

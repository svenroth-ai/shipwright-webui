"""Every test an iterate spec's ledger cites as evidence must exist.

An evidence table is the artefact the NEXT reviewer trusts instead of
re-deriving, so a citation that resolves to nothing is worse than a shorter
table: it reads as coverage and is not. This is not hypothetical — the
adversarial review of `iterate-2026-07-31-two-stage-pr-review` found a ledger
row citing `shape::test_fork_guard_absent`, a test that had been deleted when
that module was trimmed. The behaviour was covered by its co-cited sibling, so
nothing was actually untested; the row was simply lying about why.

Scope is deliberately narrow — the Test Completeness Ledger of the iterate
specs under `.shipwright/planning/iterate/`, which this repo (unlike the
monorepo) commits. Prose elsewhere is not policed.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SPEC_DIR = REPO_ROOT / ".shipwright" / "planning" / "iterate"
TEST_DIR = REPO_ROOT / "scripts" / "ci" / "tests"

# Ledger shorthand -> module. Only modules this suite owns; a citation naming
# anything else (a vitest spec, a Playwright flow) is out of scope and skipped.
_ALIASES = {
    "fail_closed": "test_pr_review_fail_closed.py",
    "fork_trust": "test_pr_review_fork_trust.py",
    "shape": "test_pr_review_workflow_shape.py",
    "decide": "test_pr_review_stage2_decide.py",
    "verdict": "test_pr_review_stage2_verdict.py",
    "token_permissions": "test_workflow_token_permissions.py",
    # ADR-117 port (iterate-2026-08-01-pr-review-stale-verdict). Registering
    # these is not bookkeeping: without an alias every citation from that
    # ledger falls through the `module is None` skip below, so the guard
    # reports success having checked NOTHING. Its own Stage-1 review found two
    # bad rows by hand that these aliases now catch mechanically.
    "select": "test_pr_review_dismiss.py",
    "calls": "test_pr_review_dismiss_calls.py",
    "gh": "test_pr_review_gh.py",
    "stale": "test_pr_review_stale_verdicts.py",
    "openrouter": "test_pr_review_openrouter.py",
    "pins": "test_pr_review_vendor_pins.py",
    "script": "test_pr_review_script.py",
    # test_pr_review_script.py crossed 300 lines once the canonical-parity and
    # ADR-117 test suites for pr_review.py's main() were both present in one
    # file; split 2026-08-05 into the file-contract half (kept "script") and
    # the orchestration half (this alias).
    "orchestration": "test_pr_review_orchestration.py",
}

_CITATION = re.compile(r"`([A-Za-z0-9_.]+)::(test_[A-Za-z0-9_]+)")


def _defined_tests(module: str) -> set[str]:
    path = TEST_DIR / module
    if not path.is_file():
        return set()
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
    return names


def _citations() -> list[tuple[Path, str, str, str]]:
    out = []
    for spec in sorted(SPEC_DIR.glob("*.md")):
        text = spec.read_text(encoding="utf-8", errors="replace")
        if "Test Completeness Ledger" not in text:
            continue
        block = text.split("Test Completeness Ledger", 1)[1]
        for prefix, test in _CITATION.findall(block):
            module = _ALIASES.get(prefix, prefix if prefix.endswith(".py") else None)
            if module is None:
                continue  # a suite this module does not own
            out.append((spec, prefix, module, test))
    return out


_ALL = _citations()


def test_there_are_citations_to_check() -> None:
    """A guard that silently matches nothing is not a guard."""
    assert _ALL, (
        "no ledger citations found under .shipwright/planning/iterate/ — either "
        "the ledger format changed or this guard's regex has rotted"
    )


@pytest.mark.parametrize(
    "spec, prefix, module, test",
    _ALL,
    ids=[f"{s.stem}:{p}::{t}" for s, p, _m, t in _ALL],
)
def test_cited_test_exists(spec: Path, prefix: str, module: str, test: str) -> None:
    defined = _defined_tests(module)
    assert defined, f"{spec.name} cites {prefix}:: but {module} does not exist"
    assert test in defined, (
        f"{spec.name} cites `{prefix}::{test}` as evidence, and no such test is "
        f"defined in {module}. Either the test was renamed or removed and the "
        f"ledger was not updated, or the citation was never real."
    )

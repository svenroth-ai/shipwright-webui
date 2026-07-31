"""Shared readers for the two-stage PR-review workflow tests.

Not a test module (leading underscore keeps pytest from collecting it). It owns
the file locations and the parsers used by ``test_pr_review_fail_closed.py``
(the gate cannot be bypassed) and ``test_pr_review_fork_trust.py`` (a
credentialed stage 2 trusts nothing the contributor controls).

Vendored from the canonical monorepo (``shared/tests/_pr_review_workflows.py``,
shipwright#437). The upstream copy parametrises over TWO pairs — the monorepo's
own gate and the workflow template shipped into adopted repos — because the
shipped one was the weaker of the two. This repo consumes the template rather
than producing it, so there is one pair here; the list shape is kept so the
assertions stay byte-identical to their source.

The parsers matter as much as the paths. Assertions about a workflow must read
its parsed STRUCTURE — ``if:`` expressions, comment-stripped ``run:`` bodies —
never its raw text: these files document the holes they close, so a text match
hits the explanatory comment and reports a defect that is not there. Two
upstream tests false-failed exactly that way before these helpers existed.

**Not every vendored assertion is a gate, and the difference matters when
reading a green run.** Four of them are structurally unable to fail against any
plausible edit — ``test_oversize_diff_fails_instead_of_skipping`` (re-asserts
the same expression inside its own ``if``), ``test_unparseable_review_output_fails_closed``
(absence of a literal no version of this workflow contained),
``test_waiver_cannot_cover_a_change_to_the_checks`` (reads RAW text, so a stage
2 that deleted the guard but kept the comment passes), and
``test_stage2_never_reviews_the_artifact``'s second clause (tautological for any
stage 2 that calls ``gh api`` at all). They are kept BYTE-IDENTICAL to their
canonical source in shipwright#437 rather than repaired here — a vendored file
that silently diverges is worse than a weak one — and each is filed upstream.
The real coverage for all four is behavioural, in
``test_pr_review_stage2_decide.py`` / ``test_pr_review_stage2_verdict.py``.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

# scripts/ci/tests/_pr_review_workflows.py → parents[3] is the repo root.
_ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = _ROOT / ".github" / "workflows"

# (stage-1 path, stage-2 path).
STAGE1_STAGE2 = [
    pytest.param(
        WORKFLOWS / "pr-review.yml",
        WORKFLOWS / "pr-review-run.yml",
        id="webui",
    ),
]

ALL_STAGE1 = [p.values[0] for p in STAGE1_STAGE2]
ALL_STAGE2 = [p.values[1] for p in STAGE1_STAGE2]


def load(path: Path) -> dict:
    assert path.is_file(), f"missing workflow: {path}"
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def jobs(path: Path) -> dict:
    return load(path).get("jobs") or {}


def run_bodies(path: Path) -> str:
    """Concatenate every ``run:`` body in the workflow."""
    out = []
    for job in jobs(path).values():
        for step in job.get("steps") or []:
            if isinstance(step, dict) and isinstance(step.get("run"), str):
                out.append(step["run"])
    return "\n".join(out)


def shell_code(path: Path) -> str:
    """``run:`` bodies with comment lines stripped.

    These assertions are about what the shell *executes*, so they must not read
    the comments explaining why a construct is absent — a workflow documenting
    ``# no `|| true` here`` would otherwise fail the very rule it honours.
    """
    lines = []
    for raw in run_bodies(path).splitlines():
        code = raw.split("#", 1)[0] if raw.lstrip().startswith("#") else raw
        lines.append(code)
    return "\n".join(lines)


def job_conditions(path: Path) -> str:
    """Every ``if:`` expression in the workflow, jobs and steps alike."""
    out = []
    for job in jobs(path).values():
        if job.get("if") is not None:
            out.append(str(job["if"]))
        for step in job.get("steps") or []:
            if isinstance(step, dict) and step.get("if") is not None:
                out.append(str(step["if"]))
    return "\n".join(out)

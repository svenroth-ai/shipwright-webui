"""The offline tripwire, shared by every module that drives `pr_review.main()`.

Two modules run the orchestration end-to-end — `test_pr_review_script.py` and
`test_pr_review_stale_verdicts.py` — and each maintains its OWN `_wire` listing
the boundaries to patch. That list is the thing that failed: ADR-117 added two
`gh` boundaries to `main()`, one `_wire` was not extended, and every case in it
shelled out to a real authenticated `gh api` while the job advertised "Offline,
no credentials". The suite stayed green throughout.

Fixing one `_wire` fixes one module. Stage-3 review pointed out that the fixture
guarding it lived in that module too, so the second copy of the same failure
mode was still unguarded — "offline by inspection", which is exactly what the
guard exists to replace. It lives here so both import the same one, and so a
third orchestration module cannot be written without it being obvious what is
missing.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

CI_DIR = Path(__file__).resolve().parent.parent  # scripts/ci
sys.path.insert(0, str(CI_DIR))

__all__ = ["OfflineViolation", "no_real_gh"]


class OfflineViolation(BaseException):
    """Deliberately NOT an `Exception`.

    Every `gh` caller ADR-117 added is best-effort by contract and swallows
    `Exception` so housekeeping can never flip the gate — which also swallows an
    ordinary assertion and turns this tripwire into a silent no-op. Measured:
    with the guard raising `AssertionError` the suite stayed green AND stopped
    making the calls, so it looked like proof while proving nothing. `pytest`
    reports a `BaseException` as a test failure (only `KeyboardInterrupt` and
    `BdbQuit` are special-cased), so this escapes those four handlers and fails
    the test that made the call.
    """


@pytest.fixture
def no_real_gh(monkeypatch):
    """Fail loudly if anything under test reaches the real `gh` boundary.

    Patched at `pr_review_gh.subprocess`, the single choke point every `gh`
    wrapper goes through, so it covers boundaries that do not exist yet. A
    module-level patch in `_wire` shadows the wrapper first, so this fires only
    on an UNPATCHED boundary — which is the intent.
    """
    import pr_review_gh

    def _forbidden(cmd, *a, **k):
        raise OfflineViolation(
            "this suite is offline by contract (see the module docstring and the "
            f"'Offline, no credentials' selftest job) but reached: {cmd!r}. "
            "A new `gh` boundary in main() needs a monkeypatch in _wire.")

    monkeypatch.setattr(pr_review_gh.subprocess, "run", _forbidden)

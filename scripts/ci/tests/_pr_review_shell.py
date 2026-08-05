"""Harness that runs stage 2's real shell bodies against a stubbed `gh`.

Not a test module (leading underscore keeps pytest from collecting it). Used by
``test_pr_review_stage2_decide.py`` and ``test_pr_review_stage2_verdict.py``.

The point of the harness is that the code under test is the SHIPPED code: each
``run:`` body is lifted out of the workflow YAML and executed, so an edit to
`.github/workflows/pr-review-run.yml` is what runs here. Nothing is transcribed
into the test, which would only prove the copy still agrees with itself.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
STAGE2 = REPO_ROOT / ".github" / "workflows" / "pr-review-run.yml"

HEAD = "a" * 40
OTHER = "b" * 40
REPO = "svenroth-ai/shipwright-webui"

# Dispatch order is load-bearing: `…/pulls?state=open` and `…/pulls/N/files`
# both contain "pulls", so the specific patterns must be tried first.
# The stub ASSERTS THE FLAGS it is called with. A stub that answers correctly
# whatever it is passed is flag-blind, and the behaviour suite would then pass
# on a workflow that dropped `--slurp` (real `gh` emits a flat array `.[][]`
# cannot walk) or `--jq` (real `gh` emits JSON objects the path grep never
# matches, so sensitive=false — fail open). Exit 91 means "the workflow called
# me wrongly", which is a test failure, not a fixture problem.
#
# `GH_FAIL=<substring>` makes any matching call fail, so the error branches
# have something to exercise.
_GH_STUB = """#!/usr/bin/env bash
argv="$*"
need() {
  case "$argv" in
    $1) ;;
    *) printf 'gh call missing %s: %s\\n' "$2" "$argv" >&2; exit 91 ;;
  esac
}
if [ -n "${GH_FAIL:-}" ]; then
  case "$argv" in *"$GH_FAIL"*) printf 'simulated gh failure\\n' >&2; exit 1 ;; esac
fi
case "$argv" in
  */check-runs*)
    need '*--paginate*--slurp*' '--paginate --slurp'
    cat "$STUB_DIR/check_runs.json" ;;
  */timeline*)
    need '*--paginate*--slurp*' '--paginate --slurp'
    cat "$STUB_DIR/timeline.json" ;;
  */pulls\\?state=open*)
    need '*--paginate*--slurp*' '--paginate --slurp'
    cat "$STUB_DIR/open_pulls.json" ;;
  */pulls/*/files*)
    need '*--paginate*' '--paginate'
    need '*previous_filename*' 'previous_filename (renames)'
    cat "$STUB_DIR/files.txt" ;;
  */statuses/*)        printf '%s\\n' "$argv" >> "$STUB_DIR/statuses.log" ;;
  *head.sha*)          cat "$STUB_DIR/head_sha.txt" ;;
  */pulls/*)           cat "$STUB_DIR/pr.json" ;;
  *) printf 'unexpected gh call: %s\\n' "$argv" >&2; exit 90 ;;
esac
"""

# The verdict step's lower bound for "was this branch force-pushed during the
# run". Fixtures date events relative to it.
RUN_STARTED_AT = "2026-07-31T10:00:00Z"


def force_pushes(*created_at: str) -> str:
    """Render `issues/{n}/timeline` as `--paginate --slurp` sees it."""
    return json.dumps(
        [[{"event": "head_ref_force_pushed", "created_at": t} for t in created_at]]
    )


def check_runs(*names: str) -> str:
    """Render `commits/{sha}/check-runs` as `--paginate --slurp` sees it.

    Note the extra nesting versus the timeline: this endpoint returns an OBJECT
    per page with the array under `check_runs`, so the filter is
    `.[].check_runs[]` rather than `.[][]`.
    """
    return json.dumps([{"check_runs": [{"name": n} for n in names]}])


def requires_shell() -> None:
    """Skip locally when bash/jq are absent — but NEVER silently in CI.

    ubuntu-latest, where the `Reviewer Selftest` job runs, ships both. A skip
    there would turn this whole module into decoration (skill Step 6
    CI-discipline rule), so CI fails loudly with an install hint instead.
    """
    for binary in ("bash", "jq"):
        if shutil.which(binary) is not None:
            continue
        if os.environ.get("CI", "").lower() in ("true", "1"):
            pytest.fail(
                f"`{binary}` is missing in CI, so stage 2's shell logic went "
                f"UNTESTED. Install it (`sudo apt-get install -y {binary}`) "
                f"rather than letting this skip."
            )
        pytest.skip(f"`{binary}` not on PATH (local dev); runs in CI")


def _posix(path: Path) -> str:
    r"""Git-Bash-safe path: ``C:\x`` -> ``/c/x``; a POSIX path passes through."""
    text = str(path).replace("\\", "/")
    return re.sub(r"^([A-Za-z]):", lambda m: "/" + m.group(1).lower(), text)


def _steps() -> list[dict]:
    parsed = yaml.safe_load(STAGE2.read_text(encoding="utf-8"))
    return [
        step
        for job in (parsed.get("jobs") or {}).values()
        for step in (job.get("steps") or [])
        if isinstance(step, dict)
    ]


def step_body(step_id: str) -> str:
    for step in _steps():
        if step.get("id") == step_id:
            assert isinstance(step.get("run"), str), f"step {step_id!r} has no run body"
            return step["run"]
    raise AssertionError(f"no step with id={step_id!r} in {STAGE2.name}")


def verdict_body() -> str:
    """The posting step carries no ``id:`` — find it by name."""
    for step in _steps():
        if "verdict" in str(step.get("name") or "").lower():
            return step["run"]
    raise AssertionError("no verdict-posting step found")


def run(body: str, tmp_path: Path, env: dict, **stubs) -> tuple[int, dict, str, list[str]]:
    """Run ``body`` in bash with a stubbed `gh`.

    Returns ``(rc, step_outputs, console, statuses)``. ``console`` is stdout AND
    stderr combined on purpose: a workflow command such as ``::error::`` is
    written to **stdout** — the channel GitHub parses — so asserting on stderr
    alone would silently pass on a workflow that printed nothing. (It did: the
    first draft of these tests asserted on stderr and five cases false-failed.)

    Stub filenames use ``__`` for ``.`` so they can be passed as kwargs:
    ``pr__json`` writes ``pr.json``.
    """
    stub_dir = tmp_path / "stub"
    stub_dir.mkdir(exist_ok=True)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    gh = bin_dir / "gh"
    gh.write_text(_GH_STUB, encoding="utf-8", newline="\n")
    gh.chmod(0o755)
    for name, content in stubs.items():
        (stub_dir / name.replace("__", ".")).write_text(
            content, encoding="utf-8", newline="\n"
        )

    out_file = tmp_path / "gh_output"
    out_file.write_text("", encoding="utf-8")
    full = {
        **os.environ,
        **env,
        "STUB_DIR": _posix(stub_dir),
        "GITHUB_OUTPUT": _posix(out_file),
        "PATH": f"{_posix(bin_dir)}{os.pathsep}{os.environ.get('PATH', '')}",
    }
    proc = subprocess.run(
        ["bash", "-c", body], capture_output=True, text=True, env=full, timeout=60
    )
    outputs = parse_outputs(out_file.read_text(encoding="utf-8"))
    log = stub_dir / "statuses.log"
    statuses = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return proc.returncode, outputs, proc.stdout + proc.stderr, statuses


def parse_outputs(text: str) -> dict[str, str]:
    """Parse a ``$GITHUB_OUTPUT`` file the way the Actions runner does.

    Two forms, and the harness must honour both or it silently mis-reads the
    workflow. ``name=value`` is the simple one; ``name<<DELIM`` … ``DELIM``
    is the heredoc form the `tier` step uses for `reason`, so that a value
    containing a newline cannot append a second `needs_review=` line and flip
    the verdict. A parser that only understood `k=v` reported `reason` as
    ABSENT — the tests said the step had stopped emitting it.
    """
    out: dict[str, str] = {}
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        name, sep, delim = line.partition("<<")
        if sep and "=" not in name:
            body: list[str] = []
            i += 1
            while i < len(lines) and lines[i] != delim:
                body.append(lines[i])
                i += 1
            out[name] = "\n".join(body)
        elif "=" in line:
            key, _, value = line.partition("=")
            out[key] = value
        i += 1
    return out


def pages(*page_list: list) -> str:
    """Render ``gh api --paginate --slurp`` output: an array OF PAGES."""
    return json.dumps(list(page_list))


def pr(number: int, sha: str = HEAD, state: str = "open", fork: bool = False) -> dict:
    """One entry as `pulls?state=open` renders it.

    ``fork=True`` marks the head as living in another repository — the case
    `commits/{sha}/pulls` cannot resolve at all, which is why the workflow
    lists the base repo's open PRs instead.
    """
    repo = "someone-else/shipwright-webui" if fork else REPO
    return {
        "number": number,
        "state": state,
        "head": {"sha": sha, "repo": {"full_name": repo}},
    }


def posted_state(statuses: list[str]) -> str:
    found = re.search(r"state=(\w+)", " ".join(statuses))
    return found.group(1) if found else ""

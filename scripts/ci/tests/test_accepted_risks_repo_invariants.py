"""This repo's OWN accepted-risk invariants (not the vendored contract).

`test_accepted_risks_vendored.py` tests the VENDORED gate — drift against the
manifest, and the CLI's own contract. This file tests properties of
*shipwright-webui specifically*, which the shared logic cannot enforce because
they are only meaningful for a repo whose live configuration sits where it does.

Every invariant here closes a FAIL-OPEN hole: a state in which a suppression is
genuinely in effect while `accepted_risks_cli.py check` prints "no drift" and
exits 0. Four were found by review (EC-1/EC-2 external, CR-1/CR-2 internal); each
is a real defect in the SHARED discovery logic, and none is fixed by forking the
vendored modules — `accepted_risk_scan` is a shared leaf the compliance dashboard
also consumes, so diverging it here would make webui's CI gate disagree with
webui's own dashboard. The upstream gaps are recorded in the iterate spec.

These run in BOTH jobs that matter: `Reviewer Selftest` (pr-review.yml, on every
PR) and the `Accepted-risk register (gate)` job itself (security.yml), which is
what puts them on the weekly schedule too. That second wiring is deliberate — the
gate's `expire` half is time-based, and an invariant enforced only on
`pull_request` is absent on exactly the trigger the gate exists for.

Workflows are PARSED, never substring-scanned: a `#` in front of a `run:` line
must fail these tests, and a scan cannot tell the difference.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SECURITY_YML = _REPO_ROOT / ".github" / "workflows" / "security.yml"
_PR_REVIEW_YML = _REPO_ROOT / ".github" / "workflows" / "pr-review.yml"
_REGISTER = _REPO_ROOT / "shipwright_accepted_risks.yaml"
_TRIVYIGNORE = _REPO_ROOT / ".trivyignore.yaml"
_CLAUDE_SETTINGS = _REPO_ROOT / ".claude" / "settings.json"

#: The one `SHIPWRIGHT_SEMGREP_*` key that has a register entry
#: (`ar-2026-07-18-gh-owned-action-mutable-tags`). See CR-1 below.
_REGISTERED_SEMGREP_KEYS = {"SHIPWRIGHT_SEMGREP_ACCEPT_GH_OWNED_ACTION_TAGS"}  # noqa: E501


#: `if:` values GitHub evaluates that are legal to leave on a gate step.
_ALLOWED_STEP_IF = {"${{ !cancelled() }}"}


def _workflow(path: Path) -> dict:
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


def _triggers(doc: dict) -> dict:
    return doc.get("on") or doc.get(True) or {}


def _steps(doc: dict, job: str) -> list[dict]:
    return doc["jobs"][job]["steps"]


def _runs(doc: dict, job: str) -> list[str]:
    return [s["run"] for s in _steps(doc, job) if isinstance(s.get("run"), str)]


def _commands(doc: dict, job: str) -> list[str]:
    """Every command LINE of every `run:` in a job, stripped.

    Line-level, not blob-level: matching a fragment anywhere in a `run:` body
    passes for `# python ... check` and for `true || python ... check`, which is
    the same evasion one level down from the one parsing was meant to close.
    (Stage-3 doubt review, D-9.)
    """
    return [ln.strip() for r in _runs(doc, job) for ln in r.splitlines() if ln.strip()]


# --------------------------------------------------------------- fail-open #1


def test_this_repo_still_has_a_register() -> None:
    """Deleting the register must not silently disarm the gate. (EC-1.)

    `cmd_check` returns 0 when no register exists - correct for a fresh or legacy
    repo, but for a repo that HAS one, deleting it while keeping the
    `.trivyignore.yaml` suppressions makes both subcommands pass and the accepted
    risks vanish from view.
    """
    assert _REGISTER.is_file(), (
        "shipwright_accepted_risks.yaml is missing from the repo root. An absent "
        "register makes `accepted_risks_cli.py check` exit 0 without reconciling "
        "anything, so every suppression still in .trivyignore.yaml would go "
        "unrecorded and unreviewed. If the register is genuinely being retired, "
        "remove the suppressions and the CI gate in the same change."
    )


# --------------------------------------------------------------- fail-open #2


def test_no_trivy_suppression_has_silently_lapsed() -> None:
    """A register entry must not outlive the suppression it claims. (EC-2.)

    `read_trivyignore_ids` collects ids regardless of `expired_at`, so a Trivy
    entry whose date has PASSED still counts as an active suppression and `check`
    reports it reconciled - while Trivy has already stopped ignoring it.

    UTC, matching `accepted_risks.today_utc()`, which exists precisely so an
    entry cannot flip expired/active between a CI runner and a laptop.
    """
    if not _TRIVYIGNORE.is_file():
        raise AssertionError(
            ".trivyignore.yaml is missing. Every register entry targeting "
            "trivy-ignore would then be STALE - remove the register entries in "
            "the same change, or restore the file."
        )
    doc = yaml.safe_load(_TRIVYIGNORE.read_text(encoding="utf-8")) or {}
    today = datetime.now(timezone.utc).date()
    lapsed, malformed = [], []
    for entry in doc.get("vulnerabilities") or []:
        if not isinstance(entry, dict):
            continue
        raw = entry.get("expired_at")
        if raw is None:
            continue
        when = raw.date() if isinstance(raw, datetime) else raw
        if not isinstance(when, date):
            try:
                when = date.fromisoformat(str(raw).strip()[:10])
            except ValueError:
                # Fail CLOSED: an unreadable date is not "not lapsed".
                malformed.append(f"{entry.get('id')} (expired_at {raw!r})")
                continue
        if when < today:
            lapsed.append(f"{entry.get('id')} (expired_at {when})")

    assert not lapsed, (
        "these .trivyignore.yaml entries have LAPSED, so Trivy is no longer "
        "suppressing them, yet `check` still counts them as active suppressions "
        "and reports the register reconciled:\n  " + "\n  ".join(lapsed)
    )
    assert not malformed, (
        "these .trivyignore.yaml entries have an unparseable `expired_at`, so "
        "whether the suppression is still in effect cannot be established:\n  "
        + "\n  ".join(malformed)
    )


# --------------------------------------------------------------- fail-open #3


def test_no_unregistered_semgrep_toggle_in_claude_settings() -> None:
    """The semgrep channels are reconciled against a source this repo does NOT use.

    `discovered_suppressions` reads `SHIPWRIGHT_SEMGREP_*` ONLY out of
    security.yml, and this repo's live toggle lives in `.claude/settings.json`
    (which is correct - see CLAUDE.md DO-NOT #25). So two of the three
    reconcilable targets are reconciled against a provably empty source: adding
    `SHIPWRIGHT_SEMGREP_EXCLUDE_RULES` there genuinely suppresses rules in the
    local `/shipwright-security` scan that feeds findings.json and the triage
    inbox, while `check` exits 0 with "no drift". (Stage-2 review, CR-1.)
    """
    doc = json.loads(_CLAUDE_SETTINGS.read_text(encoding="utf-8"))
    # Prefix is SHIPWRIGHT_, not SHIPWRIGHT_SEMGREP_: SHIPWRIGHT_SCAN_EXCLUDES is
    # named by accepted_risk_scan itself as a real path-scoping channel with no
    # target, so a SEMGREP-only filter let the broader knob slip its own closure.
    # (Stage-3 doubt review, D-1 sub-case.)
    present = {k for k in (doc.get("env") or {}) if k.startswith("SHIPWRIGHT_")}
    unregistered = present - _REGISTERED_SEMGREP_KEYS
    assert not unregistered, (
        "these SHIPWRIGHT_SEMGREP_* toggles are live in .claude/settings.json but "
        f"have no entry in shipwright_accepted_risks.yaml: {sorted(unregistered)}.\n"
        "The register gate CANNOT see them - it discovers semgrep channels only "
        "from .github/workflows/security.yml - so they would silence findings "
        "with nobody able to say why or until when. Add a register entry (and "
        "extend _REGISTERED_SEMGREP_KEYS), or remove the toggle."
    )


# --------------------------------------------------------------- fail-open #4


def test_the_scanner_actually_reads_the_ignorefile_the_gate_reconciles() -> None:
    """Register<->file agreement is not file<->scanner agreement. (CR-2.)

    `read_trivyignore_ids` picks `.trivyignore.yaml` -> `.trivyignore.yml` ->
    flat `.trivyignore`; Trivy is pointed at a HARDCODED `--ignorefile`. If those
    two ever name different files - or the flag is dropped - Trivy suppresses
    nothing while `check` still reports "reconciled ... no drift".

    Not hypothetical: per .trivyignore.yaml's own header the YAML file "was never
    read AT ALL" until iterate-2026-07-28-security-trivy-ignorefile (#330) added
    the flag. Throughout that window this gate would have been green while all
    three acceptances were unsuppressed. Both files say "DO NOT drop this flag" -
    in a comment, in a change whose premise is that a comment is not a guard.
    """
    runs = "\n".join(_runs(_workflow(_SECURITY_YML), "scan"))
    trivy = [ln for ln in runs.splitlines() if "trivy fs" in ln]
    assert trivy, "security.yml's scan job no longer runs `trivy fs`"

    match = re.search(r"--ignorefile\s+(\S+)", trivy[0])
    assert match, (
        "the Trivy step has no `--ignorefile` flag. Trivy auto-discovers ONLY the "
        "flat `.trivyignore`; without the flag this repo's .trivyignore.yaml is "
        "not read at all, every acceptance is unsuppressed, and the register gate "
        "still reports them reconciled. See PR #330."
    )
    # Mirrors accepted_risk_scan.read_trivyignore_ids' precedence.
    selected = next(
        (n for n in (".trivyignore.yaml", ".trivyignore.yml", ".trivyignore")
         if (_REPO_ROOT / n).is_file()),
        None,
    )
    assert match.group(1) == selected, (
        f"Trivy is pointed at `{match.group(1)}` but the register gate reconciles "
        f"against `{selected}` (the first of .trivyignore.yaml/.yml/flat that "
        "exists). They must be the same file, or the gate certifies a suppression "
        "the scanner never applies."
    )


# ------------------------------------------------------------- the CI wiring
#
# AC-4 was originally recorded as covered by `test_workflow_token_permissions` /
# the workflow-shape tests. It was not: the former asserts only security.yml's
# TOP-LEVEL permissions block, the latter reads only pr-review.yml. (S1-4.)


def test_the_gate_job_is_wired_and_runs_both_subcommands() -> None:
    doc = _workflow(_SECURITY_YML)
    commands = _commands(doc, "accepted-risks")
    for cmd in (
        "python scripts/ci/accepted_risks_cli.py check --project-root .",
        "python scripts/ci/accepted_risks_cli.py expire --project-root .",
    ):
        assert any(ln.startswith(cmd) for ln in commands), (
            f"the accepted-risks job no longer runs: {cmd}\n"
            f"command lines found: {commands}"
        )
    assert any(
        ln.startswith("pip install") and "pyyaml" in ln.lower() for ln in commands
    ), "the gate job must install PyYAML, or every path exits 2"

    # A gate whose failure does not fail the run is not a gate. `continue-on-error`
    # appears three times elsewhere in this same file, so it is the local idiom
    # for "do not let this block" - which makes it the likeliest disarm.
    # (Stage-3 doubt review, D-3.)
    job = doc["jobs"]["accepted-risks"]
    assert not job.get("continue-on-error"), (
        "the accepted-risks job must not set continue-on-error - it would run "
        "both subcommands, report success, and leave every test here green"
    )
    for step in _steps(doc, "accepted-risks"):
        assert not step.get("continue-on-error"), (
            f"gate step {step.get('name')!r} must not set continue-on-error"
        )
        cond = step.get("if")
        assert cond is None or cond in _ALLOWED_STEP_IF, (
            f"gate step {step.get('name')!r} carries an unexpected `if: {cond!r}`. "
            "A step-level `if: github.event_name == ...` disarms the gate on the "
            f"scheduled run exactly as a job-level one would. Allowed: {_ALLOWED_STEP_IF}"
        )


def test_the_gate_job_also_runs_these_invariants() -> None:
    """The gate must carry its own backstops on EVERY trigger it runs on.

    `pytest scripts/ci/tests` otherwise runs only in pr-review.yml's selftest
    job, which is `pull_request`-only - so on the weekly scheduled run, the
    trigger the whole design turns on, none of the fail-open invariants above
    would execute. `main` is not branch-protected, so a direct push deleting the
    register never passes through selftest either. (Stage-2 review, CR-3.)
    """
    runs = _runs(_workflow(_SECURITY_YML), "accepted-risks")
    assert any("pytest" in r and Path(__file__).name in r for r in runs), (
        "the accepted-risks job must run this file, e.g.\n"
        f"    python -m pytest scripts/ci/tests/{Path(__file__).name} -q\n"
        "otherwise these invariants are enforced on pull_request only, and the "
        "scheduled run - the reason this job lives in security.yml - has none."
    )


def test_the_gate_job_runs_on_a_schedule_and_is_not_event_gated() -> None:
    """Pinned as BEHAVIOUR: a job-level `if:` would silently un-schedule it."""
    doc = _workflow(_SECURITY_YML)
    triggers = _triggers(doc)
    assert "schedule" in triggers, (
        "security.yml lost its schedule trigger - `expire` is time-based, so a "
        "PR-only gate would never fire on an entry that lapses during a quiet week"
    )
    job = doc["jobs"]["accepted-risks"]
    assert "if" not in job, (
        "the accepted-risks job must not carry a job-level `if:` - an "
        "`if: github.event_name == 'pull_request'` would leave the workflow's "
        f"schedule intact while disarming the gate on it. Found: {job.get('if')!r}"
    )


def test_the_gate_job_does_not_inherit_write_scopes() -> None:
    """It reads a checked-out tree; it must not carry the SARIF job's writes."""
    perms = _workflow(_SECURITY_YML)["jobs"]["accepted-risks"].get("permissions")
    assert perms == {"contents": "read"}, (
        "the accepted-risks job must declare `permissions: {contents: read}`; "
        "security.yml's top-level block grants security-events: write and "
        f"pull-requests: write for the SARIF job. Found: {perms!r}"
    )


def test_the_selftest_job_installs_pyyaml() -> None:
    """`Reviewer Selftest` runs the drift guard, which needs PyYAML.

    Without it, five contract tests get exit 2 instead of 0/1 and the job is RED
    unconditionally - at which point it can no longer distinguish a real
    vendored-file edit from baseline. Verified by running that job's exact
    command with pytest alone: 5 failed. (S1-1.)
    """
    runs = _runs(_workflow(_PR_REVIEW_YML), "selftest")
    installs = [r for r in runs if "pip install" in r and "pyyaml" in r.lower()]
    assert installs, (
        "pr-review.yml's selftest job must have a `pip install ... pyyaml` step - "
        "`pytest scripts/ci/tests` now covers the accepted-risk gate's contract "
        "tests. A comment mentioning PyYAML is not an install."
    )

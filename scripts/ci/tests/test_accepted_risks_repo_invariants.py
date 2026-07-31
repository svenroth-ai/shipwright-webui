"""This repo's OWN accepted-risk invariants (not the vendored contract).

`test_accepted_risks_vendored.py` tests the VENDORED gate — drift against the
manifest, and the CLI's own contract. This file tests properties of
*shipwright-webui specifically*, which the shared logic cannot enforce because
they are only meaningful for a repo whose live configuration sits where it does.

Every invariant here closes a FAIL-OPEN hole: a state in which a suppression is
genuinely in effect while `accepted_risks_cli.py check` prints "no drift" and
exits 0. Four were found by review (EC-1/EC-2 external, CR-1/CR-2 internal); each
was a real defect in the SHARED discovery logic, and none could be fixed by
forking the vendored modules — `accepted_risk_scan` is a shared leaf the
compliance dashboard also consumes, so diverging it here would make webui's CI
gate disagree with webui's own dashboard.

OF THE FOUR, ONE HAS RETIRED AND ONE HAS NARROWED. Both were filed upstream as
SecFix-1/SecFix-3 and fixed there (shipwright #507,
`iterate-2026-07-31-accepted-risk-gate-holes`), re-vendored here by
`iterate-2026-07-31-revendor-accepted-risk-gate`:

* EC-1 (deleting the register disarms the gate) — `cmd_check` no longer returns
  early on an absent register; it reconciles against an empty record, so every
  live suppression reports UNRECORDED. Guard DELETED.
* EC-2 (a lapsed ignore entry counted as an active suppression) — HALF retired.
  `_is_lapsed` now drops a lapsed entry from the discovered set, so its register
  counterpart surfaces as STALE. The MALFORMED-date half stays, because upstream
  deliberately left it open; see that test's docstring.

Both retirements were confirmed by running the re-vendored gate against a mutated
copy of this repo's real state, not by reading the new code. Keeping a guard the
shared logic now expresses would be duplicated enforcement; deleting one it does
NOT express would be a silent regression, which is why EC-2 was narrowed rather
than removed.

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
from datetime import date
from pathlib import Path

import yaml

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SECURITY_YML = _REPO_ROOT / ".github" / "workflows" / "security.yml"
_PR_REVIEW_YML = _REPO_ROOT / ".github" / "workflows" / "pr-review.yml"
_TRIVYIGNORE = _REPO_ROOT / ".trivyignore.yaml"
_CLAUDE_SETTINGS = _REPO_ROOT / ".claude" / "settings.json"
_REGISTER = _REPO_ROOT / "shipwright_accepted_risks.yaml"

#: Live `SHIPWRIGHT_*` toggle -> the register entry that records WHY and UNTIL
#: WHEN. A mapping rather than a bare set since
#: iterate-2026-07-31-revendor-accepted-risk-gate: the value is now ASSERTED to
#: exist in the register, which is what keeps this channel's record alive. See
#: CR-1 below.
_REGISTERED_SEMGREP_KEYS = {
    "SHIPWRIGHT_SEMGREP_ACCEPT_GH_OWNED_ACTION_TAGS":
        "ar-2026-07-18-gh-owned-action-mutable-tags",
}


#: `if:` values GitHub evaluates that are legal to leave on a gate step.
_ALLOWED_STEP_IF = {"${{ !cancelled() }}"}

#: Trivy's ONLY accepted `expired_at` shape — the Go layout `2006-01-02`.
#: Deliberately stricter than `accepted_risks.coerce_date`, which slices `[:10]`
#: and so accepts trailing junk the scanner rejects. See CR-EC-2 below.
_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


class _StrictLoader(yaml.SafeLoader):
    """SafeLoader that REJECTS duplicate mapping keys, as Trivy's decoder does.

    PyYAML silently keeps the LAST value for a duplicated key; Go's yaml.v3 —
    what Trivy decodes with — raises. So a file with `expired_at:` written twice
    reads here as one valid entry while Trivy rejects the WHOLE file and applies
    no suppression at all. Reading the ignore file with the permissive loader is
    therefore not a neutral choice: it is the gate agreeing with itself instead
    of with the scanner. (External review, iterate round.)
    """


def _no_duplicate_keys(loader: yaml.Loader, node: yaml.Node, deep: bool = False) -> dict:
    mapping: dict = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise yaml.constructor.ConstructorError(
                None, None, f"duplicate key {key!r}", key_node.start_mark
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_StrictLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _no_duplicate_keys
)


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


# ------------------------------------------------- fail-open EC-1: RETIRED
#
# `test_this_repo_still_has_a_register` lived here. The shared gate now expresses
# it: `cmd_check` reconciles unconditionally instead of returning 0 on the absent
# FILE, so deleting the register reports every live suppression as UNRECORDED.
# Confirmed on the re-vendored copy by deleting the register from a staged copy
# of this repo and running the real CLI: exit 1, three UNRECORDED lines.
# (shipwright #507; re-vendored by iterate-2026-07-31-revendor-accepted-risk-gate.)


# ----------------------------------------- fail-open EC-2: NARROWED, not retired


def test_no_trivy_suppression_has_an_unreadable_expiry() -> None:
    """An unparseable `expired_at` leaves the gate unable to conclude. (EC-2.)

    THE LAPSED HALF OF THIS GUARD HAS RETIRED. `accepted_risk_scan._is_lapsed`
    now drops an entry whose own due date has passed from the discovered set, so
    its register counterpart surfaces as STALE with renew-BOTH-dates advice.
    Confirmed against the re-vendored gate rather than inferred from it: setting
    `expired_at: 2020-01-01` on a live entry in a staged copy of this repo made
    the real CLI exit 1 with "STALE trivy-ignore: GHSA-frvp-7c67-39w9 ... its own
    expiry has passed".

    THE MALFORMED HALF HAS NOT, because upstream deliberately left it open.
    `_is_lapsed` treats a date it cannot parse as "no expiry" and keeps the entry
    ACTIVE; its docstring names that a disclosed limit and files the failure
    contract for a structurally invalid ignore file as out of scope. Trivy does
    the OPPOSITE - it unmarshals `expired_at` into a `time.Time`, so a single bad
    date makes it reject the WHOLE ignore file and apply NO suppression at all.
    The same probe with `expired_at: whenever` exited 0 "no drift" while all
    three acceptances would in fact be unsuppressed: the gate certifying a
    suppression the scanner never applies, which is CR-2's shape exactly.

    THE REFERENCE IS TRIVY, NOT THE SHARED HELPER. An earlier draft mirrored
    `accepted_risks.coerce_date` exactly and was still wrong, because that helper
    is more permissive than the scanner: it slices `[:10]`, so `2026-10-28xyz`
    reads as a valid date to the gate while Trivy rejects the whole file. What
    this guard must answer is "would the scanner accept this?", so it enforces
    Trivy's `2006-01-02` layout directly. (Stage-3 doubt review, D-2.)

    Scope, stated rather than implied. COVERED: strict decoding (duplicate
    mapping keys rejected, as Go does and PyYAML does not), top-level shape,
    `vulnerabilities:` being a list, each entry being a mapping with a string
    `id`, and `expired_at` matching Trivy's layout.

    NOT covered, each for a stated reason rather than by oversight:

    * a `misconfigurations:`/`secrets:` section — a real Trivy suppression
      channel that neither this guard nor `read_trivyignore_ids` reads, so the
      gate's "the `.trivyignore.yaml` channel" is narrower than the file;
    * a QUOTED but well-formed date, and a YAML TIMESTAMP
      (`2026-10-28T00:00:00Z`, which PyYAML builds as a `datetime` and so passes
      the `date` check). Both are accepted because Trivy is not installed on the
      authoring machine, so whether it rejects them is UNVERIFIED — and the two
      errors are not symmetric. A wrong REJECT reds CI on a legitimate file; a
      wrong ACCEPT ends with Trivy dropping the ignore file and the suppressed
      alerts RETURNING, which is loud rather than hidden. This guard takes the
      loud failure. Settle it by running `trivy fs --ignorefile` against a file
      in each form and tighten to `type(raw) is date` if the scanner refuses.

    Fails CLOSED on everything it does look at.
    """
    # Not an independent existence backstop (that was EC-1, retired above): this
    # guard has to read the file, and a vacuous pass would be worse than a noisy
    # one. An absent file is separately caught by `check`, which turns every
    # trivy-ignore register entry STALE.
    assert _TRIVYIGNORE.is_file(), (
        ".trivyignore.yaml is missing, so this guard cannot read it. Restore the "
        "file, or remove the register entries targeting trivy-ignore in the same "
        "change."
    )
    # Decoded STRICTLY, because the question is what Trivy will accept. A
    # duplicate key parses fine for PyYAML and kills the file for Go.
    try:
        doc = yaml.load(_TRIVYIGNORE.read_text(encoding="utf-8"), Loader=_StrictLoader)
    except yaml.YAMLError as exc:
        raise AssertionError(
            f".trivyignore.yaml does not decode strictly: {exc}\n"
            "Trivy's Go decoder is at least this strict, so it would reject the "
            "ENTIRE file and apply NO suppression, while the register gate still "
            "counts every acceptance as active and reports 'no drift'."
        ) from exc
    doc = doc or {}

    # Container shape, before entry shape. A non-mapping document or a
    # non-list `vulnerabilities:` reaches the scanner as a decode error, and
    # `read_trivyignore_ids` would report it identically to "no suppressions".
    assert isinstance(doc, dict), (
        f".trivyignore.yaml's top level is a {type(doc).__name__}, not a mapping"
    )
    vulns = doc.get("vulnerabilities")
    assert vulns is None or isinstance(vulns, list), (
        f"`vulnerabilities:` is a {type(vulns).__name__}, not a list — Trivy "
        "cannot decode it and would suppress nothing"
    )

    malformed = []
    for index, entry in enumerate(vulns or []):
        # A non-mapping entry is structurally invalid and must NOT be skipped:
        # a bare `- GHSA-1234-5678-90ab` gives Trivy's decoder a string where it
        # wants a struct, so it rejects the WHOLE file and every acceptance goes
        # unsuppressed — while this guard skipped it and `read_trivyignore_ids`
        # skipped it identically, so `check` reported "no drift".
        # (Stage-3 doubt review, D-3.)
        if not isinstance(entry, dict):
            malformed.append(
                f"entry #{index} is a {type(entry).__name__}, not a mapping: {entry!r}"
            )
            continue
        entry_id = entry.get("id")
        if not entry_id:
            malformed.append(f"entry #{index} has no `id:` — Trivy cannot match it")
            continue
        if not isinstance(entry_id, str):
            # Trivy decodes `id` into a Go string; an unquoted YAML scalar that
            # resolves to another type does not decode.
            malformed.append(
                f"entry #{index} has a non-string `id:` {entry_id!r} "
                f"(a {type(entry_id).__name__})"
            )
            continue
        raw = entry.get("expired_at")
        if raw is None:
            continue
        # THE REFERENCE IS TRIVY, NOT `coerce_date`. This guard's question is
        # "would the scanner accept this?", and `coerce_date` is strictly more
        # permissive: it slices `[:10]` before parsing, so `2026-10-28xyz` passes
        # it — and passed this guard while it mirrored it — while Trivy parses
        # `expired_at` with the Go layout `2006-01-02` and nothing else, rejects
        # the file, and suppresses nothing. Mirroring the shared helper exactly
        # was precision aimed at the wrong target. (Stage-3 doubt review, D-2.)
        # Accepts a YAML timestamp too (`datetime` subclasses `date`), which is
        # DELIBERATE and is listed as a residual in the docstring. Rejecting it
        # would be the stricter reading of "Trivy's layout is 2006-01-02", but
        # Trivy decodes into a Go `time.Time` and yaml.v3 resolves RFC3339
        # timestamps into that type natively — so a timestamp is plausibly
        # ACCEPTED by the scanner, and Trivy is not installed here to settle it.
        # Between an unverified false RED that blocks CI on a legitimate file and
        # an unverified miss whose worst case is un-suppressed alerts RETURNING
        # (loud, not hidden), the guard takes the loud failure. Same call, same
        # reason, as the quoted-date residual. (External code review.)
        if isinstance(raw, date):
            continue
        if not isinstance(raw, str):
            # Remediation matters here: the previous wording said "quote it",
            # and following it on a YAML int turned a CAUGHT case into an
            # uncaught one — `"20261028"` parses as basic ISO 8601 on 3.11, so
            # the guard went silent while `coerce_date` began returning a date
            # the operator never wrote. (Stage-3 doubt review, D-2.)
            malformed.append(
                f"{entry.get('id')} (expired_at {raw!r} — a {type(raw).__name__}. "
                "Write it UNQUOTED as YYYY-MM-DD)"
            )
            continue
        stripped = raw.strip()
        readable = bool(_ISO_DATE.fullmatch(stripped))
        if readable:
            try:
                date.fromisoformat(stripped)
            except ValueError:  # shape is right, the day is not (e.g. 2026-02-31)
                readable = False
        if not readable:
            malformed.append(
                f"{entry.get('id')} (expired_at {raw!r} — not a YYYY-MM-DD date)"
            )

    assert not malformed, (
        "these .trivyignore.yaml entries have an unparseable `expired_at`. Trivy "
        "rejects the ENTIRE ignore file over one bad date, so none of this "
        "repo's acceptances would be suppressed - while the register gate still "
        "counts them as active and reports 'no drift':\n  "
        + "\n  ".join(malformed)
    )


# --------------------------------------------------------------- fail-open CR-1


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
    unregistered = present - set(_REGISTERED_SEMGREP_KEYS)
    assert not unregistered, (
        "these SHIPWRIGHT_SEMGREP_* toggles are live in .claude/settings.json but "
        f"have no entry in shipwright_accepted_risks.yaml: {sorted(unregistered)}.\n"
        "The register gate CANNOT see them - it discovers semgrep channels only "
        "from .github/workflows/security.yml - so they would silence findings "
        "with nobody able to say why or until when. Add a register entry (and "
        "extend _REGISTERED_SEMGREP_KEYS), or remove the toggle."
    )

    # The other direction, and the one that keeps this channel's RECORD alive.
    # `_REGISTERED_SEMGREP_KEYS` used to be a hardcoded set that named a register
    # entry without ever looking for it, so the mapping could outlive the thing it
    # claimed. That became load-bearing when
    # iterate-2026-07-31-revendor-accepted-risk-gate retired
    # `test_this_repo_still_has_a_register`: the shared `check` catches a deleted
    # register only when a DISCOVERABLE suppression is still live, and this
    # toggle is precisely the suppression it structurally cannot see. Reproduced
    # before writing this: with the register deleted AND `vulnerabilities: []`,
    # both `check` and `expire` exit 0 while the toggle keeps suppressing. The
    # same state arrives with no edit at all once every `expired_at` has lapsed.
    # So the toggle's record is asserted HERE, where the un-discoverable channel
    # is already owned, rather than by re-adding a blanket file-exists guard.
    assert _REGISTER.is_file(), (
        "shipwright_accepted_risks.yaml is missing, but a SHIPWRIGHT_* suppression "
        f"toggle is live in .claude/settings.json: {sorted(present)}.\n"
        "The shared gate cannot catch this - it discovers suppressions from "
        "security.yml and the ignore file, never from .claude/settings.json - so "
        "`check` and `expire` both exit 0 while the toggle silences findings with "
        "its WHY and UNTIL-WHEN deleted. Restore the register, or remove the "
        "toggle in the same change."
    )
    register = yaml.safe_load(_REGISTER.read_text(encoding="utf-8")) or {}
    recorded = {
        e.get("id") for e in (register.get("acceptances") or []) if isinstance(e, dict)
    }
    missing = {
        key: entry_id
        for key, entry_id in _REGISTERED_SEMGREP_KEYS.items()
        if key in present and entry_id not in recorded
    }
    assert not missing, (
        "these live toggles name a register entry that no longer exists: "
        f"{missing}.\nThe entry is what records why the finding is accepted and "
        "when it gets revisited; without it the toggle is an unexplained "
        "suppression that no gate can see. Restore the entry, or remove the "
        "toggle and its mapping together."
    )


# --------------------------------------------------------------- fail-open CR-2


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
    # Same argument, one level down: the next steps EXECUTE the vendored modules,
    # so the guards proving those bytes are the vendored bytes have to run on the
    # same triggers. Left pull_request-only, a scheduled run executes code whose
    # integrity was last checked whenever the last PR landed.
    # (Stage-3 doubt review, D-5.)
    assert any("pytest" in r and "test_accepted_risks_vendored.py" in r for r in runs), (
        "the accepted-risks job must also run test_accepted_risks_vendored.py - "
        "it carries the sha256 drift guard and the header/manifest provenance "
        "checks over the modules this job then runs."
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

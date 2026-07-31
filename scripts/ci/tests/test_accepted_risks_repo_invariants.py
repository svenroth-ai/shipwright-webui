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
  live suppression reports UNRECORDED. Guard DELETED — but its residual moved
  into CR-1 below rather than vanishing; see there.
* EC-2 (a lapsed ignore entry counted as an active suppression) — HALF retired.
  The surviving half now lives in `test_accepted_risks_ignorefile_shape.py`.

Both retirements were confirmed by running the re-vendored gate against a mutated
copy of this repo's real state, not by reading the new code. Keeping a guard the
shared logic now expresses would be duplicated enforcement; deleting one it does
NOT express would be a silent regression, which is why EC-2 was narrowed rather
than removed.

SPLIT (iterate-2026-07-31-revendor-accepted-risk-gate) when this file crossed the
300-line cap, on the seam its own sections already drew. Siblings:
`test_accepted_risks_ignorefile_shape.py` (EC-2) and
`test_accepted_risks_ci_wiring.py` (the gate job's wiring). All three run in BOTH
jobs that matter — `Reviewer Selftest` (pr-review.yml, every PR) and the
`Accepted-risk register (gate)` job itself (security.yml), which is what puts
them on the weekly schedule too. That second wiring is deliberate: the gate's
`expire` half is time-based, and an invariant enforced only on `pull_request` is
absent on exactly the trigger the gate exists for.
"""

from __future__ import annotations

import json
import re

import yaml
from accepted_risks_paths import (
    CLAUDE_SETTINGS,
    REGISTER,
    REPO_ROOT,
    SECURITY_YML,
    runs,
    workflow,
)

#: Live `SHIPWRIGHT_*` toggle -> the register entry that records WHY and UNTIL
#: WHEN. A mapping rather than a bare set since
#: iterate-2026-07-31-revendor-accepted-risk-gate: the value is now ASSERTED to
#: exist in the register, which is what keeps this channel's record alive. See
#: CR-1 below.
_REGISTERED_SEMGREP_KEYS = {
    "SHIPWRIGHT_SEMGREP_ACCEPT_GH_OWNED_ACTION_TAGS":
        "ar-2026-07-18-gh-owned-action-mutable-tags",
}


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

    This guard also carries EC-1's residual — see the second half.
    """
    doc = json.loads(CLAUDE_SETTINGS.read_text(encoding="utf-8"))
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
    assert REGISTER.is_file(), (
        "shipwright_accepted_risks.yaml is missing, but a SHIPWRIGHT_* suppression "
        f"toggle is live in .claude/settings.json: {sorted(present)}.\n"
        "The shared gate cannot catch this - it discovers suppressions from "
        "security.yml and the ignore file, never from .claude/settings.json - so "
        "`check` and `expire` both exit 0 while the toggle silences findings with "
        "its WHY and UNTIL-WHEN deleted. Restore the register, or remove the "
        "toggle in the same change."
    )
    register = yaml.safe_load(REGISTER.read_text(encoding="utf-8")) or {}
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
    scan_runs = "\n".join(runs(workflow(SECURITY_YML), "scan"))
    trivy = [ln for ln in scan_runs.splitlines() if "trivy fs" in ln]
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
         if (REPO_ROOT / n).is_file()),
        None,
    )
    assert match.group(1) == selected, (
        f"Trivy is pointed at `{match.group(1)}` but the register gate reconciles "
        f"against `{selected}` (the first of .trivyignore.yaml/.yml/flat that "
        "exists). They must be the same file, or the gate certifies a suppression "
        "the scanner never applies."
    )

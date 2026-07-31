"""Will Trivy actually APPLY the ignore file this repo ships? (fail-open EC-2.)

Split out of `test_accepted_risks_repo_invariants.py` when it crossed the
300-line cap (iterate-2026-07-31-revendor-accepted-risk-gate), on the seam its
own docstring drew. Sibling modules: `test_accepted_risks_repo_invariants.py`
(the suppression channels this repo uses) and `test_accepted_risks_ci_wiring.py`
(the gate job's wiring). Shared helpers live in `accepted_risks_paths.py`.

THE LAPSED HALF OF THIS GUARD HAS RETIRED. `accepted_risk_scan._is_lapsed` now
drops an entry whose own due date has passed from the discovered set, so its
register counterpart surfaces as STALE with renew-BOTH-dates advice. Confirmed
against the re-vendored gate rather than inferred from it: `expired_at:
2020-01-01` on a live entry in a staged copy of this repo made the real CLI exit
1 naming `GHSA-frvp-7c67-39w9`.

THE MALFORMED HALF HAS NOT, because upstream deliberately left it open.
`_is_lapsed` treats a date it cannot parse as "no expiry" and keeps the entry
ACTIVE; its docstring names that a disclosed limit and files the failure contract
for a structurally invalid ignore file as out of scope. Trivy does the OPPOSITE —
it decodes `expired_at` into a Go `time.Time`, so a single bad date makes it
reject the WHOLE file and apply NO suppression. The same probe with `expired_at:
whenever` exited 0 "no drift" while all three acceptances would in fact be
unsuppressed: the gate certifying a suppression the scanner never applies, which
is CR-2's shape exactly.
"""

from __future__ import annotations

from datetime import date

import yaml
from accepted_risks_paths import TRIVYIGNORE


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


def test_no_trivy_suppression_has_an_unreadable_expiry() -> None:
    """The ignore file must be something Trivy will decode and apply.

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

    `expired_at` must be a PLAIN YAML DATE — `type(...) is date`. A quoted
    string, an RFC3339 timestamp and an int are all rejected, because Trivy
    decodes the field into a Go `time.Time` and yaml.v3 resolves only a YAML
    `!!timestamp` into that type. An earlier draft accepted the quoted and
    timestamp forms as "unverified, and a false red is worse"; that was wrong in
    both directions and is recorded in the code comment below.

    NOT covered, stated rather than implied: a `misconfigurations:`/`secrets:`
    section — a real Trivy suppression channel that neither this guard nor
    `read_trivyignore_ids` reads, so the gate's "the `.trivyignore.yaml` channel"
    is narrower than the file itself.

    Fails CLOSED on everything it does look at.
    """
    # Not an independent existence backstop (that was EC-1, retired — see
    # test_accepted_risks_repo_invariants.py): this guard has to read the file,
    # and a vacuous pass would be worse than a noisy one. An absent file is
    # separately caught by `check`, which turns every trivy-ignore register
    # entry STALE.
    assert TRIVYIGNORE.is_file(), (
        ".trivyignore.yaml is missing, so this guard cannot read it. Restore the "
        "file, or remove the register entries targeting trivy-ignore in the same "
        "change."
    )
    # Decoded STRICTLY, because the question is what Trivy will accept. A
    # duplicate key parses fine for PyYAML and kills the file for Go.
    try:
        doc = yaml.load(TRIVYIGNORE.read_text(encoding="utf-8"), Loader=_StrictLoader)
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
        # EXACTLY a plain YAML date — `type(...) is date`, not `isinstance`, so a
        # `datetime` (which subclasses it) does NOT slip through.
        #
        # Trivy decodes this field into a Go `time.Time`, and yaml.v3 resolves
        # ONLY a YAML `!!timestamp` scalar into that type. PyYAML models the same
        # resolution, which is what makes this checkable offline: unquoted
        # `2026-10-28` -> `date`, quoted `"2026-10-28"` -> `str`, RFC3339 ->
        # `datetime`, `20261028` -> `int`. An impossible day like `2026-02-31`
        # never reaches here — PyYAML fails the load, and the strict-decode guard
        # above turns that into the whole-file failure Trivy would also produce.
        #
        # STRICTER than the earlier draft, deliberately. That version accepted a
        # quoted string and a timestamp, arguing a false RED is worse than an
        # unverified miss. The argument was weak in BOTH directions: the QUOTED
        # form is the one Go most plausibly REJECTS (a `str` does not unmarshal
        # into `time.Time`), so the draft was most permissive exactly where the
        # risk is highest — and since all three live entries are plain dates,
        # requiring that form costs nothing and REMOVES the unverified branch
        # instead of documenting it. The remediation is also safe now: "write it
        # unquoted as YYYY-MM-DD" moves every rejected form to the one accepted
        # form, where the old "quote it" advice moved a caught case into an
        # uncaught one. (Tier-3 PR review; external code review.)
        if type(raw) is date:
            continue
        malformed.append(
            f"{entry.get('id')} (expired_at {raw!r} — a {type(raw).__name__}. "
            "Write it UNQUOTED as YYYY-MM-DD: Trivy decodes this field into a Go "
            "time.Time, which only a plain YAML date resolves to)"
        )

    assert not malformed, (
        "these .trivyignore.yaml entries have an unparseable `expired_at`. Trivy "
        "rejects the ENTIRE ignore file over one bad date, so none of this "
        "repo's acceptances would be suppressed - while the register gate still "
        "counts them as active and reports 'no drift':\n  "
        + "\n  ".join(malformed)
    )

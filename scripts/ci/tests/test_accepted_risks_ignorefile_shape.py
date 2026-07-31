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

import re
from datetime import date

import yaml
from accepted_risks_paths import TRIVYIGNORE

#: Trivy's ONLY accepted `expired_at` shape — the Go layout `2006-01-02`.
#: Deliberately STRICTER than `accepted_risks.coerce_date`, which slices `[:10]`
#: and so accepts trailing junk the scanner rejects.
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
        # Accepts a YAML timestamp too (`datetime` subclasses `date`), which is
        # DELIBERATE and listed as a residual in the docstring: Trivy decodes
        # into a Go `time.Time` and yaml.v3 resolves RFC3339 into that type
        # natively, so a timestamp is plausibly ACCEPTED and Trivy is not
        # installed here to settle it. (External code review.)
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

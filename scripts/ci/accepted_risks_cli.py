#!/usr/bin/env python3
"""Reconcile the accepted-risk register against the suppressions actually in place.

The register (``shipwright_accepted_risks.yaml``) is the human-authored RECORD;
the scanner wiring (``.trivyignore*``, the ``SHIPWRIGHT_SEMGREP_*`` env vars in
``security.yml``) is what actually suppresses. Keeping them as two files only
works if something proves they agree — otherwise the register is documentation
that drifts, which is the failure mode it was built to end.

Two subcommands, both offline and read-only:

``check``    both directions. A suppression with no register entry is an
             UNRECORDED acceptance (nobody knows why it is there or when to
             re-review it). A register entry with no suppression is a STALE
             record (it claims something is accepted that no longer is).
``expire``   fails when an acceptance is past its re-review date.

Both are wired into ``.github/workflows/security.yml`` (job
``Accepted-risk register (gate)``) so they run on every PR AND on the existing
weekly schedule. The schedule is the load-bearing half for ``expire``: expiry is
TIME-based, not diff-based, so a PR-only gate would never fire on an entry that
lapses while nobody happens to open a PR. A gate nothing invokes constrains
nothing.

**``github-dismissal`` entries are NOT checked by ``check``** and are reported
as unchecked there. Their counterpart is live GitHub alert state, not a file, so
the offline gate cannot see them. Printing what was skipped is deliberate — a
gate that silently narrows its own scope reads as "all clear".

Resolving those entries is what canonical's ``converge`` subcommand does, and it
is **deliberately absent from this vendored copy** — see the ADAPTED note below.

VENDORED into shipwright-webui. This repo has no Python ``shared/`` tree and
CI has no shipwright plugin cache, so the accepted-risk gate ships as a
self-contained copy under ``scripts/ci/`` (same pattern as the vendored
``scripts/hooks/anti_ratchet_check.py``).

# canonical-source-repo: https://github.com/svenroth-ai/shipwright
# canonical-source-path: shared/scripts/tools/accepted_risks_cli.py
# canonical-source-hash: a2b18497514476be8a164474a0a88badc7914e252d0f450f6db6866aa6659ce1
# canonical-source-version: iterate-2026-07-31-accepted-risk-gate-holes
# canonical-source-commit: 987e49c6ed290f74242f91645bd812610dad9e7e
#
# The hash above is of canonical's GIT BLOB (LF), reproducible from a clone
# of the canonical repo with:
#
#     git show 987e49c6ed290f74242f91645bd812610dad9e7e:shared/scripts/tools/accepted_risks_cli.py | sha256sum
#
# Use the COMMIT, not the version: the version is an iterate run id and is not
# a git ref. NOT a Windows working-tree hash either - core.autocrlf=true
# yields a different, unreproducible value, which is what every canonical hash
# recorded before iterate-2026-07-31-revendor-accepted-risk-gate actually was.
#
# ADAPTED - NOT byte-identical to canonical:
#   `converge` is REMOVED. It resolves github-dismissal entries against live
#   GitHub state and can mass-dismiss alerts; canonical says no scheduled job
#   may hold that authority. A CI copy that CANNOT converge enforces that
#   structurally rather than by convention. Removing it also drops the
#   `github_code_scanning` import, so this gate stays offline and stdlib-only
#   (plus PyYAML). Run `converge` from the plugin when it is needed.
#   `_SCRIPTS_ROOT` points at this file's own directory: the vendored modules
#   are siblings under scripts/ci/, not a shared/scripts tree.
#   A missing PyYAML now exits 2 with an actionable message instead of dying on
#   an unhandled traceback with exit 1 - which is the SAME code as real drift,
#   so a gate that could not run read as a gate that ran and found something.
#   Found by running the CI steps verbatim against a Python without PyYAML.

Drift guard: ``scripts/ci/accepted_risks_vendor.json`` records this file's
sha256 and ``scripts/ci/tests/test_accepted_risks_vendored.py`` recomputes it,
so an in-place edit fails CI unless the manifest is updated too.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

_SCRIPTS_ROOT = Path(__file__).resolve().parent
if str(_SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_ROOT))

# Sibling imports are wrapped so a BROKEN VENDOR - a module deleted, renamed or
# left syntactically invalid - reports as "the gate could not run" (exit 2)
# rather than dying on an unhandled traceback with exit 1, which is the code that
# means "drift detected". Same confusion the missing-PyYAML handler in main()
# fixes, for a different and likelier trigger. (Stage-2 review, CR-6.)
try:
    from accepted_risks import (  # noqa: E402
        STATIC_TARGETS,
        TARGET_TRIVY_IGNORE,
        RegisterError,
        load_register,
        register_exists,
        today_utc,
    )
    from accepted_risk_scan import (  # noqa: E402
        ACCEPT_GH_ACTION_TAGS_ENV,
        EXCLUDE_RULES_ENV,
        SECURITY_WORKFLOW_REL,
        TRIVYIGNORE_FLAT_NAME,
        TRIVYIGNORE_YAML_NAMES,
        discovered_suppressions,
        read_trivyignore_ids,
        read_workflow_env,
    )
except ImportError as _exc:  # pragma: no cover - guarded by a test
    print(
        f"accepted-risks: the vendored gate is broken - {_exc}. "
        "This is NOT a drift finding. A module under scripts/ci/ is missing, "
        "renamed or unimportable. "
        "Re-vendor per scripts/ci/accepted_risks_vendor.json.",
        file=sys.stderr,
    )
    raise SystemExit(2) from _exc

# The discovery readers live in the shared LEAF module ``accepted_risk_scan`` so
# the compliance dashboard can reuse them by bare module name, instead of this
# ``tools`` package having to be importable from inside a plugin (ADR-044/045).
# Re-exported here so callers and tests of this CLI are unaffected.
__all__ = [
    "ACCEPT_GH_ACTION_TAGS_ENV", "EXCLUDE_RULES_ENV", "SECURITY_WORKFLOW_REL",
    "TRIVYIGNORE_FLAT_NAME", "TRIVYIGNORE_YAML_NAMES", "discovered_suppressions",
    "read_trivyignore_ids", "read_workflow_env", "reconcile", "main",
]


def _ignore_file_exists(project_root: Path | str) -> bool:
    """Whether ANY Trivy ignore-file form is present on disk.

    Distinguishes "no ignore file" from "an ignore file that yielded nothing",
    which the reader reports identically as an empty set.
    """
    root = Path(project_root)
    names = (*TRIVYIGNORE_YAML_NAMES, TRIVYIGNORE_FLAT_NAME)
    return any((root / name).is_file() for name in names)


def reconcile(project_root: Path | str) -> dict:
    """Both-directions comparison of register vs reality.

    An ABSENT register reconciles as an empty one rather than being skipped:
    ``load_register`` already returns ``[]`` for it, and the question this gate
    asks is "is every live suppression recorded?", never "does a file exist?".
    """
    entries = load_register(project_root)
    discovered = discovered_suppressions(project_root)

    # `date.min` predates every date a repo would realistically write, so the
    # expiry filter drops nothing: this is every id in the ignore file, lapsed
    # or not. Subtracting the live ones leaves the lapsed ones. A stale record
    # has three very different causes needing different advice — see
    # `_format_check`; `ignore_unreadable` separates the third from the others.
    written_down = read_trivyignore_ids(project_root, now=date.min)
    lapsed = written_down - discovered[TARGET_TRIVY_IGNORE]
    ignore_unreadable = _ignore_file_exists(project_root) and not written_down

    registered: dict[str, set[str]] = {t: set() for t in STATIC_TARGETS}
    unchecked: list = []
    for entry in entries:
        if entry.statically_checkable:
            registered[entry.target].add(entry.rule)
        else:
            unchecked.append(entry)

    unrecorded: list[tuple[str, str]] = []
    stale: list[tuple[str, str]] = []
    for target in STATIC_TARGETS:
        for rule in sorted(discovered[target] - registered[target]):
            unrecorded.append((target, rule))
        for rule in sorted(registered[target] - discovered[target]):
            stale.append((target, rule))

    return {
        "entries": entries,
        "discovered": discovered,
        "lapsed": lapsed,
        "ignore_unreadable": ignore_unreadable,
        "unrecorded": unrecorded,
        "stale": stale,
        "unchecked": unchecked,
        "ok": not unrecorded and not stale,
    }


def _format_check(result: dict) -> list[str]:
    lines: list[str] = []
    for target, rule in result["unrecorded"]:
        lines.append(
            f"UNRECORDED  {target}: {rule}\n"
            "    A suppression is active with no register entry. Nobody can tell "
            "why it is accepted or when to re-review it.\n"
            f"    Fix: add an entry to shipwright_accepted_risks.yaml, or remove "
            "the suppression."
        )
    for target, rule in result["stale"]:
        if target == TARGET_TRIVY_IGNORE and result.get("ignore_unreadable"):
            # THIRD cause, and the most destructive one to get wrong: the ignore
            # file is there but yielded nothing, so it probably does not parse.
            # The reader reports that identically to "no suppressions", which
            # would otherwise print remove-the-record for every Trivy acceptance
            # in the register — deleting real records over a YAML typo.
            lines.append(
                f"STALE       {target}: {rule}\n"
                "    An ignore file is present but yielded NO entries — it most "
                "likely does not parse. Nothing can be concluded about this "
                "record until that is fixed.\n"
                "    Fix: check the ignore file's syntax first. Do NOT remove "
                "register entries on the strength of this line."
            )
            continue
        if target == TARGET_TRIVY_IGNORE and rule in result.get("lapsed", ()):
            # The entry IS still in the ignore file — its own due date has
            # passed, so the scanner has stopped applying it. Telling the
            # operator to "remove the register entry" here would delete an
            # acceptance that is doing its job, which is the exact outcome
            # `_is_lapsed`'s fail-safe exists to avoid. This is not a corner
            # case: a register `expires` and an ignore `expired_at` set to the
            # SAME day lapse a day apart (the register is active ON its date,
            # Trivy's entry is not), so a diligently paired acceptance lands
            # here for one day at every renewal.
            lines.append(
                f"STALE       {target}: {rule}\n"
                "    The register claims this is accepted, and the ignore entry "
                "is still in the file — but its own expiry (expired_at: / exp:) "
                "has passed, so the scanner already stopped suppressing it.\n"
                "    Fix: renew BOTH dates (the ignore entry's and the "
                "register's), or remove both. Note they lapse a day apart: an "
                "ignore entry expires ON its date, a register entry AFTER its."
            )
            continue
        lines.append(
            f"STALE       {target}: {rule}\n"
            "    The register claims this is accepted, but no such suppression "
            "is in place.\n"
            "    Fix: remove the register entry, or restore the suppression."
        )
    return lines


def cmd_check(project_root: Path) -> int:
    result = reconcile(project_root)
    n_entries = len(result["entries"])
    n_checked = sum(len(v) for v in result["discovered"].values())

    if register_exists(project_root):
        print(
            f"accepted-risks check: {n_entries} register entr"
            f"{'y' if n_entries == 1 else 'ies'}, "
            f"{n_checked} source-controlled suppression(s) reconciled."
        )
    else:
        # Reconciled anyway. Returning success on the missing FILE — as this
        # gate used to, before discovering anything — meant deleting the
        # register silenced it while every suppression it recorded stayed live.
        # A fresh repo still passes, because it suppresses nothing; it now does
        # so by comparison rather than by exemption
        # (iterate-2026-07-31-accepted-risk-gate-holes).
        print(
            f"accepted-risks check: no register at {project_root} - "
            f"reconciling {n_checked} source-controlled suppression(s) "
            "against an empty record."
        )
    # Never let "not checkable offline" read as "checked and clean".
    for entry in result["unchecked"]:
        print(
            f"  UNCHECKED  {entry.target}: {entry.rule} ({entry.id}) - "
            "counterpart is live GitHub state, not a file. This vendored copy "
            "cannot resolve it (no `converge` - see the module docstring); run "
            "the plugin's accepted_risks_cli.py converge from a workstation."
        )

    problems = _format_check(result)
    if problems:
        print("\nAccepted-risk register drift:\n")
        for problem in problems:
            print(problem)
        return 1
    print("  no drift.")
    return 0


def cmd_expire(project_root: Path) -> int:
    if not register_exists(project_root):
        print(f"accepted-risks: no register at {project_root}.")
        return 0
    entries = load_register(project_root)
    now = today_utc()
    overdue = [e for e in entries if e.is_expired(now)]
    if not overdue:
        print(f"accepted-risks expire: {len(entries)} entries, none past due ({now}).")
        return 0
    print(f"Accepted risks past their re-review date (today {now} UTC):\n")
    for entry in overdue:
        print(
            f"EXPIRED  {entry.id}  (due {entry.expires}, ref {entry.rationale_ref})\n"
            f"    {entry.statement[:200]}\n"
            "    Re-review: fix it, or renew `expires` with a fresh rationale."
        )
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Reconcile the accepted-risk register against real suppressions."
    )
    parser.add_argument(
        "command", choices=("check", "expire"),
        help="check register-vs-suppression drift / check expiry",
    )
    parser.add_argument("--project-root", default=".", help="repo root")
    args = parser.parse_args(argv)

    project_root = Path(args.project_root).resolve()
    try:
        if args.command == "check":
            return cmd_check(project_root)
        return cmd_expire(project_root)
    except RegisterError as exc:
        # Fail closed: an unreadable register is never "no acceptances".
        print(f"accepted-risks: register is invalid - {exc}", file=sys.stderr)
        return 2
    except ModuleNotFoundError as exc:  # pragma: no cover - guarded by a test
        # PyYAML is imported lazily inside the register parser, so without it
        # this exited 1 on an unhandled traceback - the SAME code as real drift,
        # and the message a reader would reach for first is "drift detected".
        # A gate that cannot run must never be mistaken for a gate that ran and
        # found something: exit 2, the fail-closed code, with the fix in it.
        #
        # Scoped to `yaml` ONLY. Telling the operator of a security gate to
        # "install pyyaml" when something else is missing would be a confidently
        # wrong diagnosis - the same defect class this handler was written to
        # fix. Anything else re-raises. (Stage-2 review, CR-6.)
        if exc.name != "yaml":
            raise
        print(
            f"accepted-risks: the gate could not run - {exc}.\n"
            "  This is NOT a drift finding. Install the dependency and re-run:\n"
            "      pip install pyyaml\n"
            "  (In CI this is the `Install PyYAML` step of the "
            "`Accepted-risk register (gate)` job in .github/workflows/security.yml.)",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

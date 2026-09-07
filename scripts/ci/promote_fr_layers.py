#!/usr/bin/env python3
"""Orchestration + CLI for FR layer promotion (w5, S10 — see layer_promotion.py).

WHY a separate first-party script that cross-repo-imports the pinned monorepo
checkout, mirroring ``traceability_manifest_gate.py``'s pattern (see that
module's docstring for the rationale against vendoring): the ``test_links``
collector (``build_manifest``), the vitest-JSON parser
(``_evidence_readers.read_vitest``), and the FR-table read/write helpers
(``fr_table_reader``, ``fr_table_shape``, ``markdown_table``) are NOT owned by
this repo and this repo does not want to fork them. This script only wires
already-existing, already-tested machinery together; every DECISION (the
predicate, the escalation cases, the one-way ledger) lives in
``layer_promotion.py``, which has zero cross-repo dependency and is unit-tested
directly.

**Two regen passes, not a hand-patch.** ``spec.md``'s Layers column is the ONE
source of truth the w1 evidence-chain CI gate compares against (it regenerates
FROM spec.md and never trusts a hand-edited manifest field). So: regen #1
(pre-promotion) supplies the requirement bindings ``layer_promotion.py``
evaluates; the promoted rows are then written into ``spec.md``; regen #2
(post-promotion) re-derives the FULL manifest — including ``spec_hash`` and
the untagged-test inventory, which a targeted hand-patch would otherwise leave
silently stale — from that edited ``spec.md``, so the committed manifest is
never anything other than what the real collector would produce.

**The run never writes its own ack** (p3.5 doc, load-bearing): this module only
ever CHECKS for ``layer_promotion_ack.json`` at the run's escalation path; only
an operator (or the campaign orchestrator acting on the operator's behalf)
creates it. Presence + a matching fingerprint of the escalated FR ids is
required to clear the stop — a stale ack from a DIFFERENT escalation set does
not silently clear this one.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Bare identifier only: no path separators, no `..`, no leading dot/hyphen.
_RUN_ID_SAFE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import layer_promotion as lp  # noqa: E402
import promote_fr_layers_io as io_mod  # noqa: E402
from promote_fr_layers_escalation import (  # noqa: E402
    ack_fingerprint, check_ack, resolve_escalation_paths, write_escalation_only,
)
from promote_fr_layers_paths import resolve_confined_path, verify_commit_pin  # noqa: E402

_MANIFEST_REL = io_mod._MANIFEST_REL
_SPEC_REL = io_mod._SPEC_REL
_LEDGER_REL = io_mod._LEDGER_REL


def run(args: argparse.Namespace) -> int:
    # External plan review (openai, medium): `args.run_id` is concatenated into
    # the escalation/ack output paths below — reject anything but a safe bare
    # identifier BEFORE it ever reaches a path, so a `..`/separator-bearing
    # value (an untrusted CI variable, if this CLI were ever invoked that way)
    # cannot write outside `.shipwright/planning/iterate/`.
    if not _RUN_ID_SAFE_RE.match(args.run_id or ""):
        print(json.dumps({
            "success": False,
            "reason": f"--run-id {args.run_id!r} is not a safe bare identifier "
                      "(letters/digits/hyphen/underscore only, no path separators or '..')",
        }, indent=2))
        return 2

    # PR Review (comment): a negative value makes EVERY report look stale
    # (`age > negative_ceiling` is always true), which silently behaves like
    # "reject all evidence" rather than the misconfiguration it actually is.
    if args.evidence_max_age_seconds < 0:
        print(json.dumps({
            "success": False,
            "reason": f"--evidence-max-age-seconds must be >= 0, got {args.evidence_max_age_seconds}",
        }, indent=2))
        return 2

    project_root = Path(args.project_root).resolve()
    try:
        manifest_path = resolve_confined_path(project_root, args.manifest_path, project_root / _MANIFEST_REL)
        spec_path = resolve_confined_path(project_root, args.spec_path, project_root / _SPEC_REL)
        ledger_path = resolve_confined_path(project_root, args.ledger_path, project_root / _LEDGER_REL)
    except ValueError as exc:
        print(json.dumps({"success": False, "reason": str(exc)}, indent=2))
        return 2

    # PR Review (blocking, round 2): `--expect-project-commit` binds the
    # evidence freshness check below to a commit the CALLER names explicitly,
    # not merely to a filesystem mtime a stale-but-recently-touched report
    # could satisfy on its own. Checked here (not via `import_cross_repo`,
    # which verifies the PLUGIN checkout, a different tree entirely).
    if args.expect_project_commit:
        try:
            verify_commit_pin(project_root, args.expect_project_commit)
        except RuntimeError as exc:
            print(json.dumps({"success": False, "reason": str(exc)}, indent=2))
            return 2

    try:
        mods = io_mod.import_cross_repo(Path(args.plugin_root), expect_commit=args.expect_plugin_commit)
    except (ImportError, RuntimeError) as exc:
        print(json.dumps({
            "success": False,
            "reason": f"could not import the pinned shipwright-compliance checkout at "
                      f"'{args.plugin_root}' or its shared/scripts siblings ({type(exc).__name__}: {exc})",
        }, indent=2))
        return 2

    vitest_reports: list[tuple[str, Path]] = []
    for raw in args.vitest_report or []:
        name, _, raw_path = raw.partition("=")
        if not raw_path:
            print(json.dumps({"success": False, "reason": f"--vitest-report expects NAME=PATH, got {raw!r}"}))
            return 2
        vitest_reports.append((name, Path(raw_path)))

    # Combined with the mandatory `--expect-project-commit` check above, an
    # accepted report must be BOTH freshly written AND produced while
    # `project_root` was pinned to the exact commit the caller names (PR
    # Review, blocking, round 2) -- see `check_evidence_freshness`'s
    # docstring for the full rationale, including the future-dated case.
    freshness_error = io_mod.check_evidence_freshness(vitest_reports, args.evidence_max_age_seconds)
    if freshness_error is not None:
        print(json.dumps({"success": False, "reason": freshness_error}, indent=2))
        return 2

    try:
        with open(spec_path, encoding="utf-8", newline="") as fh:
            original_spec_text = fh.read()
        ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.is_file() else {}
        evidence = io_mod.build_evidence(vitest_reports, project_root, mods)
        pre_manifest = io_mod.regen_manifest(project_root, evidence, mods)
    except Exception as exc:  # noqa: BLE001 — the real cross-repo collector can
        # raise implementation-specific errors (KeyError/AttributeError/etc,
        # external plan review GLM #7) this module cannot enumerate; any of
        # them must produce the same structured `{"success": false}` failure,
        # never a raw traceback.
        print(json.dumps({"success": False, "reason": f"failed reading inputs / regenerating: {type(exc).__name__}: {exc}"}))
        return 2

    result = lp.evaluate_manifest(pre_manifest.get("requirements") or {}, evidence, ledger)
    promotions, escalations = result["promotions"], result["escalations"]
    now_iso = datetime.now(timezone.utc).isoformat()

    evidence_source_commit = pre_manifest.get("source_commit", "")
    spec_text = original_spec_text
    try:
        for decision in promotions:
            fr_id, layers = decision["fr_id"], decision["layers"]
            new_cell = mods["fr_table_shape"].render_layers(tuple(layers), inferred=False)
            spec_text = io_mod.rewrite_spec_row(spec_text, fr_id, new_cell, mods)
            ledger[fr_id] = lp.ledger_record(
                fr_id, layers, args.run_id, decision["evidence_test_ids"], now_iso,
                evidence_source_commit=evidence_source_commit,
            )
    except ValueError as exc:
        print(json.dumps({"success": False, "reason": f"failed rewriting spec.md row: {exc}"}, indent=2))
        return 2

    systemic = lp.systemic_pattern(escalations, result["total_evaluated"])
    output = {
        "success": True,
        "run_id": args.run_id,
        "total_evaluated": result["total_evaluated"],
        "promoted": [d["fr_id"] for d in promotions],
        "skipped": [{"fr_id": d["fr_id"], "action": d["action"]} for d in result["skipped"]],
        "escalations": escalations,
        # PR Review (blocking, round 3): `evaluate_manifest` already NAMES
        # every removed FR (external plan review GLM #9b) but this output
        # dropped it, making removals invisible despite the predicate's own
        # claim otherwise.
        "removed_fr_ids": result["removed_fr_ids"],
        "systemic_pattern": systemic,
    }

    escalation_out = ack_path = escalation_content = fingerprint = None
    if escalations:
        try:
            escalation_out, ack_path = resolve_escalation_paths(
                project_root, args.run_id, args.escalation_out, args.ack_path,
            )
        except ValueError as exc:
            print(json.dumps({"success": False, "reason": str(exc)}, indent=2))
            return 2
        fingerprint = ack_fingerprint(escalations)
        escalation_content = json.dumps({**output, "fingerprint": fingerprint}, indent=2, ensure_ascii=False) + "\n"

    if promotions:
        # This write is NOT git-atomic -- nothing is committed until F6, well
        # after this process exits -- but it MUST be atomic with respect to
        # the working tree this process leaves behind (see
        # `promote_fr_layers_io.write_promotions`'s docstring for why the
        # spec.md/manifest/ledger/escalation-report writes and regen #2 are
        # one all-or-nothing unit, restored to `original_spec_text` on ANY
        # failure). PR Review (blocking): the escalation report used to be
        # written separately, AFTER this call, so a failure writing IT left a
        # terminal promotion committed with no matching escalation record --
        # folding it into the same call closes that gap.
        failure = io_mod.write_promotions(
            spec_path=spec_path, manifest_path=manifest_path, ledger_path=ledger_path,
            spec_text=spec_text, original_spec_text=original_spec_text, promotions=promotions,
            evidence=evidence, ledger=ledger, project_root=project_root, mods=mods,
            escalation_write=(escalation_out, escalation_content) if escalations else None,
        )
        if failure is not None:
            print(json.dumps(failure, indent=2))
            return 2
    elif escalations:
        write_error = write_escalation_only(escalation_out, escalation_content, io_mod.atomic_write_text)
        if write_error is not None:
            print(json.dumps({"success": False, "reason": write_error}, indent=2))
            return 2

    if not escalations:
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0

    acked = check_ack(ack_path, fingerprint, args.run_id)

    output["escalation_out"] = str(escalation_out)
    output["ack_path"] = str(ack_path)
    output["ack_recorded"] = acked
    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0 if acked else 3


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--plugin-root", required=True, help="<monorepo>/plugins/shipwright-compliance")
    parser.add_argument(
        "--expect-plugin-commit", required=True,
        help="full SHA the --plugin-root checkout's HEAD must match, verified before anything is "
             "imported from it (PR Review, blocking, round 2: mandatory, no bypass) -- bind this to "
             "the SAME ref this invocation's actions/checkout step pins (mirroring the "
             "`Traceability manifest (gate)` job)",
    )
    parser.add_argument(
        "--expect-project-commit", required=True,
        help="full SHA --project-root's HEAD must match, verified before any --vitest-report is "
             "trusted (PR Review, blocking, round 2): binds the freshness check below to a commit "
             "the caller names explicitly, not merely to a filesystem mtime",
    )
    parser.add_argument("--manifest-path", default=None)
    parser.add_argument("--spec-path", default=None)
    parser.add_argument("--ledger-path", default=None)
    parser.add_argument("--run-id", required=True)
    parser.add_argument(
        "--vitest-report", action="append", default=[],
        help="NAME=PATH to a vitest --reporter=json output; repeatable (one per workspace)",
    )
    parser.add_argument("--escalation-out", default=None)
    parser.add_argument("--ack-path", default=None)
    parser.add_argument(
        "--evidence-max-age-seconds", type=int, default=3600,
        help="reject a --vitest-report older than this, or a future-dated one (freshness ceiling, "
             "external plan review + PR Review)",
    )
    args = parser.parse_args()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())

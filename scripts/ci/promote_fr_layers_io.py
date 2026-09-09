"""Cross-repo import + I/O helpers for FR layer promotion (w5, S10).

Split out of ``promote_fr_layers.py`` (bloat cap, CLAUDE.md "Files under 300
lines"): this module owns every touch of the pinned monorepo checkout and
every read/write of ``spec.md``/the manifest. ``promote_fr_layers.py`` keeps
the orchestration (``run()``/``main()``) and every DECISION stays in
``layer_promotion.py`` — this module makes no promotion/escalation decision
of its own, only fetches and writes what the caller already decided.

WHY a cross-repo import at all rather than vendoring: the ``test_links``
collector (``build_manifest``), the vitest-JSON parser
(``_evidence_readers.read_vitest``), and the FR-table read/write helpers
(``fr_table_reader``, ``fr_table_shape``, ``markdown_table``) are NOT owned by
this repo and this repo does not want to fork them.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import layer_promotion as lp
from promote_fr_layers_paths import verify_commit_pin

_MANIFEST_REL = Path(".shipwright/compliance/test-traceability.json")
_SPEC_REL = Path(".shipwright/planning/01-adopted/spec.md")
_LEDGER_REL = Path(".shipwright/compliance/layer-promotion-ledger.json")


def import_cross_repo(plugin_root: Path, expect_commit: str | None = None):
    """Inserts the pinned checkout's plugin root into ``sys.path``, plus the
    monorepo's ``shared/scripts`` for the FR-table read/write helpers (a
    SEPARATE sys.path entry, so the plugin's ``scripts.*`` namespace and the
    shared ``lib.*`` namespace never collide). When ``expect_commit`` is
    given, the checkout's HEAD is verified against it BEFORE anything is
    added to ``sys.path`` or imported (see ``verify_commit_pin``); omitted
    for a local/manual invocation, where the operator already trusts their
    own checkout the same way they trust any other local script."""
    import sys

    if expect_commit:
        verify_commit_pin(plugin_root.resolve().parent.parent, expect_commit)

    plugin_root_str = str(plugin_root.resolve())
    if plugin_root_str not in sys.path:
        sys.path.insert(0, plugin_root_str)
    monorepo_root = plugin_root.resolve().parent.parent
    monorepo_root_str = str(monorepo_root)
    if monorepo_root_str not in sys.path:
        sys.path.insert(0, monorepo_root_str)
    shared_scripts_str = str(monorepo_root / "shared" / "scripts")
    if shared_scripts_str not in sys.path:
        sys.path.insert(0, shared_scripts_str)

    from scripts.lib.collectors import _test_links_io as io  # noqa: PLC0415
    from scripts.lib.collectors._evidence_readers import read_vitest  # noqa: PLC0415
    from scripts.lib.collectors._evidence_vocab import merge_into  # noqa: PLC0415
    from scripts.lib.collectors.test_links import _validate_manifest, build_manifest  # noqa: PLC0415
    import lib.fr_table_reader as fr_table_reader  # noqa: PLC0415
    import lib.fr_table_shape as fr_table_shape  # noqa: PLC0415
    import markdown_table  # noqa: PLC0415

    return {
        "io": io, "read_vitest": read_vitest, "merge_into": merge_into,
        "build_manifest": build_manifest, "validate_manifest": _validate_manifest,
        "fr_table_reader": fr_table_reader, "fr_table_shape": fr_table_shape,
        "markdown_table": markdown_table,
    }


def check_evidence_freshness(
    vitest_reports: list[tuple[str, Path]], max_age_seconds: int, clock_skew_tolerance: int = 5,
) -> str | None:
    """External plan review (openai, high) + PR Review (blocking, round 2):
    "fresh CI evidence" was previously asserted only in prose, then only
    checked by mtime -- a copied-and-touched old report would pass. This
    still does not prove the report's CONTENT came from the current tree
    (vitest's JSON carries no commit field); pair this with a caller-side
    ``verify_commit_pin`` on ``project_root`` for that binding. A NEGATIVE
    age (a future-dated mtime -- clock skew or a deliberately advanced
    timestamp) is rejected too, not just an old one. ``clock_skew_tolerance``
    (not a hard 0 floor) absorbs ordinary write-then-stat skew: a file this
    process just wrote can observe ``st_mtime`` a few ms AHEAD of
    ``time.time()`` from filesystem timestamp rounding, which would
    otherwise reject a report that is, in fact, brand new. Returns an error
    reason, or ``None`` if every report is fresh."""
    now = time.time()
    for name, path in vitest_reports:
        try:
            age = now - path.stat().st_mtime
        except OSError as exc:
            return f"--vitest-report {name}={path} unreadable: {exc}"
        if age > max_age_seconds or age < -clock_skew_tolerance:
            return (
                f"--vitest-report {name}={path} is {age:.0f}s old (ceiling {max_age_seconds}s, "
                f"floor -{clock_skew_tolerance}s) — supply a report collected just now, not a "
                "stale or future-dated claim (raise --evidence-max-age-seconds only with a "
                "documented reason)"
            )
    return None


def build_evidence(vitest_reports: list[tuple[str, Path]], project_root: Path, mods: dict) -> dict:
    results: dict = {}
    for _name, path in vitest_reports:
        data = json.loads(path.read_text(encoding="utf-8"))
        parsed = mods["read_vitest"](data, root=project_root, base="")
        for tid, ent in parsed.items():
            mods["merge_into"](results, tid, ent)
    return results


def regen_manifest(project_root: Path, evidence: dict, mods: dict) -> dict:
    io = mods["io"]
    fresh = mods["build_manifest"](
        project_root,
        test_roots=io.configured_test_roots(project_root),
        prune_dirs=io.configured_prune_dirs(project_root),
        evidence=evidence,
        enumerate_untagged=True,
        generated_at=datetime.now(timezone.utc).isoformat(),
        source_commit=io.git_head(project_root),
    )
    mods["validate_manifest"](fresh)
    return fresh


def rewrite_spec_row(spec_text: str, fr_id: str, new_layers_cell: str, mods: dict) -> str:
    """Replace exactly ONE FR row's Layers cell, preserving every other cell and
    the file's original line terminators (CRLF/LF, per line, unchanged)."""
    lines = spec_text.splitlines(keepends=True)
    rows = mods["fr_table_reader"].read_fr_rows(spec_text)
    row = next((r for r in rows if r.id == fr_id), None)
    if row is None:
        raise ValueError(f"{fr_id} not found in the FR table — cannot promote a row that does not exist")
    if row.cells[-1] != row.layers_cell:
        # Code review (orchestrator, high): the writer assumes Layers is the
        # row's LAST cell; the reader resolves it by header name instead
        # (fr_table_reader._layers_cell) and admits rows shorter than their
        # header. Refuse rather than silently overwrite a different cell.
        raise ValueError(
            f"{fr_id}'s Layers cell is not this row's last cell (reader "
            "resolved it via named-column lookup) — refusing to guess which "
            "cell to overwrite"
        )
    new_cells = lp.apply_promotion_to_row_cells(row.cells, new_layers_cell)
    original_line = lines[row.lineno]
    terminator = ""
    for t in ("\r\n", "\n", "\r"):
        if original_line.endswith(t):
            terminator = t
            break
    rendered = "| " + " | ".join(mods["markdown_table"].escape_cell(c) for c in new_cells) + " |"
    lines[row.lineno] = rendered + terminator
    return "".join(lines)


def atomic_write_text(path: Path, text: str) -> None:
    """Write via temp-file + ``os.replace`` so `path` is never observable in a
    partially-written (e.g. truncated) state -- code review (orchestrator,
    high): a plain ``open(path, 'w')`` truncates before writing, so a crash
    mid-write leaves the file EMPTY rather than merely stale.

    PR Review (comment, round 5): a failure between creating ``tmp`` and the
    ``os.replace`` (a full disk, a permissions error) used to leave the temp
    file behind forever -- clean it up on any failure. ``unlink(missing_ok)``
    also covers the success path, where ``os.replace`` has already removed
    ``tmp`` by renaming it to ``path``."""
    tmp = path.with_name(f"{path.name}.tmp-{os.getpid()}-{int(time.time() * 1000)}")
    try:
        with open(tmp, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _read_prior(path: Path) -> str | None:
    return path.read_text(encoding="utf-8") if path.is_file() else None


def _restore_or_remove(path: Path, prior: str | None) -> None:
    if prior is None:
        path.unlink(missing_ok=True)
    else:
        atomic_write_text(path, prior)


def write_promotions(
    *, spec_path: Path, manifest_path: Path, ledger_path: Path,
    spec_text: str, original_spec_text: str, promotions: list[dict],
    evidence: dict, ledger: dict, project_root: Path, mods: dict,
    escalation_write: tuple[Path, str] | None = None,
) -> dict | None:
    """Write spec.md, regen #2, the manifest, the ledger, and (when this run
    ALSO has escalations) the escalation report as ONE all-or-nothing unit;
    on any failure (a plain exception OR a KeyboardInterrupt/SystemExit
    interrupting the multi-second regen), restore every file to its pre-run
    content before returning/re-raising.

    Doubt review (orchestrator, medium x2): the previous version (a) rolled
    back ONLY spec.md, so a manifest write that succeeded followed by a
    failing ledger write left a promoted manifest with no ledger entry, and
    (b) the rollback write itself was unguarded -- an `os.replace` failure
    inside the `except` (e.g. the destination held open) replaced the
    original exception and propagated uncaught, leaving spec.md PROMOTED with
    no manifest/ledger. Both are now covered: every file's prior content (or
    absence) is captured before the try, the rollback restores/removes all of
    them, and the rollback itself is guarded so a secondary failure is
    reported explicitly rather than silently losing the original error.

    PR Review (blocking): when promotions and escalations coexist in the same
    run, the escalation report used to be written by the CALLER as a separate,
    unguarded step AFTER this function returned -- an I/O failure there left
    terminal (`explicit`) promotions committed with no matching escalation
    report for the FRs that did NOT promote. `escalation_write`, when given,
    folds that write into this same transaction: it rolls back with
    everything else on failure, exactly like the manifest and ledger.

    Returns a ``{"success": False, "reason": ...}`` dict for an ordinary
    failure (caller should print it and exit non-zero); returns ``None`` on
    success; re-raises a ``BaseException`` that is not a plain ``Exception``
    (``KeyboardInterrupt``/``SystemExit``) after rolling back.
    """
    original_manifest = _read_prior(manifest_path)
    original_ledger = _read_prior(ledger_path)
    original_escalation = _read_prior(escalation_write[0]) if escalation_write else None
    try:
        atomic_write_text(spec_path, spec_text)
        post_manifest = regen_manifest(project_root, evidence, mods)
        for decision in promotions:
            req = (post_manifest.get("requirements") or {}).get(decision["manifest_key"]) or {}
            if req.get("required_layers_source") != "explicit" or req.get("required_layers") != decision["layers"]:
                raise RuntimeError(
                    f"post-promotion regen does not confirm the promotion for {decision['fr_id']} "
                    f"(required_layers_source={req.get('required_layers_source')!r}, "
                    f"required_layers={req.get('required_layers')!r}, expected {decision['layers']!r})"
                )
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_text(manifest_path, json.dumps(post_manifest, indent=2, ensure_ascii=False) + "\n")
        ledger_path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_text(ledger_path, json.dumps(ledger, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
        if escalation_write is not None:
            escalation_out, escalation_content = escalation_write
            escalation_out.parent.mkdir(parents=True, exist_ok=True)
            atomic_write_text(escalation_out, escalation_content)
    except BaseException as exc:  # noqa: BLE001 -- deliberately broad: ANY
        # failure past this point, interrupt included, must roll back.
        rollback_error: BaseException | None = None
        try:
            atomic_write_text(spec_path, original_spec_text)
            _restore_or_remove(manifest_path, original_manifest)
            _restore_or_remove(ledger_path, original_ledger)
            if escalation_write is not None:
                _restore_or_remove(escalation_write[0], original_escalation)
        except BaseException as rollback_exc:  # noqa: BLE001 -- a rollback
            # failure must never silently swallow the original exception.
            rollback_error = rollback_exc
        _files = "spec.md/manifest/ledger" + ("/escalation report" if escalation_write is not None else "")
        if isinstance(exc, Exception):
            reason = (
                f"promotion failed, {_files} rolled back to their pre-run "
                f"content: {type(exc).__name__}: {exc}"
            )
            if rollback_error is not None:
                reason = (
                    f"promotion failed ({type(exc).__name__}: {exc}) AND the rollback itself "
                    f"failed ({type(rollback_error).__name__}: {rollback_error}) -- {_files} may "
                    "be left INCONSISTENT with each other; revert them by hand against their "
                    "pre-run content before re-running"
                )
            return {"success": False, "reason": reason}
        if rollback_error is not None:
            print(json.dumps({
                "success": False,
                "reason": f"interrupted ({type(exc).__name__}) AND the rollback itself failed "
                          f"({type(rollback_error).__name__}: {rollback_error}) -- {_files} may "
                          "be left INCONSISTENT with each other; revert them by hand against "
                          "their pre-run content",
            }, indent=2))
        raise
    return None


__all__ = [
    "_MANIFEST_REL", "_SPEC_REL", "_LEDGER_REL",
    "import_cross_repo", "check_evidence_freshness", "build_evidence", "regen_manifest",
    "rewrite_spec_row", "atomic_write_text", "write_promotions",
]

"""Cross-repo import + I/O helpers for FR layer promotion (w5, S10).

Split out of ``promote_fr_layers.py`` (bloat cap, CLAUDE.md "Files under 300
lines"): this module owns every touch of the pinned monorepo checkout and
every read/write of ``spec.md``/the manifest. ``promote_fr_layers.py`` keeps
the orchestration (``run()``/``main()``) and every DECISION stays in
``layer_promotion.py`` — this module makes no promotion/escalation decision
of its own, only fetches and writes what the caller already decided.

WHY a cross-repo import at all, mirroring ``traceability_manifest_gate.py``'s
pattern (see that module's docstring for the rationale against vendoring):
the ``test_links`` collector (``build_manifest``), the vitest-JSON parser
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

_MANIFEST_REL = Path(".shipwright/compliance/test-traceability.json")
_SPEC_REL = Path(".shipwright/planning/01-adopted/spec.md")
_LEDGER_REL = Path(".shipwright/compliance/layer-promotion-ledger.json")


def import_cross_repo(plugin_root: Path):
    """Same insertion pattern as ``traceability_manifest_gate.py``, plus the
    monorepo's ``shared/scripts`` for the FR-table read/write helpers (a
    SEPARATE sys.path entry, so the plugin's ``scripts.*`` namespace and the
    shared ``lib.*`` namespace never collide)."""
    import sys

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
    mid-write leaves the file EMPTY rather than merely stale."""
    tmp = path.with_name(f"{path.name}.tmp-{os.getpid()}-{int(time.time() * 1000)}")
    with open(tmp, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    os.replace(tmp, path)


def write_promotions(
    *, spec_path: Path, manifest_path: Path, ledger_path: Path,
    spec_text: str, original_spec_text: str, promotions: list[dict],
    evidence: dict, ledger: dict, project_root: Path, mods: dict,
) -> dict | None:
    """Write spec.md, regen #2, the manifest and the ledger as ONE
    all-or-nothing unit; on any failure (a plain exception OR a
    KeyboardInterrupt/SystemExit interrupting the multi-second regen), restore
    spec.md to ``original_spec_text`` before returning/re-raising. Code review
    (orchestrator, high + medium): the previous version only rolled back on
    the regen call, caught ``Exception`` (missing Ctrl-C/SystemExit), and left
    the manifest/ledger writes outside the guarded window entirely -- any of
    those failures left a promoted spec.md with no matching manifest/ledger,
    a permanent hole since ``required_layers_source == "explicit"`` never
    re-evaluates. Also verifies (code review, medium) that regen #2 actually
    reflects every promotion rather than trusting ``render_layers`` blindly.

    Returns a ``{"success": False, "reason": ...}`` dict for an ordinary
    failure (caller should print it and exit non-zero); returns ``None`` on
    success; re-raises a ``BaseException`` that is not a plain ``Exception``
    (``KeyboardInterrupt``/``SystemExit``) after rolling back.
    """
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
    except BaseException as exc:  # noqa: BLE001 -- deliberately broad: ANY
        # failure past this point, interrupt included, must roll back.
        atomic_write_text(spec_path, original_spec_text)
        if isinstance(exc, Exception):
            return {
                "success": False,
                "reason": f"promotion failed, spec.md rolled back to its pre-run content "
                          f"(no manifest/ledger written): {type(exc).__name__}: {exc}",
            }
        raise
    return None


__all__ = [
    "_MANIFEST_REL", "_SPEC_REL", "_LEDGER_REL",
    "import_cross_repo", "build_evidence", "regen_manifest", "rewrite_spec_row",
    "atomic_write_text", "write_promotions",
]

"""Shared STUB cross-repo plumbing for `promote_fr_layers.run()` integration
tests — mirrors `traceability_gate_stub_collector.py`'s pattern (offline,
network-free; `pytest scripts/ci/tests -q` has no monorepo checkout).

The stub `build_manifest` re-derives `required_layers`/`required_layers_source`
from spec.md's Layers cell using the SAME marker rule
`_requirement_parse.py` documents (marker + empty body -> inferred_legacy;
non-empty body, no marker -> explicit) — this is the exact behaviour
`promote_fr_layers.py`'s two-regen-pass design depends on (regen #2 must see a
promoted row as `explicit`). Per-FR test bindings are NOT scanned from real
`@covers` tags (that grammar is out of scope for a stub); each test supplies
them via a small JSON side-fixture (`_stub_tests_by_fr.json`) written next to
spec.md, and `write_tests_fixture` below is the one sanctioned writer of it.

`render_layers`/`escape_cell` are reproduced verbatim from the real modules
(short, and it is exactly the CONTRACT `promote_fr_layers.py` depends on).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_STUB_MODULE_NAMES = (
    "scripts.lib.collectors._evidence_readers",
    "scripts.lib.collectors._evidence_vocab",
    "scripts.lib.collectors._test_links_io",
    "scripts.lib.collectors.test_links",
    "scripts.lib.collectors",
    "scripts.lib",
    "scripts",
    "lib.fr_table_reader",
    "lib.fr_table_shape",
    "lib",
    "markdown_table",
)

_TESTS_FIXTURE_NAME = "_stub_tests_by_fr.json"

_EVIDENCE_READERS_STUB = '''
def read_vitest(data, root=None, base=""):
    """Test-controlled stub: fixtures pass the already-normalized
    `{tid: {status, executed}}` shape directly under `results`."""
    out = {}
    for tid, ent in (data.get("results") or {}).items():
        out[tid] = {"status": ent.get("status", "enabled"), "executed": ent.get("executed", "not_run"), "runner": "vitest"}
    return out
'''

_EVIDENCE_VOCAB_STUB = '''
def merge_into(results, tid, ent):
    results[tid] = ent
'''

_TEST_LINKS_IO_STUB = '''
def configured_test_roots(project_root):
    return []


def configured_prune_dirs(project_root):
    return []


def git_head(project_root):
    return "stubbed-sha"
'''

_TEST_LINKS_STUB = '''
import json
import re
from pathlib import Path

_INFERRED_RE = re.compile(r"\\(\\s*inferred\\s*\\)", re.IGNORECASE)
_LAYER_NAMES = ("unit", "integration", "e2e")


def _parse_layers(cell):
    has_marker = bool(_INFERRED_RE.search(cell))
    body = _INFERRED_RE.sub(" ", cell).strip()
    tokens = [t.strip().lower() for t in re.split(r"[,\\s/|]+", body) if t.strip()]
    layers = [t for t in tokens if t in _LAYER_NAMES]
    if layers:
        source = "inferred_legacy" if has_marker else "explicit"
    else:
        source = "inferred_legacy" if has_marker else "defaulted_legacy"
    return layers, source


def _validate_manifest(manifest):
    pass


def build_manifest(project_root, *, test_roots, prune_dirs, evidence, enumerate_untagged, generated_at, source_commit):
    root = Path(project_root)
    spec_text = (root / ".shipwright" / "planning" / "01-adopted" / "spec.md").read_text(encoding="utf-8")
    fixture_path = root / "TESTS_FIXTURE_NAME_PLACEHOLDER"
    tests_by_fr = json.loads(fixture_path.read_text(encoding="utf-8")) if fixture_path.is_file() else {}

    requirements = {}
    for line in spec_text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("| FR-"):
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        fr_id = cells[0]
        layers, source = _parse_layers(cells[-1])
        tests_by_layer = {}
        for layer, tests in (tests_by_fr.get(fr_id) or {}).items():
            tests_by_layer[layer] = [
                {**t, "executed": (evidence.get(t["id"], {}) or {}).get("executed", "not_run")}
                for t in tests
            ]
        requirements[f"01::{fr_id}"] = {
            "id": fr_id,
            "spec_path": ".shipwright/planning/01-adopted/spec.md",
            "title": fr_id,
            "priority": "Must",
            "status": "active",
            "required_layers": layers,
            "required_layers_source": source,
            "tests": tests_by_layer,
        }
    return {
        "schema_version": 3,
        "collector_version": "stub/1.0.0",
        "generated_at": generated_at,
        "source_commit": source_commit,
        "spec_hash": "sha256:stub",
        "requirements": requirements,
        "orphans": [],
        "invalid_tags": [],
        "untagged_tests": [],
    }
'''.replace("TESTS_FIXTURE_NAME_PLACEHOLDER", _TESTS_FIXTURE_NAME)

_FR_TABLE_READER_STUB = '''
from dataclasses import dataclass


@dataclass(frozen=True)
class FrTableRow:
    id: str
    cells: tuple
    lineno: int
    # Mirrors the real _fr_table_row.FrTableRow contract: resolved by a
    # (stubbed) named-column lookup, not just "last cell" -- this stub's
    # read_fr_rows always resolves Layers as the last cell, matching this
    # repo's current well-formed spec.md rows.
    layers_cell: str = ""
    layers_from_named_col: bool = True


def read_fr_rows(content, *, rejects=None):
    rows = []
    for i, line in enumerate(content.splitlines()):
        stripped = line.strip()
        if not stripped.startswith("|") or not stripped.startswith("| FR-"):
            continue
        inner = stripped.strip("|")
        cells = tuple(c.strip() for c in inner.split("|"))
        rows.append(FrTableRow(id=cells[0], cells=cells, lineno=i, layers_cell=cells[-1]))
    return rows
'''

_FR_TABLE_SHAPE_STUB = '''
INFERRED_MARKER = "(inferred)"


def render_layers(layers, *, inferred):
    body = ", ".join(layers)
    if not inferred:
        return body
    return f"{body} {INFERRED_MARKER}" if body else INFERRED_MARKER
'''

_MARKDOWN_TABLE_STUB = '''
_TRANSFORMS = (("\\\\", "\\\\\\\\"), ("|", "\\\\|"), ("\\r\\n", " "), ("\\r", " "), ("\\n", " "))


def escape_cell(value):
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    for src, dst in _TRANSFORMS:
        text = text.replace(src, dst)
    return text
'''


def _write_stub_tree(plugin_root: Path) -> None:
    collectors_dir = plugin_root / "scripts" / "lib" / "collectors"
    collectors_dir.mkdir(parents=True)
    (collectors_dir / "_evidence_readers.py").write_text(_EVIDENCE_READERS_STUB, encoding="utf-8")
    (collectors_dir / "_evidence_vocab.py").write_text(_EVIDENCE_VOCAB_STUB, encoding="utf-8")
    (collectors_dir / "_test_links_io.py").write_text(_TEST_LINKS_IO_STUB, encoding="utf-8")
    (collectors_dir / "test_links.py").write_text(_TEST_LINKS_STUB, encoding="utf-8")

    monorepo_root = plugin_root.parent.parent
    shared_lib_dir = monorepo_root / "shared" / "scripts" / "lib"
    shared_lib_dir.mkdir(parents=True)
    (shared_lib_dir / "fr_table_reader.py").write_text(_FR_TABLE_READER_STUB, encoding="utf-8")
    (shared_lib_dir / "fr_table_shape.py").write_text(_FR_TABLE_SHAPE_STUB, encoding="utf-8")
    (monorepo_root / "shared" / "scripts" / "markdown_table.py").write_text(_MARKDOWN_TABLE_STUB, encoding="utf-8")


def write_tests_fixture(project_root: Path, tests_by_fr: dict) -> None:
    """The one sanctioned writer of the stub's per-FR test-binding side-fixture."""
    (project_root / _TESTS_FIXTURE_NAME).write_text(json.dumps(tests_by_fr), encoding="utf-8")


def _cleanup(plugin_root: Path) -> None:
    for name in _STUB_MODULE_NAMES:
        sys.modules.pop(name, None)
    monorepo_root = plugin_root.resolve().parent.parent
    for candidate in (plugin_root.resolve(), monorepo_root, monorepo_root / "shared" / "scripts"):
        candidate_str = str(candidate)
        if candidate_str in sys.path:
            sys.path.remove(candidate_str)


@pytest.fixture()
def stub_plugin_root(tmp_path: Path):
    """`<tmp_path>/monorepo/plugins/shipwright-compliance`, so
    `.parent.parent` lands on `<tmp_path>/monorepo` exactly as it would for a
    real pinned checkout, and `shared/scripts` sits alongside `plugins/`."""
    plugin_root = tmp_path / "monorepo" / "plugins" / "shipwright-compliance"
    _write_stub_tree(plugin_root)
    try:
        yield plugin_root
    finally:
        _cleanup(plugin_root)

"""Shared STUB `test_links` collector plumbing for the `run()` integration
tests. Split out (bloat ceiling) so neither
`test_traceability_manifest_gate_run.py` (the success/stale/missing-manifest
cases) nor `test_traceability_manifest_gate_run_infra_failures.py` (the
import/call/exception-catch-all cases) needs to duplicate the stub-writing
and `sys.path`/`sys.modules` teardown plumbing.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_STUB_MODULE_NAMES = (
    "scripts.lib.collectors.test_links",
    "scripts.lib.collectors._test_links_io",
    "scripts.lib.collectors",
    "scripts.lib",
    "scripts",
)

_IO_STUB = '''
def configured_test_roots(project_root):
    return []


def configured_prune_dirs(project_root):
    return []


def git_head(project_root):
    return "stubbed-sha"
'''

_COLLECTOR_STUB = '''
def _validate_manifest(manifest):
    pass


def build_manifest(project_root, *, test_roots, prune_dirs, evidence,
                    enumerate_untagged, generated_at, source_commit):
    return {
        "schema_version": 3,
        "collector_version": "stub/1.0.0",
        "generated_at": generated_at,
        "source_commit": source_commit,
        "spec_hash": "sha256:stub",
        "requirements": {},
        "orphans": [],
        "invalid_tags": [],
        "invalid_layers": [],
        "untagged_tests": [],
    }
'''


def _write_stub_plugin(plugin_root: Path) -> None:
    collectors_dir = plugin_root / "scripts" / "lib" / "collectors"
    collectors_dir.mkdir(parents=True)
    (collectors_dir / "_test_links_io.py").write_text(_IO_STUB, encoding="utf-8")
    (collectors_dir / "test_links.py").write_text(_COLLECTOR_STUB, encoding="utf-8")


def _cleanup(plugin_root: Path) -> None:
    for name in _STUB_MODULE_NAMES:
        sys.modules.pop(name, None)
    # `run()` inserts BOTH `plugin_root` and its `.parent.parent` (the
    # monorepo checkout root) — removing only the first left the second
    # (here: `tmp_path`'s own parent, shared by the whole pytest session) on
    # `sys.path` for every later test (external code review, 2026-09-06, low
    # severity).
    for candidate in (plugin_root.resolve(), plugin_root.resolve().parent.parent):
        candidate_str = str(candidate)
        if candidate_str in sys.path:
            sys.path.remove(candidate_str)


@pytest.fixture()
def stub_plugin_root(tmp_path: Path):
    """Writes a minimal stand-in `test_links` collector package and cleans up
    both `sys.path` and the module cache afterwards — each test gets a fresh
    tmp_path, but the imported module NAMES are always the same
    (`scripts.lib.collectors...`), so a stale cached module from a prior test
    would otherwise leak into the next one. Fixture teardown (not in-test
    cleanup) runs even if the test body raises/fails an assertion — external
    code review, 2026-09-06, low severity."""
    plugin_root = tmp_path / "plugin_root"
    _write_stub_plugin(plugin_root)
    try:
        yield plugin_root
    finally:
        _cleanup(plugin_root)


@pytest.fixture()
def empty_plugin_root(tmp_path: Path):
    """No stub written — reproduces what happens when the pinned monorepo
    commit renamed/removed the collector module entirely. Same
    exception-safe teardown as `stub_plugin_root`."""
    plugin_root = tmp_path / "empty_plugin_root"
    plugin_root.mkdir()
    try:
        yield plugin_root
    finally:
        _cleanup(plugin_root)

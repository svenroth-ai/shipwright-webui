"""Real-checkout smoke test for `promote_fr_layers_io.import_cross_repo()` --
PR Review (blocking, round 4): the sibling integration tests exercise only a
self-authored STUB of the shipwright-compliance collector (see
`promote_fr_layers_stub.py`'s docstring for why: offline, network-free, one
process per test run). That stub is a contract ASSUMPTION, never verified
against the real thing in this offline suite. This test verifies the
assumption instead of replacing it: it fetches this test's own pinned commit
of the monorepo (below), imports the
REAL collector through the REAL `import_cross_repo()` (commit-pin verification
included), and asserts the handful of symbols/shapes this repo's code
actually depends on are still there.

This is a genuine NETWORK-TOUCHING test, unlike every other test in this
directory -- PR Review (blocking, round 8, escalated from a comment in
rounds 4 and 6): an ordinary `pytest` run must never silently reach out to
GitHub, so this is OPT-IN via `SHIPWRIGHT_RUN_NETWORK_TESTS=1`, not merely
"skip loudly on failure" as it was before. The default collection run stays
fully offline and deterministic; a CI job that wants this coverage (there is
currently none -- this script has zero callers in any workflow) sets the
env var explicitly, the same way it would use a dedicated integration-test
job rather than folding a network dependency into the unit-test suite.
Under opt-in, it still skips loudly (never fails) when the network or git
are genuinely unavailable, mirroring this repo's own `bootstrapper`
marketplace-contract test philosophy (see CLAUDE.md's bootstrapper job
docs).

@covers FR-01.66
"""

from __future__ import annotations

import inspect
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import promote_fr_layers_io as io_mod  # noqa: E402

# This test's own pin, independent of any CI workflow -- re-pin by bumping
# the SHA below when the monorepo's plugin/collector surface moves.
_PINNED_REPO_URL = "https://github.com/svenroth-ai/shipwright.git"
_PINNED_COMMIT = "7e106939fbf82331f5e54a4ea27d90b4f279f1ce"

# The REAL collector installs under these SAME dotted names the stub tests
# use (see `promote_fr_layers_stub.py`'s `_STUB_MODULE_NAMES` and its own
# `_cleanup`) -- this module must clean up identically, or a real module left
# in `sys.modules` after this test shadows the stub a LATER test tries to
# install, silently breaking it regardless of file-discovery order.
_REAL_MODULE_NAMES = (
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


@pytest.fixture(scope="module")
def real_plugin_root(tmp_path_factory) -> Path:
    if os.environ.get("SHIPWRIGHT_RUN_NETWORK_TESTS") != "1":
        pytest.skip(
            "network-touching test is opt-in -- set SHIPWRIGHT_RUN_NETWORK_TESTS=1 "
            "to fetch the pinned shipwright-compliance checkout and run it"
        )
    checkout = tmp_path_factory.mktemp("shipwright-monorepo-pinned")
    try:
        subprocess.run(["git", "init", "-q"], cwd=checkout, check=True, timeout=30)
        subprocess.run(
            ["git", "fetch", "--depth", "1", "-q", _PINNED_REPO_URL, _PINNED_COMMIT],
            cwd=checkout, check=True, timeout=60,
        )
        subprocess.run(["git", "checkout", "-q", "FETCH_HEAD"], cwd=checkout, check=True, timeout=30)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        pytest.skip(f"could not fetch the pinned shipwright-compliance checkout (network/git unavailable): {exc}")
    plugin_root = checkout / "plugins" / "shipwright-compliance"
    if not plugin_root.is_dir():
        pytest.skip(f"pinned commit {_PINNED_COMMIT} has no plugins/shipwright-compliance directory")
    try:
        yield plugin_root
    finally:
        for name in _REAL_MODULE_NAMES:
            sys.modules.pop(name, None)
        monorepo_root = plugin_root.resolve().parent.parent
        for candidate in (plugin_root.resolve(), monorepo_root, monorepo_root / "shared" / "scripts"):
            candidate_str = str(candidate)
            if candidate_str in sys.path:
                sys.path.remove(candidate_str)


def test_the_real_pinned_checkout_verifies_and_imports(real_plugin_root):
    mods = io_mod.import_cross_repo(real_plugin_root, expect_commit=_PINNED_COMMIT)
    assert callable(mods["build_manifest"])
    assert callable(mods["validate_manifest"])
    assert callable(mods["read_vitest"])
    assert callable(mods["merge_into"])
    assert hasattr(mods["fr_table_reader"], "read_fr_rows") and callable(mods["fr_table_reader"].read_fr_rows)
    assert hasattr(mods["fr_table_shape"], "render_layers") and callable(mods["fr_table_shape"].render_layers)
    assert hasattr(mods["markdown_table"], "escape_cell") and callable(mods["markdown_table"].escape_cell)

    # The specific kwargs promote_fr_layers_io.regen_manifest passes -- if the
    # pinned commit renamed/reshaped any of these, this fails LOUD here
    # instead of as a cryptic TypeError deep in a real CI run.
    build_manifest_params = set(inspect.signature(mods["build_manifest"]).parameters)
    for expected in (
        "project_root", "test_roots", "prune_dirs", "evidence",
        "enumerate_untagged", "generated_at", "source_commit",
    ):
        assert expected in build_manifest_params, f"build_manifest lost its {expected!r} parameter"


def test_the_real_pinned_checkout_rejects_a_wrong_expected_commit(real_plugin_root):
    with pytest.raises(RuntimeError, match="not the expected commit"):
        io_mod.import_cross_repo(real_plugin_root, expect_commit="0" * 40)

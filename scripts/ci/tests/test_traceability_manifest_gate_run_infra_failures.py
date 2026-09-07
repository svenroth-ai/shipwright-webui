"""Network-free integration tests for `traceability_manifest_gate.run()`:
the infra-failure cases — the pinned collector import failing, the collector
call itself raising, or the collector raising an exception subclass neither
of the other two exception blocks catches. Split out of
`test_traceability_manifest_gate_run.py` at the bloat ceiling (same seam —
that module covers the success/stale/missing-manifest cases). All of these
must exit **2** (infra failure), never **1** (the same code as a genuine
staleness verdict) — see `traceability_manifest_gate.py`'s `run()` docstring
comments for the full rationale.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from traceability_manifest_gate import run  # noqa: E402
from traceability_gate_stub_collector import _IO_STUB, _cleanup, empty_plugin_root  # noqa: E402,F401


def test_run_names_the_pin_when_the_collector_cannot_be_imported(
    empty_plugin_root: Path, tmp_path: Path, capsys
) -> None:
    """No stub written — reproduces what happens when the pinned monorepo
    commit renamed/removed the collector module. The error must name the
    plugin root so a maintainer knows which pin to re-check, not surface a
    bare ModuleNotFoundError traceback mid-CI. Exit code 2 (infra failure),
    not 1 (stale) — this never got far enough to compute a staleness verdict
    (external code review, 2026-09-06, medium severity)."""
    committed = tmp_path / "test-traceability.json"
    committed.write_text("{}", encoding="utf-8")

    exit_code = run(empty_plugin_root, tmp_path, committed)

    assert exit_code == 2
    out = json.loads(capsys.readouterr().out)
    assert out["success"] is False
    assert str(empty_plugin_root.resolve()) in out["reason"]


def test_run_returns_2_when_the_collector_call_itself_raises(
    tmp_path: Path, capsys
) -> None:
    """The module imports fine (unlike the pin-moved case above) but calling
    `build_manifest` raises — a reshaped signature in the pinned commit, or a
    genuine internal collector bug. Either way this is an infra failure
    (exit 2), never misreported as `stale` (exit 1) — external code review,
    2026-09-06, medium severity."""
    plugin_root = tmp_path / "broken_plugin_root"
    collectors_dir = plugin_root / "scripts" / "lib" / "collectors"
    collectors_dir.mkdir(parents=True)
    (collectors_dir / "_test_links_io.py").write_text(_IO_STUB, encoding="utf-8")
    (collectors_dir / "test_links.py").write_text(
        "def _validate_manifest(manifest):\n"
        "    pass\n\n\n"
        "def build_manifest(*args, **kwargs):\n"
        "    raise TypeError('signature changed upstream')\n",
        encoding="utf-8",
    )
    committed = tmp_path / "test-traceability.json"
    committed.write_text("{}", encoding="utf-8")

    try:
        exit_code = run(plugin_root, tmp_path, committed)
    finally:
        _cleanup(plugin_root)

    assert exit_code == 2
    out = json.loads(capsys.readouterr().out)
    assert out["success"] is False
    assert "signature changed upstream" in out["reason"]


def test_run_returns_2_when_the_collector_raises_a_bare_exception_subclass(
    tmp_path: Path, capsys
) -> None:
    """`_validate_manifest` raises `ValueError` on a schema-invalid regen, and
    the collector's `ManifestIntegrityError` deliberately subclasses bare
    `Exception`, not `ValueError` — neither is an `ImportError` or an
    `AttributeError`/`TypeError`, so without the catch-all this escaped
    uncaught and exited 1, the SAME code as a genuine staleness verdict
    (external code review, 2026-09-06 round 2, medium severity). Simulated
    here with a custom `Exception` subclass raised from `_validate_manifest`
    — the exact shape of `ManifestIntegrityError`."""
    plugin_root = tmp_path / "integrity_error_plugin_root"
    collectors_dir = plugin_root / "scripts" / "lib" / "collectors"
    collectors_dir.mkdir(parents=True)
    (collectors_dir / "_test_links_io.py").write_text(_IO_STUB, encoding="utf-8")
    (collectors_dir / "test_links.py").write_text(
        "class ManifestIntegrityError(Exception):\n"
        "    pass\n\n\n"
        "def _validate_manifest(manifest):\n"
        "    raise ManifestIntegrityError('duplicate requirement id')\n\n\n"
        "def build_manifest(*args, **kwargs):\n"
        "    return {}\n",
        encoding="utf-8",
    )
    committed = tmp_path / "test-traceability.json"
    committed.write_text("{}", encoding="utf-8")

    try:
        exit_code = run(plugin_root, tmp_path, committed)
    finally:
        _cleanup(plugin_root)

    assert exit_code == 2
    out = json.loads(capsys.readouterr().out)
    assert out["success"] is False
    assert "duplicate requirement id" in out["reason"]

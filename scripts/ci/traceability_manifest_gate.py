#!/usr/bin/env python3
"""CI gate: regenerate the requirement<->test traceability manifest and diff it
against the committed one (`.shipwright/compliance/test-traceability.json`).

Sub-iterate w1 (campaign req3-06-mechanics-webui) — "Evidence chain: CI
regenerates the manifest and it must match the commit". Mirrors, for this repo,
what the `test_links` collector's own docstring calls out as future work: "TT5 —
enforcing gates regenerate base+head themselves".

WHY a separate first-party script rather than a vendored copy of the collector:
the collector (`scripts/lib/collectors/test_links.py` in the shipwright monorepo's
`shipwright-compliance` plugin) is NOT vendored into this repo — it is imported
directly from a second, SHA-pinned checkout of the monorepo (see the
`Traceability manifest (gate)` job in `.github/workflows/ci.yml`). That avoids a
~850-line, multi-file vendor-with-hash-drift-guard (the `scripts/ci/accepted_risks*`
pattern) for a script this repo does not own and cannot usefully fork. This file is
the CI-local glue: it locates the plugin, calls its pure `build_manifest()`, and
diffs the result (via `traceability_manifest_diff.py`, split out at the bloat
ceiling — see that module's docstring for the full normalization SCOPE DECISION,
including why `status`/`executed`/`coverage`/link-order/`source_commit` are all
deliberately excluded from what counts as staleness) against what is committed
here.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from traceability_manifest_diff import _normalize, _summarize_diff

_COMMITTED_MANIFEST_REL = Path(".shipwright/compliance/test-traceability.json")


def run(plugin_root: Path, project_root: Path, committed_path: Path) -> int:
    plugin_root_str = str(plugin_root.resolve())
    if plugin_root_str not in sys.path:
        sys.path.insert(0, plugin_root_str)

    # Also add the monorepo checkout ROOT (external code review, 2026-09-06,
    # medium severity): `plugin_root` is `<checkout>/plugins/shipwright-compliance`
    # per the pinned layout (see the `sparse-checkout` in ci.yml, which pulls
    # BOTH `plugins/shipwright-compliance` and `shared/scripts` under the same
    # checkout root). The collector's stated `shared/scripts` dependency would
    # need that root importable as `shared.scripts...`, not just the plugin
    # root — inserting it too is harmless if unused (an extra `sys.path` entry
    # with no matching import is a no-op) and avoids a misleading "re-pin"
    # error for what would actually be a missing-path problem.
    monorepo_root_str = str(plugin_root.resolve().parent.parent)
    if monorepo_root_str not in sys.path:
        sys.path.insert(0, monorepo_root_str)

    # Deferred: only resolvable once plugin_root is on sys.path (namespace
    # package, no `scripts/__init__.py` upstream — see module docstring). This
    # cross-repo import AND the calls below are an unversioned API coupling
    # (external code review, 2026-09-06): if the pinned monorepo commit ever
    # renames/reshapes the collector module — or keeps it importable but
    # changes an entrypoint's name or signature — fail with a message that
    # names the pin to re-check, rather than a bare `ModuleNotFoundError` /
    # `AttributeError` / `TypeError` mid-CI. Deliberately broad: any of the
    # three exception types below means "the pinned commit moved", not "the
    # manifest is stale", and both need the same remediation.
    project_root = project_root.resolve()
    try:
        from scripts.lib.collectors import _test_links_io as io  # noqa: PLC0415
        from scripts.lib.collectors.test_links import (  # noqa: PLC0415
            _validate_manifest,
            build_manifest,
        )
        fresh = build_manifest(
            project_root,
            test_roots=io.configured_test_roots(project_root),
            prune_dirs=io.configured_prune_dirs(project_root),
            evidence={},
            enumerate_untagged=True,
            generated_at="1970-01-01T00:00:00+00:00",
            source_commit=io.git_head(project_root),
        )
        _validate_manifest(fresh)  # fail loud on a schema-invalid regen, same as the real collector
    except ImportError as exc:
        # The module could not even be found — the pin almost certainly moved,
        # was renamed, or removed the module entirely.
        print(json.dumps({
            "success": False,
            "reason": (
                "could not import the pinned shipwright-compliance checkout at "
                f"'{plugin_root_str}'. The pinned commit (see `ref:` on the "
                "`Checkout shipwright-compliance plugin (pinned)` step in "
                ".github/workflows/ci.yml) likely moved, renamed, or removed "
                f"`build_manifest` / `_validate_manifest` / `_test_links_io` — "
                f"re-pin and update this gate to match. ({type(exc).__name__}: {exc})"
            ),
        }, indent=2))
        return 2
    except (AttributeError, TypeError) as exc:
        # The module imported fine, but calling it failed — this is either a
        # signature/shape change in the pinned commit, OR a genuine internal
        # error inside the collector itself; distinguishing the two from here
        # is not reliable, so this is reported as "infra failure", the same
        # exit code as an import failure and distinct from "stale" (external
        # code review, 2026-09-06, medium severity) — this is NOT a manifest
        # staleness verdict, it never got far enough to compute one.
        print(json.dumps({
            "success": False,
            "reason": (
                "the pinned shipwright-compliance checkout at "
                f"'{plugin_root_str}' imported, but calling `build_manifest`/"
                "`_validate_manifest` failed. The pinned commit (see `ref:` on "
                "the `Checkout shipwright-compliance plugin (pinned)` step in "
                ".github/workflows/ci.yml) likely reshaped an entrypoint's "
                "signature this gate depends on, OR the collector itself has a "
                f"genuine internal bug — re-pin and update this gate to match, "
                f"or investigate the collector. ({type(exc).__name__}: {exc})"
            ),
        }, indent=2))
        return 2
    except Exception as exc:  # noqa: BLE001
        # Catch-all for what the collector itself can raise that is neither
        # of the two typed cases above: `_validate_manifest` raises
        # `ValueError` on a schema-invalid regen (by its own inline comment,
        # "fail loud"), and its `ManifestIntegrityError` deliberately
        # subclasses bare `Exception`, not `ValueError` — both are reachable
        # collector-internal failures, not "the pin moved" and not "the
        # manifest is stale" (external code review, 2026-09-06 round 2,
        # medium severity: without this, either exception escaped uncaught
        # and exited 1 — the SAME code as a genuine staleness verdict, with
        # no JSON envelope at all).
        print(json.dumps({
            "success": False,
            "reason": (
                "the pinned shipwright-compliance checkout at "
                f"'{plugin_root_str}' raised regenerating or validating the "
                "manifest — this is a collector-internal failure (a "
                "schema-invalid regen, or a genuine bug), not a manifest "
                f"staleness verdict. ({type(exc).__name__}: {exc})"
            ),
        }, indent=2))
        return 2

    if not committed_path.is_file():
        print(json.dumps({
            "success": False,
            "reason": f"no committed manifest at {committed_path}",
        }, indent=2))
        return 1

    try:
        committed = json.loads(committed_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(json.dumps({
            "success": False,
            "reason": f"committed manifest at {committed_path} is not valid JSON ({exc})",
        }, indent=2))
        return 1

    # Informational only (see traceability_manifest_diff.py's docstring) —
    # never gates success/failure.
    source_commit_info = {
        "committed_source_commit": committed.get("source_commit"),
        "head": fresh.get("source_commit"),
    }

    normalized_committed = _normalize(committed)
    normalized_fresh = _normalize(fresh)

    if normalized_committed == normalized_fresh:
        print(json.dumps({
            "success": True,
            "message": "manifest is current",
            "info": source_commit_info,
        }, indent=2))
        return 0

    diff_lines = _summarize_diff(normalized_committed, normalized_fresh)
    print(json.dumps({
        "success": False,
        "message": (
            "the committed traceability manifest "
            f"({committed_path}) is stale — it does not match a regen from the "
            "current commit. Re-run the compliance regen (test_links collector) "
            "and commit the result."
        ),
        "diff": diff_lines,
        "info": source_commit_info,
    }, indent=2))
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--plugin-root", required=True,
        help="Checked-out shipwright-compliance plugin root "
             "(<monorepo>/plugins/shipwright-compliance)",
    )
    parser.add_argument("--project-root", default=".", help="This repo's root")
    parser.add_argument(
        "--committed",
        default=None,
        help=f"Path to the committed manifest (default: <project-root>/{_COMMITTED_MANIFEST_REL})",
    )
    args = parser.parse_args()

    project_root = Path(args.project_root)
    committed_path = (
        Path(args.committed) if args.committed else project_root / _COMMITTED_MANIFEST_REL
    )
    return run(Path(args.plugin_root), project_root, committed_path)


if __name__ == "__main__":
    sys.exit(main())

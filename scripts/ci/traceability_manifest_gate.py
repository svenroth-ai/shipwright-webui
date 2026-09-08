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

SEVERITY (revised iterate-2026-09-08-manifest-regen-finalization, trg-1324dfc4):
`run()`'s exit code is unchanged (0 current, 1 stale, 2 infra failure) and is
still what the CI job's step reports — but the JOB STEP that calls it now sets
`continue-on-error: true`, so a stale manifest no longer red-lines `main`. Five
prior repair rounds (#436/#438/#441/#443/#444/#446, one commit each) proved the
opposite design wrong empirically: this class fires on nearly every ordinary PR
that adds a test (any new test lacking an `@covers` tag moves `untagged_tests`),
so a HARD gate on `push` produced a repair commit more often than it caught a
genuine defect, and blocked every unrelated iterate behind someone noticing and
fixing it (`main_health.py` reads this as `red`). The same reclassification —
structural drift reported but non-blocking — already exists for the identical
failure class in the monorepo's own `shared/scripts/tools/ci_manifest_drift_check.py`
(iterate-2026-08-26-r1b): "exit 1 (structural drift) is real drift, reported,
never a reason by itself to fail the build". This module adopts the same posture
rather than inventing a second one.

Advisory does not mean unattended forever: the `--write-fresh` flag (below) lets
the SAME job's next step commit the fresh regen to a dedicated branch and open a
PR when (and only when) `run()` returned 1 — see the `Open a regen PR ...` step
in ci.yml. That step is intentionally NOT wired to auto-merge (see its own
comment for the credential/trigger reasons); a human or the next iterate's
`main-repair` procedure still merges it, just without first having to notice the
drift and hand-author the fix.

Committing the regenerated manifest FROM AN ITERATE BRANCH remains forbidden and
unrelated to this change — `.shipwright/compliance/test-traceability.json` is
in `shared/scripts/lib/derived_snapshots.py`'s `DERIVED_SNAPSHOTS`, enforced by
F11's `check_no_derived_snapshots_committed` (iterate-2026-07-27), because a
branch-local regen sees the WRONG git history (pre-squash SHAs) and N parallel
iterates would collide N(N-1)/2 times on a file carrying none of their actual
changes. The auto-heal step below runs on `main` itself, post-merge, from a
single serialized job — neither problem applies there.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from traceability_manifest_diff import _normalize, _summarize_diff

_COMMITTED_MANIFEST_REL = Path(".shipwright/compliance/test-traceability.json")


def run(
    plugin_root: Path,
    project_root: Path,
    committed_path: Path,
    write_fresh: Path | None = None,
) -> int:
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

    if write_fresh is not None:
        # Written unconditionally once a regen SUCCEEDS (even if the committed
        # file below turns out missing/malformed) — the auto-heal step that
        # reads this needs a usable fresh manifest regardless of which
        # staleness shape triggered it. Same shape/fields as `fresh` is
        # compared with (including the frozen `generated_at` and the real
        # `source_commit`) so this is byte-for-byte what a passing gate would
        # have accepted, never a second, subtly different regen.
        write_fresh.parent.mkdir(parents=True, exist_ok=True)
        write_fresh.write_text(json.dumps(fresh, indent=2) + "\n", encoding="utf-8")

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
    parser.add_argument(
        "--write-fresh",
        default=None,
        help="Also write the freshly regenerated manifest to this path whenever the "
             "regen itself succeeds (independent of whether it matches --committed). "
             "Consumed by the CI job's auto-heal step (see ci.yml) to prepare a fix "
             "PR without a second regen.",
    )
    args = parser.parse_args()

    project_root = Path(args.project_root)
    committed_path = (
        Path(args.committed) if args.committed else project_root / _COMMITTED_MANIFEST_REL
    )
    write_fresh = Path(args.write_fresh) if args.write_fresh else None
    return run(Path(args.plugin_root), project_root, committed_path, write_fresh)


if __name__ == "__main__":
    sys.exit(main())

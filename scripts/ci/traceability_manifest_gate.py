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
diffs the result against what is committed here.

SCOPE DECISION — execution evidence is deliberately excluded from the diff. The
collector's `status`/`executed` fields on each test link come ONLY from a raw
JUnit/Vitest/Playwright report dropped at a conventional location
(`_execution_evidence_io.refresh_index`); this job does not run the test suites
itself (they already run in `client-checks` / `server-checks`), so a bare regen
here always yields `status=enabled, executed=not_run` for every link. Comparing
those fields would make the gate permanently red, for a reason that has nothing to
do with the manifest being stale. What this gate DOES catch — and what "stale"
means for this acceptance criterion — is drift between the FR<->test topology
(added/removed requirements, added/removed `@covers` bindings, orphans, invalid
tags, `spec_hash`) and the current commit; `generated_at` is a timestamp and is
excluded for the same reason `status`/`executed` are.

`source_commit` IS ALSO excluded from the pass/fail comparison — **reversed from
this file's first draft** after external code review (2026-09-06, reject-severity
finding) proved the original design unsatisfiable by construction, and this
repo's own history confirms it empirically: every commit that carries a
regenerated manifest necessarily writes a `source_commit` equal to that
manifest's own PARENT commit, never to the commit it is about to become part of
— a manifest cannot embed the hash of the commit it will be committed inside of
(the hash is a function of the tree, which includes the manifest). Checked
empirically on `c9d3170c` ("Release v0.27.0"): its committed manifest reads
`source_commit: dd7857d7` — `c9d3170c`'s OWN PARENT, not `c9d3170c` itself. A gate
comparing `committed.source_commit == HEAD` at `push` time (where `HEAD` IS that
just-landed commit) can therefore never pass, on ANY commit, by construction —
not "starts red until a regen lands" (the original, now-corrected framing) but
permanently red regardless of whether a regen ever lands. Worse, even comparing
against `HEAD^` only works for the one commit that carries the regen itself; any
later commit that touches nothing FR/test-relevant still advances `HEAD` while
the manifest (correctly still current) keeps its older `source_commit`, so that
comparison would go red on the very next unrelated push. The only sound
staleness signal is CONTENT (the FR<->test topology fields below) — `source_commit`
is provenance metadata, like `generated_at`, not a value this gate can require to
equal any particular commit. It remains in the JSON output as informational
context (never gates the exit code).
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

_COMMITTED_MANIFEST_REL = Path(".shipwright/compliance/test-traceability.json")

# Fields whose value is allowed to differ without failing the gate (see the
# module docstring's SCOPE DECISION). Applied only at the locations named below.
_EVIDENCE_LINK_FIELDS = ("status", "executed")
_TOP_LEVEL_IGNORED_FIELDS = ("generated_at", "source_commit")


def _normalize(manifest: dict) -> dict:
    """Strip the fields this gate deliberately does not police (a deep copy;
    never mutates the caller's dict)."""
    out = copy.deepcopy(manifest)
    for field in _TOP_LEVEL_IGNORED_FIELDS:
        out.pop(field, None)
    for node in out.get("requirements", {}).values():
        tests_by_layer = node.get("tests", {})
        for links in tests_by_layer.values():
            for link in links:
                # A hand-edited or older-schema committed manifest could hold a
                # malformed link (a bare string, not a dict) — tolerate it as a
                # content difference (the equality check below will then catch
                # it) rather than crashing with AttributeError on `.pop`.
                if isinstance(link, dict):
                    for field in _EVIDENCE_LINK_FIELDS:
                        link.pop(field, None)
    return out


def _summarize_diff(committed: dict, fresh: dict) -> list[str]:
    """Human-readable, best-effort summary of what changed (not a full diff —
    just enough for a CI log to point at the right spec/test file)."""
    lines: list[str] = []

    # NOTE: `source_commit` is intentionally absent here — `_normalize` already
    # stripped it from both `committed` and `fresh` before this function is
    # called (see the module docstring), so it would always read `None == None`.
    for field in ("schema_version", "collector_version", "spec_hash"):
        if committed.get(field) != fresh.get(field):
            lines.append(
                f"- {field}: committed={committed.get(field)!r} fresh={fresh.get(field)!r}"
            )

    committed_reqs = committed.get("requirements", {})
    fresh_reqs = fresh.get("requirements", {})
    added = sorted(set(fresh_reqs) - set(committed_reqs))
    removed = sorted(set(committed_reqs) - set(fresh_reqs))
    if added:
        lines.append(f"- requirements added by regen (missing from committed manifest): {added}")
    if removed:
        lines.append(f"- requirements removed by regen (stale in committed manifest): {removed}")
    for key in sorted(set(committed_reqs) & set(fresh_reqs)):
        if committed_reqs[key] != fresh_reqs[key]:
            # Best-effort (module docstring): a hand-edited/malformed committed
            # manifest could map a requirement key to something other than a
            # dict — report the drift without letting the id lookup itself
            # crash the failure-reporting path.
            fresh_req = fresh_reqs[key]
            req_id = fresh_req.get("id", "?") if isinstance(fresh_req, dict) else "?"
            lines.append(f"- requirement {key} ({req_id}) test bindings changed")

    for field in ("orphans", "invalid_tags", "invalid_layers", "untagged_tests"):
        c, f = committed.get(field), fresh.get(field)
        if c != f:
            c_len = len(c) if isinstance(c, list) else c
            f_len = len(f) if isinstance(f, list) else f
            lines.append(f"- {field}: committed={c_len!r} fresh={f_len!r}")

    return lines


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
    except (ImportError, AttributeError, TypeError) as exc:
        print(json.dumps({
            "success": False,
            "reason": (
                "could not regenerate the manifest via the pinned "
                f"shipwright-compliance checkout at '{plugin_root_str}'. The "
                "pinned commit (see `ref:` on the `Checkout shipwright-compliance "
                "plugin (pinned)` step in .github/workflows/ci.yml) likely moved, "
                "renamed, or reshaped an entrypoint this gate depends on "
                f"(`build_manifest` / `_validate_manifest` / `_test_links_io`'s "
                f"helpers) — re-pin and update this gate to match. "
                f"({type(exc).__name__}: {exc})"
            ),
        }, indent=2))
        return 1

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

    # Informational only (module docstring) — never gates success/failure.
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

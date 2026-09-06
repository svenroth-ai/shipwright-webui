"""Pure diff logic for the traceability-manifest CI gate: what this gate
deliberately does and does not police, and why. Split out of
`traceability_manifest_gate.py` (bloat ceiling, 300 LOC) — that module keeps
the cross-repo import glue and CLI; this one has no I/O and no cross-repo
dependency, which is also why its own tests (`test_traceability_manifest_gate.py`)
run with zero network/`uv` requirement.

SCOPE DECISION — execution evidence is deliberately excluded from the diff. The
collector's `status`/`executed` fields on each test link come ONLY from a raw
JUnit/Vitest/Playwright report dropped at a conventional location
(`_execution_evidence_io.refresh_index`); this job does not run the test suites
itself (they already run in `client-checks` / `server-checks`), so a bare regen
here always yields `status=enabled, executed=not_run` for every link. Comparing
those fields would make the gate permanently red, for a reason that has nothing
to do with the manifest being stale. What this gate DOES catch — and what
"stale" means for this acceptance criterion — is drift between the FR<->test
topology (added/removed requirements, added/removed `@covers` bindings,
orphans, invalid tags, `spec_hash`) and the current commit; `generated_at` is a
timestamp and is excluded for the same reason `status`/`executed` are.

`coverage` (each requirement's per-layer `"unit": "MISSING"`/`"ok"` verdict) is
a pure DERIVATIVE of those same evidence fields — the collector's `_cov_status`
returns `"ok"` iff a link is enabled AND `executed == "pass"`. Since this gate
always regenerates with `evidence={}`, a committed manifest carrying real
execution evidence would otherwise report `coverage` drift forever, for the
same non-staleness reason (external code review, 2026-09-06, high severity).
Its VALUES are neutralized for the same reason as the link fields; its KEYS
(which layers are required/filed) are genuine topology and are kept.

Link ORDER is also normalized away. Upstream emits links in `sorted(found)`
over `pathlib.Path` objects — an order that is NOT reproducible across
environments (case-folded on Windows, case-sensitive on POSIX; the
tuple-vs-string comparison also differs across CPython versions), so the
committed manifest's incidental order must not itself count as drift
(external code review, 2026-09-06, high severity).

`source_commit` IS ALSO excluded from the pass/fail comparison — **reversed
from this file's first draft** after external code review (2026-09-06,
reject-severity finding) proved the original design unsatisfiable by
construction, and this repo's own history confirms it empirically: every
commit that carries a regenerated manifest necessarily writes a
`source_commit` equal to that manifest's own PARENT commit, never to the
commit it is about to become part of — a manifest cannot embed the hash of
the commit it will be committed inside of (the hash is a function of the
tree, which includes the manifest). Checked empirically on `c9d3170c`
("Release v0.27.0"): its committed manifest reads `source_commit: dd7857d7`
— `c9d3170c`'s OWN PARENT, not `c9d3170c` itself. A gate comparing
`committed.source_commit == HEAD` at `push` time (where `HEAD` IS that
just-landed commit) can therefore never pass, on ANY commit, by
construction — not "starts red until a regen lands" (the original,
now-corrected framing) but permanently red regardless of whether a regen
ever lands. Worse, even comparing against `HEAD^` only works for the one
commit that carries the regen itself; any later commit that touches nothing
FR/test-relevant still advances `HEAD` while the manifest (correctly still
current) keeps its older `source_commit`, so that comparison would go red on
the very next unrelated push. The only sound staleness signal is CONTENT
(the FR<->test topology fields below) — `source_commit` is provenance
metadata, like `generated_at`, not a value this gate can require to equal
any particular commit. It remains in the JSON output as informational
context (never gates the exit code).
"""

from __future__ import annotations

import copy

# Fields whose value is allowed to differ without failing the gate (see the
# module docstring's SCOPE DECISION). Applied only at the locations named below.
_EVIDENCE_LINK_FIELDS = ("status", "executed")
_TOP_LEVEL_IGNORED_FIELDS = ("generated_at", "source_commit")


def _link_sort_key(link: object) -> tuple[int, str, str]:
    """Environment-independent ordering for a layer's link list (see the
    module docstring). Dicts sort before malformed non-dict entries, which
    sort by their own string form so they never raise on comparison."""
    if isinstance(link, dict):
        return (0, str(link.get("id", "")), str(link.get("tag_source", "")))
    return (1, str(link), "")


def _orphan_sort_key(entry: object) -> tuple[int, str, str]:
    """`orphans` is built during the same per-file scan (`sorted(found)` over
    `Path` objects) as the link lists above — the exact same OS/CPython
    ordering flip applies (external code review, 2026-09-06 round 2, high
    severity: proven live in this repo, not hypothetical — two real test
    files in this manifest's own orphan set sort in opposite order on
    Windows vs. Linux)."""
    if isinstance(entry, dict):
        return (0, str(entry.get("test", "")), str(entry.get("tagged_fr", "")))
    return (1, str(entry), "")


def _invalid_tag_sort_key(entry: object) -> tuple[int, str, str]:
    """`invalid_tags` is populated during the same per-file scan as `orphans`
    (test_links.py) — same ordering caveat as `_orphan_sort_key`."""
    if isinstance(entry, dict):
        return (0, str(entry.get("test", "")), str(entry.get("raw", "")))
    return (1, str(entry), "")


def _normalize(manifest: dict) -> dict:
    """Strip/neutralize the fields this gate deliberately does not police,
    and put every environment-order-dependent list into a content-stable
    order (a deep copy; never mutates the caller's dict)."""
    out = copy.deepcopy(manifest)
    for field in _TOP_LEVEL_IGNORED_FIELDS:
        out.pop(field, None)
    for node in out.get("requirements", {}).values():
        # A hand-edited or older-schema committed manifest could map a
        # requirement key to something other than a dict — tolerate it as a
        # content difference (the top-level equality check will then catch
        # it) rather than crashing on `.get` below.
        if not isinstance(node, dict):
            continue
        tests_by_layer = node.get("tests", {})
        for links in tests_by_layer.values():
            if not isinstance(links, list):
                continue
            for link in links:
                # Same tolerance as above, at the individual-link level: a
                # malformed link (a bare string, not a dict) is left as a
                # content difference rather than crashing on `.pop`.
                if isinstance(link, dict):
                    for field in _EVIDENCE_LINK_FIELDS:
                        link.pop(field, None)
            links.sort(key=_link_sort_key)
        # See module docstring: `coverage` is a pure derivative of the
        # evidence fields stripped above. Neutralize the VALUES; keep the
        # KEYS — the key set (which layers are required/filed) is genuine
        # topology, only the verdict is evidence-derived.
        coverage = node.get("coverage")
        if isinstance(coverage, dict):
            node["coverage"] = {layer: None for layer in coverage}
    orphans = out.get("orphans")
    if isinstance(orphans, list):
        orphans.sort(key=_orphan_sort_key)
    invalid_tags = out.get("invalid_tags")
    if isinstance(invalid_tags, list):
        invalid_tags.sort(key=_invalid_tag_sort_key)
    # `invalid_layers` is NOT sorted here: it is built during spec.md's own
    # requirement-table parse (document row order), not the file-scan `sorted
    # (found)` traversal above, so it carries no OS/CPython ordering caveat.
    # `untagged_tests` is likewise NOT sorted here — confirmed against the
    # collector source (`test_links.py`): it is built as
    # `sorted(all_test_ids - tagged_ids)`, its OWN independent `sorted()` call
    # over a set of test-ID STRINGS, not `Path` objects — string sort is
    # already environment-stable, so this field is immune to the caveat above
    # (external code review, 2026-09-06 round 3, low severity — verified,
    # not merely assumed).
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

    # Fallback for any OTHER top-level field the (unvendored, unversioned)
    # collector emits — e.g. `fold_map`/`fold_defects`/`invalid_ids`, which
    # `build_manifest` produces but this function did not enumerate above.
    # Without this, a real drift there exits 1 with an empty `diff` array: a
    # red build with no actionable log line (external code review, 2026-09-06,
    # medium severity). Name the key only — not its value, which can be large
    # or deeply nested — the full manifest diff is the place for detail.
    _explicitly_reported = {
        "schema_version", "collector_version", "spec_hash", "requirements",
        "orphans", "invalid_tags", "invalid_layers", "untagged_tests",
    }
    for field in sorted((set(committed) | set(fresh)) - _explicitly_reported):
        if committed.get(field) != fresh.get(field):
            lines.append(f"- {field}: differs (committed vs fresh) — see full manifest diff for detail")

    return lines

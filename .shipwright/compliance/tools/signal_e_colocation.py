#!/usr/bin/env python3
"""signal-e (co-location) backfill: deterministic test->FR mapping the shared
engine lacks.

Rule (zero human review, zero guessing):
  A test file maps to FR-X iff its co-located source file (the file it tests,
  derived by stripping .test/.spec) is:
    (1) listed in EXACTLY ONE FR's source-file list in spec.md (exclusive owner), AND
    (2) actually IMPORTED by the test file (the test truly exercises that source).
  Every test case in such a file is tagged `// @covers FR-X` via the engine's OWN
  apply_writes primitive (byte-identical to the canonical writer).

Fixtures are excluded. Already-tagged tests are skipped (idempotent). This is the
webui-local prototype of the "signal-e" the shared backfill engine should adopt
(handoff to the monorepo traceability campaign)."""
from __future__ import annotations
import argparse, json, re, sys, collections
from pathlib import Path

_SHARED_LIB = Path.home() / ".claude/plugins/cache/shipwright/shared/scripts/lib"
sys.path.insert(0, str(_SHARED_LIB))
import backfill_scan as scan          # noqa: E402  (shared engine — scan_tests/TestRecord)
from backfill_write import apply_writes  # noqa: E402  (shared engine — canonical writer)

Cand = collections.namedtuple("Cand", ["fr"])
_CODE_EXT = (".ts", ".tsx", ".js", ".jsx", ".mts", ".cts")  # parity with backfill_scan._TS_SUFFIXES
_EXT_ALT = r"(?:ts|tsx|js|jsx|mts|cts)"
_FIX = ("/fixtures/", "/__fixtures__/")


def expand_braces(tok: str) -> list[str]:
    """Expand every `{a,b}` group in a token (recurses → handles multiple/nested groups)."""
    m = re.search(r"\{([^}]*)\}", tok)
    if not m:
        return [tok]
    pre, post = tok[:m.start()], tok[m.end():]
    out: list[str] = []
    for p in m.group(1).split(","):
        out.extend(expand_braces(pre + p.strip() + post))
    return out


def parse_fr_file_owners(spec_text: str) -> dict[str, set[str]]:
    """file (posix, repo-relative) -> set(FRs that list it). Exclusive owner => len==1."""
    file_to_frs: dict[str, set[str]] = collections.defaultdict(set)
    for line in spec_text.splitlines():
        m = re.match(r"^\|\s*(FR-\d{2}\.\d{2})\s*\|", line)
        if not m:
            continue
        fr = m.group(1)
        for tok in re.findall(r"(?:server|client)/[A-Za-z0-9_./{}\-,]+", line):
            for f in expand_braces(tok.rstrip("/,.")):
                f = f.replace("\\", "/").rstrip("/")
                if f.endswith(_CODE_EXT):
                    file_to_frs[f].add(fr)
    return file_to_frs


def source_of(test_rel: str) -> str:
    """Co-located source path: strip .test/.spec, keep the final extension."""
    return re.sub(r"\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$", r".\2", test_rel)


def imports_basename(test_abs: Path, source_rel: str) -> bool:
    """True iff the test imports its co-located source as a relative path segment.

    Matches `from './stem'`, `from '../x/stem.js'`, side-effect `import './stem'`
    etc. The leading `/` requires stem to be a real path segment (no substring
    false-positive); the optional `.ext` tolerates the TS-ESM `.js` convention and
    the `from` sitting on its own line after a multi-line `{ ... }` clause.
    """
    stem = Path(source_rel).stem
    try:
        txt = test_abs.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return bool(re.search(
        r"""(?:from|import)\s+['"][^'"]*/""" + re.escape(stem) + r"(?:\." + _EXT_ALT + r")?['\"]", txt))


def compute(project_root: Path, test_roots: list[Path], spec_files: list[Path]) -> tuple[list, dict]:
    spec_text = "\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in spec_files)
    owners = parse_fr_file_owners(spec_text)
    records = scan.scan_tests(test_roots, project_root)
    writes: list[tuple] = []
    per_file_fr: dict[str, str] = {}
    skipped_fixture = skipped_tagged = 0
    for rec in records:
        rel = rec.rel_path.replace("\\", "/")
        if any(fx in ("/" + rel) for fx in _FIX):
            skipped_fixture += 1
            continue
        if rec.existing_frs:                       # already tagged (engine or prior) — idempotent
            skipped_tagged += 1
            continue
        test_abs = project_root / rel
        # (a) SELF-LISTING: the spec explicitly names THIS test file under exactly one FR
        #     (the author-attributed signal — strongest; no import-check needed, e.g. e2e specs).
        self_frs = owners.get(rel)
        if self_frs and len(self_frs) == 1:
            fr = next(iter(self_frs))
            writes.append((rec, Cand(fr=fr)))
            per_file_fr[rel] = fr
            continue
        # (b) CO-LOCATION: the test's co-located source file is the exclusive owner of one FR
        #     AND the test imports it (the test provably exercises that source).
        src = source_of(rel)
        frs = owners.get(src)
        if not frs or len(frs) != 1:               # not an exclusive owner => not a signal-e match
            continue
        fr = next(iter(frs))
        src_abs = project_root / src
        if not src_abs.exists():                   # co-located source must exist
            continue
        if not imports_basename(test_abs, src):    # HARD gate: test must import the source
            continue
        writes.append((rec, Cand(fr=fr)))
        per_file_fr[rel] = fr
    stats = {
        "test_cases_scanned": len(records),
        "colocation_tag_writes": len(writes),
        "files_mapped": len(per_file_fr),
        "skipped_fixture": skipped_fixture,
        "skipped_already_tagged": skipped_tagged,
        "fr_distribution": dict(collections.Counter(per_file_fr.values())),
        "files": per_file_fr,
    }
    return writes, stats


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="signal-e co-location backfill (webui prototype)")
    ap.add_argument("--project-root", required=True)
    ap.add_argument("--test-root", action="append", required=True)
    ap.add_argument("--spec", action="append", help="spec.md (repeatable; else planning/*/spec.md)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--report")
    args = ap.parse_args(argv)
    root = Path(args.project_root).resolve()
    test_roots = [root / t for t in args.test_root]
    if args.spec:
        specs = [Path(s) if Path(s).is_absolute() else root / s for s in args.spec]
    else:
        specs = scan.discover_specs(root) if hasattr(scan, "discover_specs") else []
        if not specs:
            planning = root / ".shipwright" / "planning"
            specs = sorted(planning.glob("*/spec.md")) if planning.is_dir() else []
    writes, stats = compute(root, test_roots, specs)
    if not args.dry_run:
        applied, failures = apply_writes(root, writes)
        stats["applied"] = len(applied)
        stats["write_failures"] = len(failures)
    stats["dry_run"] = args.dry_run
    stats["specs"] = [str(s) for s in specs]
    out = json.dumps(stats, indent=2)
    if args.report:
        Path(args.report).write_text(out + "\n", encoding="utf-8")
    # print summary only (files map can be large)
    summary = {k: v for k, v in stats.items() if k != "files"}
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

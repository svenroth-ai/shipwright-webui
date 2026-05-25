#!/usr/bin/env python3
"""Self-contained bloat anti-ratchet gate for the shipwright-webui repo.

Vendored from the canonical shipwright implementation at
``shared/scripts/hooks/anti_ratchet_check.py`` +
``shared/scripts/lib/anti_ratchet.py``. The webui has no Python
``shared/`` tree, so this single file packs the reader + the rule.

# canonical-source-hash: 99020b73f7f5f8ca8b5540ead53ddf78b9cd86f9184ede0ddfbd00a21b2318b1
# canonical-source-repo: https://github.com/svenroth-ai/shipwright
# canonical-source-paths:
#   shared/scripts/lib/anti_ratchet.py
#   shared/scripts/hooks/anti_ratchet_check.py
# canonical-source-version: iterate-2026-05-25-bloat-defense

Block rule (state-agnostic): for every entry in
``shipwright_bloat_baseline.json``, if measured-LOC > entry.current
→ exit 1. New crossings outside the baseline are advisory. Missing
or malformed baseline → fail-open exit 0.

Iron-Law block body adapted from ``obra/superpowers``
verification-before-completion (MIT, © Jesse Vincent).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

BASELINE_FILENAME = "shipwright_bloat_baseline.json"


def _normalize(p: str) -> str:
    if not p:
        return p
    s = p.replace("\\", "/")
    while s.startswith("./"):
        s = s[2:]
    return s


def _measure_worktree(project_root: Path, rel_path: str) -> int | None:
    p = project_root / rel_path
    if not p.is_file():
        return None
    try:
        with p.open("rb") as fh:
            return fh.read().count(b"\n")
    except OSError:
        return None


def _measure_staged(project_root: Path, rel_path: str) -> int | None:
    try:
        res = subprocess.run(
            ["git", "show", f":{rel_path}"],
            cwd=str(project_root), capture_output=True,
        )
    except FileNotFoundError:
        return None
    if res.returncode != 0:
        return None
    return res.stdout.count(b"\n")


def _staged_paths(project_root: Path) -> set[str]:
    try:
        res = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            cwd=str(project_root), capture_output=True, text=True,
        )
    except FileNotFoundError:
        return set()
    if res.returncode != 0:
        return set()
    return {p.strip() for p in res.stdout.splitlines() if p.strip()}


def _load_baseline(target: Path) -> dict | None:
    if not target.is_file():
        return None
    try:
        doc = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(
            f"anti_ratchet: baseline unreadable ({exc!r}) — fail-open",
            file=sys.stderr,
        )
        return None
    if not isinstance(doc, dict):
        return None
    entries = doc.get("entries")
    if not isinstance(entries, list):
        return None
    for entry in entries:
        if isinstance(entry, dict) and isinstance(entry.get("path"), str):
            entry["path"] = _normalize(entry["path"])
    return doc


def _classify(
    project_root: Path, entries: list[dict], mode: str
) -> tuple[list[dict], list[dict]]:
    ratchets: list[dict] = []
    stale: list[dict] = []
    staged = _staged_paths(project_root) if mode == "staged" else None

    for entry in entries:
        path = entry.get("path")
        current = entry.get("current")
        if not isinstance(path, str) or not isinstance(current, int):
            continue

        if mode == "staged":
            if staged is None or path not in staged:
                continue
            measured = _measure_staged(project_root, path)
            if measured is None:
                stale.append({"path": path, "reason": "staged-delete"})
                continue
        else:
            measured = _measure_worktree(project_root, path)
            if measured is None:
                stale.append({"path": path, "reason": "missing"})
                continue

        if measured > current:
            ratchets.append({
                "path": path,
                "baseline_current": current,
                "measured": measured,
                "state": entry.get("state", "grandfathered"),
                "adr": entry.get("adr"),
            })
    return ratchets, stale


def _emit_block(ratchets: list[dict], stream) -> None:
    print("=" * 72, file=stream)
    print("ANTI-RATCHET BLOCK — bloat baseline violation", file=stream)
    print("=" * 72, file=stream)
    print(
        "Iron Law: a file's measured LOC must not exceed its baseline "
        "`current` value.",
        file=stream,
    )
    print("", file=stream)
    print(f"{'path':<60}  {'baseline':>10}  {'measured':>10}", file=stream)
    print(f"{'-' * 60}  {'-' * 10}  {'-' * 10}", file=stream)
    for r in ratchets:
        print(
            f"{r['path']:<60}  {r['baseline_current']:>10}  "
            f"{r['measured']:>10}",
            file=stream,
        )
    print("", file=stream)
    print("Remediations: shrink the file, split it, or write a bloat-", file=stream)
    print(
        "exception ADR (see shipwright "
        ".shipwright/planning/adr/_template-bloat-exception.md).",
        file=stream,
    )
    print("=" * 72, file=stream)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="anti_ratchet_check",
        description="Bloat-baseline anti-ratchet gate (webui-vendored).",
    )
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--baseline", default=None)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--staged", dest="mode", action="store_const", const="staged",
        help="Measure staged content (pre-commit). DEFAULT.",
    )
    mode.add_argument(
        "--worktree", dest="mode", action="store_const", const="worktree",
        help="Measure files on disk (CI).",
    )
    parser.add_argument("--json", action="store_true")
    parser.set_defaults(mode="staged")
    args = parser.parse_args(argv)

    project_root = Path(args.project_root).resolve()
    baseline_path = (
        Path(args.baseline) if args.baseline
        else project_root / BASELINE_FILENAME
    )
    doc = _load_baseline(baseline_path)
    if doc is None:
        print(
            f"anti_ratchet_check: baseline not found at {baseline_path} "
            "— skipping check (fail-open)",
            file=sys.stderr,
        )
        if args.json:
            print(json.dumps({"status": "skipped", "ratchets": []}))
        return 0

    entries = doc.get("entries", [])
    ratchets, stale = _classify(project_root, entries, args.mode)

    if stale:
        head = ", ".join(s["path"] for s in stale[:5])
        tail = f" + {len(stale) - 5} more" if len(stale) > 5 else ""
        print(
            f"anti_ratchet_check: stale baseline entries (advisory): {head}{tail}",
            file=sys.stderr,
        )

    if args.json:
        print(json.dumps({
            "status": "block" if ratchets else "ok",
            "ratchets": ratchets,
            "stale": stale,
            "mode": args.mode,
        }))

    if ratchets:
        _emit_block(ratchets, sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

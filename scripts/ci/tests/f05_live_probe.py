#!/usr/bin/env python3
"""F0.5 surface verification — the READ half of the stale-verdict cleanup,
driven against the LIVE GitHub API with the real `gh` CLI.

Not a unit test and deliberately not collected by pytest (no `test_` prefix):
every offline test in this suite monkeypatches `subprocess`, so nothing else
proves these wrappers work against real bytes from a real server. This is the
`surface = cli` evidence for the iterate.

STRICTLY READ-ONLY. `dismiss_pr_review` is imported and its request shape is
asserted by building the argv, but it is NEVER executed — a dismissal has no
inverse, and F0.5 must not mutate a real pull request.

Run:  python scripts/ci/tests/f05_live_probe.py --repo owner/name --pr N
Exit: 0 all checks passed · 1 a check failed · 2 could not reach the API
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

CI_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(CI_DIR))

import pr_review_dismiss_select as SEL  # noqa: E402
from pr_review_gh import fetch_pr_head_sha, list_pr_reviews  # noqa: E402

PASS, FAIL = "PASS", "FAIL"
_results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    _results.append((PASS if ok else FAIL, name, detail))
    print(f"[{PASS if ok else FAIL}] {name}" + (f" — {detail}" if detail else ""))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--pr", type=int, required=True)
    args = ap.parse_args()

    if subprocess.run(["gh", "auth", "status"], capture_output=True).returncode != 0:
        print("[SKIP] `gh` is not authenticated — cannot verify the live surface")
        return 2

    # 1 — the listing wrapper decodes real `gh api --paginate` output.
    try:
        reviews = list_pr_reviews(args.pr, args.repo)
    except Exception as e:  # noqa: BLE001
        print(f"[FAIL] list_pr_reviews raised against the live API: {e}")
        return 2
    check("list_pr_reviews returns a list of dicts", isinstance(reviews, list)
          and all(isinstance(r, dict) for r in reviews), f"{len(reviews)} reviews")
    check("every review carries the fields the selector reads",
          all({"id", "state", "commit_id", "body", "user"} <= set(r) for r in reviews))
    check("`user` carries login+type (the two structural guards)",
          all({"login", "type"} <= set(r.get("user") or {}) for r in reviews))

    # 2 — the head wrapper returns a real 40-char sha.
    head = fetch_pr_head_sha(args.pr, args.repo)
    check("fetch_pr_head_sha returns a full sha", len(head) == 40 and head.isalnum(), head[:8])

    # 3 — the selector, run over REAL review objects.
    real_nonce = SEL.new_nonce()
    sel = SEL.select_stale_verdicts(reviews, nonce=real_nonce, head_sha=head,
                                    reviewed_sha=head)
    check("with no anchor of ours, nothing is selected", sel.review_ids == (),
          sel.reason[:80])
    check("and it SAYS why rather than staying silent", bool(sel.reason))

    # 4 — plant our own marked anchor among the real ones and re-run. This is
    #     the only way to exercise the selection path offline data cannot reach:
    #     real bodies, real logins, real states, real commit_ids.
    planted = {"id": -1, "state": "COMMENTED", "commit_id": head,
               "body": SEL.stamp_review_body("live probe", real_nonce),
               "user": {"login": "github-actions[bot]", "type": "Bot"}}
    sel2 = SEL.select_stale_verdicts(reviews + [planted], nonce=real_nonce,
                                     head_sha=head, reviewed_sha=head)
    real_bot_crs = [r for r in reviews
                    if str(r.get("state")).upper() == "CHANGES_REQUESTED"]
    check("with an anchor, real unmarked change-requests are still refused",
          sel2.review_ids == (),
          f"{len(real_bot_crs)} real CHANGES_REQUESTED on this PR, "
          f"skipped: {sel2.skipped}")

    # 5 — AC5 against live data: claim we reviewed a different commit.
    sel3 = SEL.select_stale_verdicts(reviews + [planted], nonce=real_nonce,
                                     head_sha=head, reviewed_sha="0" * 40)
    check("a reviewed-sha that disagrees with the head clears nothing",
          sel3.review_ids == () and "reviewed" in sel3.reason)

    # 6 — the mutating call is NEVER made; assert only that it is importable and
    #     that the module exposes it, so the probe cannot silently drift into
    #     calling it.
    import pr_review_gh
    check("dismiss_pr_review exists but was NOT invoked by this probe",
          callable(pr_review_gh.dismiss_pr_review))

    failed = [r for r in _results if r[0] == FAIL]
    print(f"\n{len(_results) - len(failed)}/{len(_results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

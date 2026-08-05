"""What counts as a producer-generated artifact — the POLICY, not the mechanism.

Vendored from the canonical shipwright monorepo. The WebUI has no Python
``shared/``/``plugins/`` tree on the CI runner, so the reviewer lives in-repo
(same convention as ``scripts/hooks/anti_ratchet_check.py``).

# canonical-source-hash: 96be7c84d08c2f0e5e95beba9779c9dfa0209edd7936c8cc2c89b33ef338c50a
# canonical-source-repo: https://github.com/svenroth-ai/shipwright
# canonical-source-paths:
#   plugins/shipwright-security/scripts/lib/pr_review_generated.py
# canonical-source-version: iterate-2026-07-27-pr-review-forged-boundary
# canonical-source-hash = sha256(the canonical file's bytes at the version above)
# adaptation (declared, narrowing only):
#   ``triage.jsonl`` / ``triage.outbox.jsonl`` are matched as the two exact
#   ``.shipwright/`` paths this repo actually writes, NOT as bare basenames.
#   Canonical can use basenames because no sibling repo file carries those
#   names; this repo ships ``server/src/test/fixtures/triage.jsonl``, an
#   AUTHORED test fixture. Under the canonical rule that fixture would be
#   filtered out of every review and the maintainer told it carried no
#   reviewable logic — the same over-reach the governing rule below forbids,
#   arriving through a filename collision instead of a prefix.

A medium+ PR regenerates producer-owned artifacts (compliance MDs, the three
regenerated agent-docs, changelog drops, append-log state files, prior review
records) that carry NO reviewable logic but dominate the diff.
``pr_review_diff_filter`` drops those sections BEFORE the truncation check, so
the reviewer stays under the size cap and sees only real code; the excluded list
is surfaced by the caller in the PR meta + comment (transparent, never silent).

Split out of ``pr_review_diff_filter`` so the *membership rules* — the part that
changes whenever a producer is added, and the part whose over-reach is a
security bug — are one small reviewable file, separate from the unified-diff
parsing they feed.

**The governing rule, learned twice on the canonical run.** "Regenerated,
therefore no reviewable logic" is sound for a dashboard and WRONG for anything
an attacker authors or an agent obeys. This gate's input is untrusted by
definition, so an over-broad entry here does not merely waste review — it
silently hides the file AND tells the maintainer it carried nothing worth
reading.
"""

from __future__ import annotations

import re

__all__ = ["is_generated_path"]

_GENERATED_PREFIXES = (
    ".shipwright/compliance/",           # dashboard / RTM / SBOM / test-evidence / change-history
    "CHANGELOG-unreleased.d/",           # per-run changelog drop files
)

# The two agent-doc sub-directories, matched by prefix AND by the SHAPE their
# producers actually write. A bare prefix here is a review bypass with no
# producer behind it: `.shipwright/agent_docs/runtime/` does not exist in this
# repo at all (adaptation #4 keeps it for vendoring fidelity), so every byte that
# ever appears under it is authored by whoever opened the PR — and `iterates/`
# gitignores only `*.plan.json` / `*.phase_timings.jsonl`, leaving every other
# name committable. Either would have let a PR drop an arbitrary `.md` into this
# repo's AGENT-INSTRUCTION tree, unreviewed and reported as "no reviewable
# logic": decision 7's bug, one level deeper. Found by the Stage-3 adversarial
# pass on iterate-2026-07-28-pr-review-parity. The producers write JSON, so JSON
# is what is excused.
_GENERATED_SHAPED_PREFIXES = (
    (".shipwright/agent_docs/iterates/", ".json"),  # one entry per iterate run
    (".shipwright/agent_docs/runtime/", ".json"),   # regenerated runtime snapshots
)

# `.shipwright/agent_docs/` is NOT a blanket prefix, and that is deliberate.
# Only these three `.md` files are producer-regenerated (canonical reads the
# repo's own churn allowlist, `churn_merge.AGENT_DOC_MDS`, as its SSoT; there is
# no Python `shared/` tree here, so the three names are pinned literally and the
# SSoT is named here instead). Their siblings are AUTHORED: `architecture.md` is
# curated prose the churn resolver specifically refuses to auto-merge,
# `conventions.md` / `decision_log.md` / `known_issues.md` /
# `component_inventory.md` / `design_tokens.md` / `test_status_overrides.md` are
# hand-written — and the whole directory is this repo's agent-instruction
# surface, which the reviewer's own system prompt orders it to BLOCK on for
# injected instructions. Excluding it wholesale told the model to scrutinise a
# directory it could never see, and told the maintainer those files carried "no
# reviewable logic". Same error as the lockfile one below, one prefix earlier.
_GENERATED_AGENT_DOCS = frozenset({
    ".shipwright/agent_docs/build_dashboard.md",
    ".shipwright/agent_docs/session_handoff.md",
    ".shipwright/agent_docs/triage_inbox.md",
})

_GENERATED_BASENAMES = frozenset({
    "shipwright_test_results.json",  # latest-run test state (regenerated each run)
    "shipwright_events.jsonl",       # append-only event log (union-merged)
})

# The two append-only triage logs, matched by EXACT path rather than basename —
# see the adaptation note in the module docstring. `.shipwright/triage.jsonl` is
# this repo's git-tracked SSoT; the outbox is the per-worktree staging file an
# iterate sweep commits.
_GENERATED_EXACT = frozenset({
    ".shipwright/triage.jsonl",
    ".shipwright/triage.outbox.jsonl",
})

# DEPENDENCY LOCKFILES ARE DELIBERATELY ABSENT from every set above (2026-07-27).
# They were in it on the "regenerated, so no reviewable logic" argument, which
# is wrong for the one gate that reviews UNTRUSTED PRs: a lockfile is where a
# typosquatted package arrives, and the PR author regenerated it. Filtering it
# hid every dependency change that shared a PR with one ordinary file. The size
# argument is also spent — the cap is 1M chars and a lockfile fits.
# See iterate-2026-07-27-pr-review-forged-boundary.

# A run's REVIEW EVIDENCE, under `.shipwright/planning/iterate/`: the review
# record `record_review_pass.py` maintains, and the raw reviewer replies
# `external_review.py` emits. Both are tool-written transcripts OF a review —
# feeding them to the reviewer is circular, and they are bulky.
#
# Deliberately NARROW. The `.md` siblings in the same directory — the iterate
# spec and its mini-plan — are AUTHORED, state the acceptance criteria, and are
# exactly the intent a reviewer should read the diff against. They stay in.
# The rule is "a reviewer does not review prior reviews", not "planning docs
# are uninteresting".
_REVIEW_EVIDENCE_PREFIX = ".shipwright/planning/iterate/"
_REVIEW_EVIDENCE_RE = re.compile(
    r"(^|/)(reviews\.json|[^/]*-external-[^/]*review[^/]*\.json)$"
)


def is_generated_path(path: str) -> bool:
    """True iff ``path`` is a producer-generated artifact (not reviewable code).

    ``path`` is compared VERBATIM — no ``.strip()``. See `_clean_diff_path` for
    why: normalising here re-opened the same hole from the policy side, since a
    name differing from a generated one only by surrounding whitespace would
    still match.
    """
    p = path or ""
    if any(p.startswith(pre) for pre in _GENERATED_PREFIXES):
        return True
    if any(p.startswith(pre) and p.endswith(suf)
           for pre, suf in _GENERATED_SHAPED_PREFIXES):
        return True
    if p in _GENERATED_AGENT_DOCS or p in _GENERATED_EXACT:
        return True
    if p.startswith(_REVIEW_EVIDENCE_PREFIX) and _REVIEW_EVIDENCE_RE.search(p):
        return True
    return p.rsplit("/", 1)[-1] in _GENERATED_BASENAMES

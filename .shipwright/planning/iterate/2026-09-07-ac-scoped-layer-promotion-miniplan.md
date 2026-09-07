# Mini-Plan: ac-scoped-layer-promotion

- **Run ID:** iterate-2026-09-07-ac-scoped-layer-promotion

## 1. Files to create/modify
- `.github/workflows/ci.yml` — edit: bump the `Checkout shipwright-compliance
  plugin (pinned)` step's `ref:` and its trailing date comment.
- `.shipwright/compliance/test-traceability.json` — **corrected at F11:** NOT
  modified in this PR. `check_no_derived_snapshots_committed` forbids a
  regenerated manifest in any iterate commit, no exception. Verified locally
  (regen matches, schema_version 3→4) but the artifact itself ships via a
  separate, immediate same-day main-repair PR after this one merges and the
  push-triggered gate predictably goes red — mirroring PR #443/#444.
- `.shipwright/triage.jsonl` — new entry (via `triage_add.py`): defer the
  AC-enumeration/minting/re-tag scope to a future, properly-scoped campaign
  sub-iterate.
- `.shipwright/planning/iterate/{run_id}/ci_supplychain_ack.json` — new
  (via `record_ci_supplychain_ack.py`): the CI-supply-chain acknowledgment,
  audit-grade (full SHA, repo, PR relationship, verification evidence).

## 2. Work breakdown
1. Pin the EXACT SHA `c0d1b38be27730dca4c9f00afc4538dd10f76e56` — not "at or
   after" (external review finding: an "or later" instruction invites
   picking an unverified/unaudited commit). Verified three ways: `gh api
   repos/svenroth-ai/shipwright/commits/<sha>` succeeds after a fresh
   `git fetch`; `git merge-base --is-ancestor <sha> origin/main` exits 0;
   `gh api repos/svenroth-ai/shipwright/commits/<sha>/pulls` returns exactly
   PR #686 with `merge_commit_sha` equal to this SHA (round-2 external
   review finding: reachability alone doesn't prove PR attribution).
2. Edit `.github/workflows/ci.yml`'s `ref:` + comment. Test: `git diff
   --stat` shows exactly this one file changed in this step (the ack file
   and triage entry from steps 4-5 are separate, expected, additional
   changes to the same commit — not "no other file changes" overall).
3. Confirm the pinned checkout is consumed by exactly one job/step — test:
   `grep` across every `.github/workflows/*.yml` for `svenroth-ai/shipwright`
   / `ci-shipwright-compliance` finds no other consumer (round-2 external
   review finding: 4 intervening upstream commits could affect other
   consumers if any existed).
4. Import the three pinned upstream symbols named in `ci.yml`'s own re-pin
   comment against the new pin and confirm compatible signatures — test:
   direct import + `inspect.signature()` succeeds, no `ImportError`/
   `AttributeError`/`TypeError`. (Superseded as the *authoritative* test by
   step 5 below, which exercises these same symbols with real arguments.)
5. Regenerate `.shipwright/compliance/test-traceability.json` against the
   new pin — checked out at the EXACT pinned SHA, not the live upstream tip
   — from this repo's current HEAD, and commit it alongside the `ci.yml`
   edit — test: `traceability_manifest_gate.py` reports `"success": true,
   "message": "manifest is current"`; `git diff` on the manifest shows only
   `schema_version`/`source_commit` changed.

   **Correction (round-2 external review, high severity):** the
   "Traceability manifest (gate)" job is guarded
   `if: github.event_name != 'schedule' && github.event_name !=
   'pull_request'` — it structurally never runs on this PR at all (verified:
   it showed `skipping` on the earlier main-repair PR #444). The local
   reproduction above is therefore the most rigorous PRE-merge validation
   available for this specific job, not a stand-in for one. The real
   exercise happens on the next push to `main` after merge; this run
   proactively checks that (via `main_health.py`) rather than assuming it,
   and reports it in the closing summary.

   **Fallback if that post-merge run goes red — TWO-BRANCH DIAGNOSIS (final
   external review round, medium severity): do not apply the atomic revert
   below to every red run.** First read `main_health.py`'s failure detail /
   the workflow run's diff output to tell which branch applies:
   - **Branch A — pin/schema-shape mismatch** (the committed manifest's
     `schema_version` or shape disagrees with what the newly-pinned
     collector produces): this is the failure this run's own change could
     cause. Fix = an ATOMIC revert of the `ci.yml` ref *and* the manifest
     together, as its own small main-repair PR — reverting the ref alone
     would leave a v4-shaped manifest the reinstated v3-only collector
     cannot produce, immediately re-failing the gate the other way.
   - **Branch B — ordinary content drift** (new/changed/untagged tests
     landed on `main` after this PR's regen, unrelated to the pin): fix =
     a plain re-regen against the (unchanged, correctly-pinned) collector,
     the normal main-repair flow this repo already uses for organic drift.
     Applying Branch A's revert here would needlessly roll back a valid,
     working pin.

   - **Branch C — checkout/fetch failure** (doubt-reviewer, Stage 3 review:
     the pinned SHA becomes unreachable — upstream force-push/history-rewrite
     of the four-commit window this pin sits in, or a transient fetch error):
     this produces no manifest diff to classify at all, because the job
     fails at the checkout step before the regen ever runs. Not a
     diagnosis problem — it is the intended fail-closed behavior (a missing
     commit errors loudly rather than silently degrading). Action: confirm
     the failure is genuinely "commit not found" (not a network blip —
     retry once), then re-verify the pin's reachability the same three ways
     as the original pin (§1) against whatever upstream state now exists,
     and re-pin to a still-valid, still-provenance-verified commit.

   Whoever runs the post-merge check records which branch applied and the
   `main_health.py` / workflow-run evidence used to decide, in the
   main-repair PR that results (or, if the run comes back green, in this
   run's F12 closing summary).
6. Record the CI-supply-chain acknowledgment
   (`record_ci_supplychain_ack.py`), including the full SHA, the source
   repo (`svenroth-ai/shipwright`), its PR #686 relationship, and the local
   verification command + result from steps 1-5 — audit-grade provenance,
   not just a date+PR comment in the workflow file. Verify afterward: the
   file exists at `.shipwright/planning/iterate/{run_id}/ci_supplychain_ack.json`
   and its recorded fields match.
7. File the deferred-scope triage card.

## 3. Component hierarchy
n/a (no UI).

## 4. Data model changes
None. (The manifest's on-disk *shape* is unaffected until a future run adds
AC-scoped tags — verified empirically in the Confidence Calibration section
of the iterate spec.)

## 5. Test strategy
- No unit/integration test exists for "which git ref a workflow checks out"
  in this repo (that class of assertion belongs to the CI system itself).
  Verification is: (a) local reproduction of the gate job against the new
  pin — the strongest pre-merge check obtainable, since the gate job itself
  never runs on a `pull_request` event, (b) every other PR-triggered check
  green (the normal merge bar), (c) proactively confirming the real
  push-triggered run on `main` after merge is green (F11/closing summary).
- No E2E needed (no UI, no runtime surface).

## 6. Alternative approach (rejected)

**Alternative:** Attempt the full follow-up ask now — enumerate ACs per FR
from `spec.md`, wire a local invocation of `ac_identity.mint()` against this
repo's `spec.md`, and re-tag a representative slice of tests.

**Why rejected:** Three independent reasons converge:
1. **First real use of a brand-new, unproven-on-a-real-document entrypoint.**
   **Corrected mid-review:** a generic CLI wrapper
   (`shared/scripts/tools/mint_ac_ids.py`) landed in the very commit range
   this run pins to — the earlier claim of "no CLI exists" was wrong. It
   remains true that NO ONE, anywhere in Shipwright (including the
   monorepo that owns the mechanism, for its own `spec.md`), has yet run it
   against a real, gate-read document — only golden-fixture tests. Being
   the first real invocation, ever, against THIS repo's actual `spec.md`,
   as a side effect of an unrelated CI-pin follow-up, is still the wrong
   place for that first use: registry file ownership/location, when to run
   it, and who reviews the result are first-use decisions that deserve their
   own properly-scoped unit and reviewer attention, not a side effect.
2. **Scale mismatch.** The CI gate diff surfaced 5,247 untagged tests in
   this repo. The monorepo scoped the equivalent problem (AC identity +
   manifest v4 + producer wiring + backfill + promotion + keystone gate) as
   an 8-sub-iterate campaign (`req3-04c-ac-identity-wave2`, P3.1-P3.8), not
   a single iterate.
3. **Explicit repo-boundary decision already on record.** That same
   campaign's own text states the WebUI-side pieces of this mechanism
   belong to campaign `req3-06-mechanics-webui`'s own sub-iterates (w3, w4)
   — as separate, deliberately-scoped cards, not folded into whichever unit
   happens to notice the gap.

The rejected alternative is preserved here, not silently dropped, per the
handoff triage card filed in this run.

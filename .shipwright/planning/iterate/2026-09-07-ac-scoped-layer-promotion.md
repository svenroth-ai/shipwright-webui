# Iterate Spec: ac-scoped-layer-promotion

- **Run ID:** iterate-2026-09-07-ac-scoped-layer-promotion
- **Type:** change
- **Complexity:** medium
- **Status:** implemented

## Goal

Follow-up to w5 (bind-and-promote, campaign `req3-06-mechanics-webui`), raised
by both external plan reviewers on that unit: w5 delivered FR-level layer
promotion only, while its title implied AC-level. Investigation for this run
found the AC-level writer capability (schema v4 `acs` field, AC-scoped
`@covers("FR-XX.YY/ACnn")` tag grammar) landed in the shipwright monorepo
**today**, in parallel, via PR #686 (campaign `req3-04c-ac-identity-wave2`,
sub-iterate P3.2) — four commits past this repo's currently CI-pinned
collector checkout. That campaign's own text is explicit that the WebUI side
of this mechanism is **not** its job: "a campaign is repo-bound... [the
webui-facing pieces] belong to w3/w4 of campaign req3-06-mechanics-webui,
which already exist." AC-level enumeration + minting + test re-tagging for
this repo's ~5,247 untagged tests is not tracked anywhere as its own
sub-iterate. **Correction (found auditing the full pin-range diff for
round-3 external review):** a generic, external-code-review-hardened CLI
wrapper, `shared/scripts/tools/mint_ac_ids.py` (`--spec-file`,
`--registry-file`, dry-run by default, file-locked `--write`), landed in
this exact commit range too — it is usable against this repo's `spec.md`
today. This corrects the iterate spec's earlier claim (drawn from
`ac_identity.py`'s own docstring, which only says *that* module's tests
never exercised a real document, not that no CLI wraps it) that no minting
entrypoint exists anywhere. It does not change this run's scope decision —
enumeration + re-tagging is still a large, separate undertaking — but the
triage card and Out of Scope section below are corrected to not
mis-describe the remaining work as needing a CLI to be built.

Given that mismatch between the follow-up's full ask and what is safely
buildable as a single iterate (mirroring the monorepo's own choice to spend an
entire 8-sub-iterate campaign, P3.1-P3.8, on this exact mechanism), this run's
scope is narrowed to the one concrete, safe, and immediately useful WebUI-side
action: bump the CI-pinned `shipwright-compliance` checkout ref so the
`Traceability manifest (gate)` job runs the collector that can write schema
v4 / `acs` once this repo starts carrying AC-scoped tags. The larger
enumerate-mint-retag effort is handed off as its own triage card (see
`## Out of Scope`) rather than attempted here.

## Acceptance Criteria
- [x] `.github/workflows/ci.yml`'s "Checkout shipwright-compliance plugin
      (pinned)" step points at the EXACT commit
      `c0d1b38be27730dca4c9f00afc4538dd10f76e56` — not "at or after" —
      verified three ways: (a) `gh api repos/svenroth-ai/shipwright/commits/<sha>`
      succeeds after a fresh `git fetch` of that repo (no stale-clone risk);
      (b) `git merge-base --is-ancestor <sha> origin/main` exits 0; (c)
      `gh api repos/svenroth-ai/shipwright/commits/<sha>/pulls` returns
      exactly PR #686 with `merge_commit_sha` equal to this same SHA — i.e.
      the pinned commit IS PR #686's own merge commit, not merely "some
      commit after it." The workflow comment documents why (date + PR).
- [x] Locally re-running `traceability_manifest_gate.py`, checked out at
      this EXACT pinned SHA (not the live upstream tip, which may have moved
      further), reports `"manifest is current"` — this is the authoritative
      compatibility test (it calls `build_manifest`/`_validate_manifest`/
      `io.*` with real arguments against this repo's real spec + tests, not
      just a static signature inspection) and confirms the regen is
      additive/backward compatible: no AC-scoped tags exist yet in this
      repo, so the v4-capable collector still emits a byte-identical
      v3-shaped body per its own schema docstring.
- [x] The three pinned upstream symbols the gate calls per its own re-check
      comment (`build_manifest`, `_validate_manifest`,
      `_test_links_io.{configured_test_roots,configured_prune_dirs,git_head}`)
      are confirmed to still resolve with compatible signatures at the new
      pin — corroborated by both the direct signature inspection AND the
      authoritative local gate run above.
- [x] Confirmed the pinned `.ci-shipwright-compliance` checkout is consumed
      SOLELY by this one job/step — `grep` across every `.github/workflows/*.yml`
      for `svenroth-ai/shipwright` / `ci-shipwright-compliance` finds no
      other consumer of this specific checkout (the unrelated, independently
      SHA-pinned `diff-coverage-gate` action at a different line is not
      affected by this change).
- [x] **Corrected at F11 (finalization verifier, mechanical check — not caught
      by any of the 4 external review rounds or the internal cascade, all of
      which reasoned at the spec level):** the regenerated
      `.shipwright/compliance/test-traceability.json` does **NOT** ship in
      this PR. `check_no_derived_snapshots_committed` categorically forbids a
      derived snapshot (this manifest is one — `TEST_TRACEABILITY` in
      `shared/scripts/lib/derived_snapshots.py`, no override exists) from
      entering ANY iterate commit, full stop — the earlier plan to bundle the
      regen into this same PR to avoid re-breaking the gate was itself
      blocked by tooling this repo already enforces. Locally verified
      (`traceability_manifest_gate.py` reporting "manifest is current" at the
      exact new pin) remains the compatibility proof; only the artifact's
      presence in the commit changed. **Consequence, accepted deliberately:**
      main's push-triggered gate WILL go red for one cycle the moment this PR
      merges (deterministic, self-caused, already proven by the local exact-
      pin repro) — the immediate next action after this PR merges is a
      same-day main-repair PR that regenerates the manifest, mirroring the
      exact PR #443/#444 pattern already used earlier in this same run for
      an unrelated stale-manifest repair.
- [x] `.shipwright/planning/iterate/{run_id}/ci_supplychain_ack.json`
      recorded for this run (touches `.github/workflows/**`), naming the
      full SHA, the source repo, the PR #686 relationship, and the local
      verification command/result — not just a date+PR comment in the
      workflow file. Written via `record_ci_supplychain_ack.py`; verify
      afterward that the file exists at that path and its `run_id`, SHA,
      repo, and PR reference match what was intended (the tool computes
      `paths_fingerprint` itself — not hand-verified beyond "the file
      exists and parses").
- [x] **Correction (external review round 2):** the "Traceability manifest
      (gate)" job is itself guarded `if: github.event_name != 'schedule' &&
      github.event_name != 'pull_request'` — it does **not** run on this PR
      at all (it will show as `skipping` in this PR's checks, same as
      observed on the earlier main-repair PR #444). There is no "real CI
      run on this PR" for this specific job to gate on. The merge
      prerequisite is instead: (a) every OTHER PR-triggered check is green
      (the normal merge bar, unaffected by this change), and (b) the local
      reproduction above, which — because the gate itself only ever runs
      push-side — **is** the most rigorous pre-merge validation this specific
      job can get. The real, load-bearing exercise of the new pin happens
      **after** merge, on the next push to `main`; this run proactively
      verifies that (see F11/closing summary) rather than assuming it.
      **Fallback if that post-merge push run goes red — two distinct
      failure modes, per round-3 external review:** (1) if the diff names
      `schema_version`/pin-shape fields → this pin bump broke something; fix
      is an ATOMIC revert of the ref *and* the manifest together (reverting
      the ref alone leaves a v4-shaped manifest the reinstated v3-only
      collector cannot produce, immediately re-failing the gate the other
      way). (2) if the diff instead names ordinary content drift
      (`requirements added by regen`, `untagged_tests` count) → an unrelated
      commit landed on `main` between this PR's manifest regen and its
      merge (this repo has a live precedent — the PR #442 stale-manifest
      repair earlier in this same run); the fix is a plain re-regen against
      the new pin, NOT a revert of this PR's own change. **If this branch is
      rebased or force-pushed after the manifest was regenerated, steps 4-5
      (symbol check + regen) must be re-run before merge** — a moved branch
      tip can silently invalidate an already-regenerated manifest.
- [x] Confirmed no consumer of `.shipwright/compliance/test-traceability.json`
      *inside this repo* (as opposed to the CI checkout side, covered
      above) breaks on `schema_version: 4`. **Two consumers, both checked
      (widened by the doubt-reviewer, Stage 3 — the original text named only
      the first):** (1) this repo's own reader,
      `server/src/core/mission-context/traceability.ts`, already declares
      `TRACEABILITY_SCHEMA_VERSION = 4` (built for exactly this bump by w3)
      and is fail-soft on anything higher; its 20 existing tests
      (`traceability.test.ts`, `traceability.schema-version.test.ts`,
      `traceability.v4-fixture.test.ts`) all pass unmodified. (2)
      `scripts/ci/promote_fr_layers_io.py` (the w5 bind-and-promote unit's
      manifest reader) — grepped directly for `schema_version`: zero
      references, so it is structurally version-agnostic; its own
      upstream-commit pin check (`verify_commit_pin(..., expect_commit)`)
      takes the expected commit from its caller rather than hardcoding one,
      so it is not separately desynced by this SHA bump either.
- [x] A triage card exists naming the deferred AC-enumeration/minting/re-tag
      scope, referencing campaign `req3-06-mechanics-webui`.

## Spec Impact
- **Classification:** none
- **NONE justification:** Internal CI/tooling pin bump. No user-visible
  webui behavior changes; no FR is added, modified, or removed. The pinned
  commit's own effect (schema v4 writer capability) is dormant until a
  future iterate actually tags tests with AC-scoped `@covers(...)`.

## Out of Scope
- Enumerating acceptance criteria per FR from `spec.md` prose / iterate-spec
  history.
- Minting `[ACnn]` markers into this repo's `spec.md` — a generic CLI for
  this now exists (`shared/scripts/tools/mint_ac_ids.py`, landed in the same
  pin range), but running it against this repo's real, gate-read `spec.md`
  for the first time anywhere is exactly the kind of first-use decision
  (registry file location/ownership, when to run it, who reviews the
  result) that belongs to its own properly-scoped unit, not a side effect
  of a CI-pin follow-up.
- Re-tagging any test file with AC-scoped `@covers("FR-XX.YY/ACnn")`.
- Attempting AC-level layer promotion itself.
- These are handed off via a triage card (kind: `compliance`) referencing
  campaign `req3-06-mechanics-webui`, for a properly scoped follow-on
  campaign sub-iterate — the same shape the monorepo used for its own
  equivalent work.

## Design Notes
n/a — no UI surface, infra-only change.

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `svenroth-ai/shipwright@c0d1b38b` (pinned checkout) | `.github/workflows/ci.yml`'s `Traceability manifest (gate)` job | cross-repo CI supply-chain checkout |

The pinned checkout is a supply-chain trust boundary (this repo's CI executes
third-party-to-it Python from that checkout) even though no *serialized data
contract* this repo owns changes — the manifest wire format itself is owned
and already contract-tested by the monorepo per PR #686's own description of
verifying the webui reader's compatibility empirically. No Boundary Probe
applies (`touches_io_boundary`'s trigger list — `.env*`/`hooks.json`/
`*_config.json`/`*_state.json`/`parse_env`/`json.dump(s)`/`yaml.*` — does not
match a workflow-file ref bump); the relevant safety-enforced control here is
`touches_ci_supplychain`'s acknowledgment requirement instead.

## Confidence Calibration

- **Boundaries touched:** the CI-pinned cross-repo checkout (see "Affected
  Boundaries" above) — a supply-chain trust boundary, not a serialized data
  contract this repo owns.
- **Empirical probes run:**
  1. Reproduced the exact CI job locally (checked out the pinned monorepo
     commit into a sparse `.ci-shipwright-compliance/` tree, ran
     `traceability_manifest_gate.py` the same way `ci.yml` does) — confirmed
     `"manifest is current"` against the OLD pin once the (unrelated) stale
     manifest from PR #442 was repaired.
  2. Re-ran the same reproduction against the NEW pin, checked out at the
     EXACT pinned SHA (`c0d1b38be27730dca4c9f00afc4538dd10f76e56`, not the
     live monorepo tip, to avoid verifying against an unaudited later
     commit) — confirmed the regen is still schema-valid, `schema_version`
     moved 3→4, and the shape is otherwise byte-identical (no `acs`/`ac_id`
     fields appear — verified 0 of 33 requirements carry `acs`, and the
     `git diff` on the regenerated manifest touches only the
     `schema_version` and `source_commit` lines), matching the v4 schema
     docstring's stated no-op behavior when no AC-scoped tags exist.
  3. Imported and inspected the three pinned upstream symbols named in
     `ci.yml`'s own re-pin comment (`build_manifest`, `_validate_manifest`,
     `io.{configured_test_roots,configured_prune_dirs,git_head}`) against
     the new pin — all resolve; `build_manifest`'s signature only gained new
     keyword-only params with defaults (`spec_files`, `collector_version`),
     so the gate's existing call site remains valid. Probe 2 above is the
     stronger, authoritative confirmation of this same fact (it calls these
     symbols with real arguments, not just inspects them).
  4. Confirmed via `gh api repos/svenroth-ai/shipwright/commits/<sha>/pulls`
     that the pinned SHA IS PR #686's own `merge_commit_sha` (exact match,
     not merely "reachable from a PR"), and re-ran the ancestor check after
     a fresh `git fetch` to rule out a stale local clone.
  5. `grep`'d every `.github/workflows/*.yml` for `svenroth-ai/shipwright` /
     `ci-shipwright-compliance` — the pinned checkout at this line is
     consumed by exactly one job/step; no other workflow step imports from
     `.ci-shipwright-compliance` or shares this specific pin.
  6. Read the job's own trigger guard
     (`if: github.event_name != 'schedule' && github.event_name !=
     'pull_request'`) — this gate structurally never runs on a `pull_request`
     event. Corrected the (wrong) earlier assumption that a green PR run of
     *this job* was obtainable; see the Acceptance Criteria correction.
  7. Reviewed the FULL diff of the sparse-checked-out paths
     (`plugins/shipwright-compliance`, `shared/scripts`) across all 4
     intervening commits between the old and new pin, not just the gate's
     3 imported symbols — one unrelated commit (#685, JS/TS support in the
     main-repair safety-gate detector) and one new, unwired CLI
     (`mint_ac_ids.py`, P3.1's own scope); nothing touches what
     `traceability_manifest_gate.py` imports or executes.
  8. Ran this repo's OWN manifest reader
     (`readTraceabilityIndex` in `server/src/core/mission-context/
     traceability.ts`) against the actual regenerated `schema_version: 4`
     manifest on disk, plus its 20 existing unit tests — confirmed the
     reader already targets v4 (`TRACEABILITY_SCHEMA_VERSION = 4`, built for
     this exact bump by w3) and every test passes unmodified. Closes the
     round-3 finding that the checkout-consumer grep (probe 5) doesn't
     establish manifest-CONTENT-consumer compatibility — a different
     question, now separately answered.
- **Test Completeness Ledger:**

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | CI gate still passes ("manifest is current") against the new pin, with the manifest regenerated and committed in this PR | tested | local repro of `traceability_manifest_gate.py` against `c0d1b38be27730dca4c9f00afc4538dd10f76e56`, exit 0, `"message": "manifest is current"` |
  | 2 | New pin does not change the on-disk manifest shape beyond the version bump (no accidental v4 upgrade with malformed/partial data) | tested | `git diff` on the regenerated manifest shows exactly 2 changed lines (`schema_version`, `source_commit`); 0 of 33 requirements carry `acs` |
  | 3 | The three pinned upstream symbols still resolve with compatible signatures at the new pin | tested | direct import + `inspect.signature()` against the pinned checkout |
  | 4 | This checkout is not consumed by any other workflow step | tested | grep across `.github/workflows/*.yml`, one match set, one job |
  | 5 | The pinned SHA is genuinely PR #686's own merge commit, not a coincidentally-later commit | tested | `gh api .../commits/<sha>/pulls` returns PR #686 with matching `merge_commit_sha` |
  | 6 | The gate's real, push-triggered exercise of the new pin (the only way this specific job actually runs) | untestable | requires-external-nondeterministic-service — this job is guarded `event_name != 'pull_request'`, so it structurally cannot run on this PR; it first runs for real on the next push to `main` after merge, proactively verified in the closing summary (not asserted here, and not gated on a PR check that cannot exist for this job) |
  | 7 | The full diff of sparse-checked-out paths across all 4 intervening commits touches nothing the gate imports or executes | tested | manual diff review, commit-by-commit attribution |
  | 8 | This repo's OWN in-app manifest reader does not break on `schema_version: 4` | tested | `readTraceabilityIndex` + its 20 existing tests, run against the real regenerated manifest, all pass unmodified |

- **Confidence-pattern check:** This run went through THREE external plan
  review rounds, each surfacing a real gap the previous pass had missed
  (round 1: exact-SHA pinning, symbol re-check, manifest regen requirement;
  round 2: the gate never runs on `pull_request` events at all, and the
  originally-stated fallback would itself have broken `main`; round 3: no
  check existed for this repo's OWN manifest-content consumers as opposed
  to the CI-checkout side, and the fallback didn't distinguish
  pin-caused-red from ordinary content-drift-caused-red) — the asymptote
  check (Depth: has "are you confident?" already produced a "yes" + a
  subsequent finding?) kept saying yes through all three rounds, so each
  round's own finding became the next probe (probes 6, 7, 8), converging
  to `glm=approve` with only low-severity notes on round 3. No further
  probe is owed: round 3's remaining low-severity items (env-fidelity
  caveat, rebase-requires-re-regen) are addressed as documentation, not
  open empirical questions. Coverage: 7 of 8 ledger rows `tested`, 1
  `untestable` with a valid reason_code, 0 untested-testable.

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** medium
- **Summary:** The scope narrowing is well-evidenced and the right call; the
  external reviewer's 5 findings are all valid and correctly scoped, but two
  gaps needed closing in the same pass: (1) the workflow's own comment
  instructs re-checking three pinned upstream symbols on every re-pin, which
  neither the AC list nor the mini-plan addressed; (2) a stated fallback if
  the real CI run goes red was missing.
- **Findings:**
  1. completeness/medium — AC1's "at or after" wording + unverified
     reachability → **fix**: pinned exact SHA, verified via GitHub API +
     `merge-base --is-ancestor`.
  2. architecture/medium — mini-plan step 1 still carried "or later" escape
     hatch → **fix**: already closed by the time this pass ran (edit landed
     first; reviewer's read raced it — confirmed no "or later" language
     remains).
  3. completeness/medium — the 3 pinned-symbol re-check the workflow's own
     comment demands was unaddressed → **fix**: added as explicit AC +
     mini-plan step; verified by direct import + `inspect.signature()`.
  4. completeness/low — "no other file changes" read as contradicting the
     ack/triage additions → **fix**: reworded to scope the assertion to the
     `ci.yml` edit step specifically.
  5. completeness/low — ledger row 3 read as asserting the real CI run
     already passed → **fix**: reworded to `untestable` /
     `requires-external-nondeterministic-service`, tracked as a merge-gating
     AC instead.
  6. security/low — ack statement should match sibling convention (full
     SHA/repo/PR/verification, not just date+PR) → **fix**: rewritten to
     match `iterate-2026-08-01-bootstrapper-ci-contract`'s convention.
  7. architecture/low — "Affected Boundaries: none" undersold the CI
     checkout as a trust boundary → **fix**: reclassified with an explicit
     boundary row.
  8. completeness/low — no fallback stated for a red real-CI run → **fix**:
     one sentence added to both the spec ACs and the mini-plan.
- **Known limitations:** none — all findings integrated.
- **Status:** 8 fixed.

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-09-07-ac-scoped-layer-promotion/architecture_brief.md`
- **Verdicts:** glm=approve · openai=reject
- **Smallest thing that would do (per reviewers):** glm: as proposed (bundle
  the ref bump + forced manifest regen + ack + triage card now — deferring
  saves nothing permanent and produces a larger, less attributable diff
  later). openai: defer the pin bump entirely; fold the exact same ref+
  manifest change into whichever future change first introduces AC-scoped
  tags, rather than shipping it standalone now.
- **Findings:**
  - glm (low, "existence"): ships a dormant capability with no in-repo
    consumer yet; if the AC follow-on campaign never happens, this repo
    carries a schema bump for no gained information — **disclosed**, not
    acted on: the triage card is the guard against that rotting unnoticed,
    and the change is cheaply reversible if it does.
  - openai (medium, "proportionality"): the pin bump permanently advances
    executed third-party CI code and forces a schema migration now for a
    capability nothing in this repo yet uses; suggests leaving the existing
    pin/manifest alone and bumping both atomically with the first AC-tagging
    rollout — **declined**, reason below.
- **Reconciliation:** The two reviewers disagree on sequencing, not
  correctness or safety — openai's own feedback text confirms this ("no
  safety/correctness problem"). Per protocol, a `reject` from either
  reviewer stops the run to ask the operator rather than being resolved
  unilaterally; the operator was asked directly (two concrete options, no
  jargon) and chose to ship now. Reasoning that carried the decision: this
  exact pin+manifest change is empirically verified today (local repro,
  symbol-compatibility check, byte-level manifest diff) — that evidence
  atrophies the longer it waits, while the sibling repo's own development on
  this exact area is active *today*, so deferring only grows the gap between
  this repo's pin and upstream, increasing the diff size and the number of
  intervening upstream changes a future re-pin would need to re-verify.
  Bundling this pin bump into the first real AC-tagging change (openai's
  suggestion) would also make that already-larger change strictly harder to
  review, by mixing an infra pin bump with the first-ever real AC-authoring
  work. The dormant-capability cost openai and glm both flag is real but
  small and reversible (one ref revert), and is exactly what the deferred-
  scope triage card exists to prevent from rotting unnoticed.

## External Plan Review — Final Round (round 4, convergence check)

Ran after rounds 1-3's fixes were applied, against the final mini-plan/spec
text, to get a provable final verdict rather than asserting convergence from
memory of round 3.

- **Verdicts:** glm=approve · openai=revise (one step apart — the tool's own
  contradiction check reports `requires_resolution: false`, "verdicts agree
  within one step"; not a `reject`, so no operator escalation applies here).
- **glm feedback:** approve, with five low-severity documentation-level notes
  (add a review-by trigger to the triage card; consider a pre-merge re-check
  in addition to the post-merge fallback; tighten "byte-identical" wording to
  name exactly which two lines differ; note fetch-failure-on-pin-rewrite as
  the intended fail-closed behavior; note the regen environment should mirror
  CI's). None block; the wording tightening is folded into this section's own
  phrasing above and needs no separate edit.
- **openai findings:**
  1. (medium, security) — advancing pinned third-party CI code on `push` to
     `main` needs its token permissions / secrets / checkout credential
     persistence checked, not just SHA provenance. **Already addressed,
     verified by re-reading `ci.yml` directly**: the workflow's top-level
     `permissions: contents: read` applies to every job including this one
     (no job-level override, by documented design), no step uses a secret,
     and both checkout steps already carry `persist-credentials: false`
     (added 2026-09-06 per that date's external code review) — the pinned
     third-party code runs with no write scope and no persisted credential
     to begin with. No new action needed; this predates and is independent
     of this run's ref bump.
  2. (medium, edge-case) — the mini-plan's fallback step only stated the
     atomic revert, not the two-branch diagnosis (pin-shape-mismatch vs.
     ordinary content drift) that the full spec's Verification section
     already carried — applying the revert to ordinary drift would
     needlessly roll back a valid pin. **Fixed**: the mini-plan's step 5 now
     states both branches explicitly, with the evidence-recording
     instruction, instead of leaving it only in this spec's prose.
  3-4. (low, dependency/risk) — name each pinned symbol individually rather
     than "three symbols"; note the local repro's environment may not
     exactly match the CI runner's. Both are documentation refinements over
     an already-authoritative check (the exact-pin manifest regen IS the
     compatibility proof, run at the literal pinned SHA); not applied as
     separate edits given the marginal value of a fifth review round.
- **Convergence decision:** proceeding without a round 5. Every medium+
  finding across all four rounds has now been either fixed in-artifact or
  verified already-addressed by re-reading the actual code, and both models'
  remaining objections are low-severity wording/documentation notes. Further
  rounds show diminishing returns on a single-line, cheaply-reversible CI
  pin change.

## Verification (medium+)

- **Surface:** none
- **Justification:** This is a single-line CI configuration change (a pinned
  git ref + a documentation comment) with no application surface — no
  server route, no client page, no CLI entry point. **Correction (round-3
  external review):** the load-bearing gate job is guarded against
  `pull_request` events and does not run on this PR — see the Acceptance
  Criteria correction above. The load-bearing verification is: the local
  exact-pin reproduction (pre-merge), plus the real push-triggered run on
  `main` proactively confirmed after merge (operational verification, not a
  PR check).

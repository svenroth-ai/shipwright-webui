# Mini-plan — w5: Bind AC to test and promote Layers per FR where coverage is green (S10)

**Run ID:** `iterate-2026-09-07-w5-bind-and-promote`
**Campaign:** `req3-06-mechanics-webui` · sub-iterate `w5` (last unit)
**Complexity:** small (Step 2: `small`, `risk_flags: [touches_auth]` — a keyword
false-positive off spec words like "operator"/"approval", no auth surface is
touched; Step 3.4 diff-driven re-check: `small`, unchanged —
`plan_review_required: true` fires on the risk flag AND `diff_loc: 6509 > 100`,
the latter almost entirely a machine-regenerated `test-traceability.json`)
**change_type:** change · **spec_impact:** none (the FR table's own `Layers`
column values change per-row, but no route/schema/write-surface changes; the
spec.md edits ARE the deliverable) · **affected_frs:** all 32 active FRs are
evaluated; 9 promoted this run (see below)

## Rule this unit implements (mirror of the monorepo's p3.5 doc — not re-derived)

`.shipwright/planning/iterate/campaigns/req3-04c-ac-identity-wave2/sub-iterates/
p3.5-promote-layers-per-fr.md` (read in the sibling shipwright checkout):
promotion is per-requirement, one-way, autonomous wherever a DECIDABLE
predicate holds; only an undecidable case hands back. Three escalation cases
named there, reused here verbatim:

1. `no_observable_layer` — no bound, enabled test at any layer.
2. `absent_ci_evidence` — a bound test has no fresh evidence, or evidence
   reads `not_run` ("absent != green"). A test that ran and genuinely FAILED
   is DECIDABLE (`skip_not_green`), not an escalation.
3. `contradicts_ledger` — promoting would contradict a recorded demotion.

## The predicate, made concrete for THIS repo

An FR's `Layers` cell starts as the bare `(inferred)` marker (w2, form
convergence) — `required_layers_source: inferred_legacy`. Promotion requires
EVERY currently-bound, enabled test across EVERY layer the FR has observed
coverage at (not just the highest) to be confirmed green against FRESH
execution evidence — a real `vitest --reporter=json` run performed by THIS
unit, not a stale claim. One red bound test at ANY layer blocks promotion of
the whole FR (promoting `required_layers: [unit, e2e]` while UNIT is red would
misrepresent the very obligation the cell asserts).

## Approach

1. **`scripts/ci/layer_promotion.py`** — pure predicate/evaluation logic, zero
   cross-repo dependency, unit-tested directly (`observed_layers`,
   `evaluate_requirement`, `evaluate_manifest`, `systemic_pattern`,
   `apply_promotion_to_row_cells`, `ledger_record`).
2. **`scripts/ci/promote_fr_layers.py`** — orchestration + CLI, mirroring
   `traceability_manifest_gate.py`'s cross-repo-import pattern (same pinned
   monorepo checkout, `plugins/shipwright-compliance` + its `shared/scripts`
   sibling for the FR-table read/write helpers): builds fresh evidence from
   `vitest --reporter=json` reports (server + client), regenerates a FULL
   manifest via the real `test_links.build_manifest()` (regen #1, for
   evaluation), applies the decided promotions to `spec.md`'s `Layers` cells
   (the ONLY sanctioned writer: reused `fr_table_shape.render_layers` +
   `markdown_table.escape_cell`, byte-preserving every other row/cell/EOL),
   then regenerates a SECOND, authoritative manifest from the now-edited
   `spec.md` (regen #2) — never a hand-patch of individual fields, so
   `spec_hash`/`untagged_tests`/link order can never drift from what the real
   collector would produce.
3. **One-way ledger** (`.shipwright/compliance/layer-promotion-ledger.json`):
   `required_layers_source == "explicit"` is terminal — never re-evaluated,
   never demoted. Evaluated independently per FR; no batch/sweep flag exists
   anywhere in either module.
4. **Escalation, reusing the exit-code CONTRACT pattern** (0/continue,
   non-zero/handback) `diff_risk_recheck.py` established for Step 3.4 — not a
   literal call to that CI-supplychain-specific script (its detectors don't
   apply to this domain), but the same shape: an evidence artifact
   (`layer_promotion_escalation.json`) naming every undecidable FR + its
   reason, an ack file (`layer_promotion_ack.json`) this run only ever
   CHECKS (fingerprinted over the exact escalated FR-id/reason set — a stale
   ack from a different escalation set does not clear a new one), never
   writes.
5. **Systemic-pattern check**: when escalations are MOST of the evaluated set
   (here: 23/32), name the pattern once (grouped by reason, further split
   into "no evidence fed for this layer at all" vs "a likely parameterized
   `test.each` `${...}`-title join gap" — a real, distinct limitation of the
   vitest evidence-reader discovered while running this for real, see
   below) — not 23 look-alike surprises.

## Real run against this repo (not a dry run)

- `server` + `client` full vitest suites run with `--reporter=json`:
  server 3939/3944 passed (5 pre-existing skips, per prior campaign units'
  own figures), client 3882/3882 passed. Both exit 0.
- 32 active FRs evaluated. **9 promoted** (evidence named per FR in the
  ledger): FR-01.05, FR-01.06, FR-01.16, FR-01.27, FR-01.45, FR-01.47,
  FR-01.49, FR-01.70, FR-01.72 — all `unit`-only, every bound test green.
- **23 escalated** (`absent_ci_evidence`), split:
  - **17** because this run fed NO e2e evidence at all (only vitest reports;
    the full Playwright e2e suite is deliberately not a CI gate in this repo
    — CLAUDE.md — and running it here was judged out of proportion for a
    layer-promotion pass). These FRs' bound e2e tests read `not_run`,
    correctly read as absent, never assumed green.
  - **6** (FR-01.02, FR-01.17, FR-01.29, FR-01.31, FR-01.37, FR-01.50) —
    a genuine, newly-discovered limitation: `test.each`-style titles keep
    their UNRESOLVED `${term}` placeholder in the static `@covers`-scanned
    manifest id, but vitest's JSON reporter emits the RUNTIME-interpolated
    title, so the two ids never join. The shared evidence-reader already
    handles the analogous pytest case (`[p0]` parametrization suffix
    stripped) but has no equivalent for JS template literals. Flagged
    (`likely_parameterized_title_join_gap`), NOT silently resolved — guessing
    a join here is exactly the false-pass risk this whole mechanism exists to
    prevent, and it is a shared-tool limitation out of scope for this unit to
    patch.
- The systemic-pattern check correctly fired (23/32 > 50%) and named BOTH
  root causes, rather than reporting 23 individual "surprises" the way the
  source rule warns against.
- **Verified against the real w1 evidence-chain CI gate**
  (`traceability_manifest_gate.py`), not just asserted: ran it against the
  post-promotion committed manifest + edited spec.md — `success: true,
  "manifest is current"`. This also incidentally repaired a small PRE-EXISTING
  drift (committed manifest was stale by 3 untagged tests relative to w3's
  own merge, `source_commit` unmoved since w4) — a byproduct of regenerating
  fully rather than hand-patching, not a goal of this unit.

## Non-goals / explicit exclusions

- Authoring NEW `@covers("FR-XX.YY/ACnn")` AC-scoped tags in test files
  (actual "bind AC to test" work at the individual-AC granularity) is OUT OF
  SCOPE for this pass: this repo's FR table carries no enumerated AC list per
  FR outside individual iterate-spec history, and inventing one is a
  separate, larger unit. What this unit binds is the FR-level predicate
  (bound tests exist, are green) — matching what the current manifest
  granularity (schema v3, no `acs` yet) can actually decide.
- Fixing the vitest evidence-reader's template-literal join gap is OUT OF
  SCOPE — it is shared, cross-repo tooling (`_evidence_readers.read_vitest`),
  and a hasty fix risks weakening the fail-closed join for every other
  consumer. Reported as a finding, not patched.
- Running the full Playwright e2e suite to supply e2e evidence is OUT OF
  SCOPE for this pass, per this repo's own CI-gate convention (CLAUDE.md:
  "FULL Playwright E2E is not a CI gate, but an @smoke subset IS").

## External-Plan-Review-Findings (Step 3.5)

Both GLM (verdict: approve) and OpenAI (verdict: reject) reviewed the plan
above; `contradiction.detected: true`. Resolved per-finding rather than by
picking one reviewer's verdict wholesale.

| # | Severity | Reviewer(s) | Finding | Disposition |
|---|----------|-------------|---------|--------------|
| 1 | high (openai) / medium (glm) | both | The unit's title says "bind AC to test," but no `@covers("FR-XX.YY/ACnn")` AC-scoped tagging exists in this repo (manifest schema v3 has no `acs` field) — the delivered predicate is FR-level, not AC-level. | **rejected-with-reason, scope reframed.** AC-level binding requires a manifest schema bump (v4 `acs`, already landed in w3 for the *reader*, not yet for THIS repo's writer/collector) plus enumerating real ACs across 32 FRs — a separate, materially larger unit, not a same-pass fix. This mini-plan already states the reframing (see "Non-goals" above); recorded here as the reviewers' central finding, not silently dropped. A follow-up triage item is filed for the AC-enumeration work (see below) — this is a genuine reviewer-identified gap, not a reflexive filing. |
| 2 | high (openai) / low (glm) | both | 17 of 23 escalations are because no e2e evidence was fed at all, and this repo's own CI convention runs an `@smoke` Playwright subset as a required gate — running it might have converted some escalations to promotions. | **rejected-with-reason, backed by an empirical check already run this pass.** Cross-referenced the 17 e2e-evidence-absent FRs' bound e2e test ids against every `@smoke`-tagged Playwright spec file: only 4 of 100+ missing ids are `@smoke`-tagged, touching exactly 2 FRs — and both of those FRs have OTHER, unrelated escalation causes in the same run (one also has 10 unit-layer `test.each` join-gap misses), so running `@smoke` this round would have promoted **zero** additional FRs. Re-verify this cross-reference on a future run once more FRs carry e2e bindings — do not assume the null result generalizes. |
| 3 | medium (both) | both | Regenerating the FULL manifest as part of a targeted promotion also repairs a pre-existing, unrelated drift (3 untagged tests, stale `source_commit`), mixing two logical changes in one diff. | **accepted-and-fixed, but the "split into two PRs" half is rejected.** Documented explicitly in this mini-plan's "Real run" section and carried into the commit message/body as a named, deliberate side-effect. Splitting is rejected: the two-regen-pass design (mini-plan "Approach" §2) is the correctness mechanism itself — the repair is a BYPRODUCT of using the real collector rather than hand-patching, not an independent change to bisect around; a hand-patched intermediate manifest would itself be a worse, inconsistent commit. |
| 4 | medium (openai) | openai | The one-way ledger's schema, its demotion-migration story, and its concurrent-write safety are unclear. | **accepted-and-fixed via documentation, no code change needed.** Schema is exactly `ledger_record()`'s return shape (`status`, `layers`, `run_id`, `promoted_at`, `evidence_test_ids`, `evidence_source_commit`) — now stated here explicitly. No migration is needed: this is a brand-new ledger with no legacy predecessor. No locking exists — accepted as a reasonable limitation analogous to `spec.md` itself (also unlocked, single-writer-per-run by convention); this script is never run concurrently against the same worktree by design (campaign sub-iterate serialization). |
| 5 | medium (glm) | glm | Promotion is terminal based on a single vitest run; a flaky-but-transiently-green test could produce an irreversible `explicit` status — does a human demotion actually override a stale `explicit`? | **accepted-and-fixed via documentation** (verified against the real code, not assumed). Traced `evaluate_requirement`'s order: `required_layers_source == "explicit"` short-circuits to a terminal skip BEFORE the ledger's `contradicts_ledger` check is ever reached — so recording a `status: "demoted"` ledger entry alone does NOT reverse an already-promoted row. Reversing a bad promotion is a deliberate, human, OUT-OF-BAND action: an operator manually reverts the `spec.md` Layers cell (e.g. back to `(inferred)`), and separately records the ledger demotion so this script never silently re-promotes that FR on a later run with fresh (possibly still-flaky) evidence. This is correct-by-design, not a gap: the script itself must never auto-demote (one-way, per the p3.5 doc), so an automatic reversal path would itself violate the rule under review. Documented here since neither the code nor the original mini-plan spelled this out explicitly. |
| 6 | medium (openai) / low (glm) | both | "Enabled"/"fresh" evidence isn't fully pinned: a quarantined/skipped manifest-side test binding, a retried/duplicate-titled test, or evidence from a mismatched commit could all be silently mishandled. | **split disposition.** *Quarantine handling* — accepted-and-fixed, and it was already correct: two new unit tests (`test_a_quarantined_manifest_binding_never_counts_as_observed_coverage`, `test_a_quarantined_test_is_excluded_even_when_evidence_would_have_passed`) now prove a manifest-side quarantined binding is excluded from the observed-coverage set entirely (an all-quarantined layer escalates `no_observable_layer`; a mixed layer is decided by its enabled binding alone). *Evidence-commit provenance* — accepted-and-fixed: `ledger_record()` now carries `evidence_source_commit` (this repo's `git_head()` at evidence-collection time), wired through `promote_fr_layers.py`'s promotion loop and asserted in `test_ledger_record_shape`. *Retry/duplicate-title/filtered-result handling* — **rejected-with-reason**: that is the shared, cross-repo evidence vocabulary's (`_evidence_readers.read_vitest`, `_evidence_vocab.merge_into`) responsibility, not this unit's; patching it here risks weakening the fail-closed join for every other consumer of that shared reader (mirrors the "Non-goals" reasoning already given for the `test.each` join gap). |
| 7 | low (openai) | openai | Cross-repo-importing executable helpers from a sibling checkout has no revision pin or integrity check — a locally modified shared checkout could influence what gets written. | **rejected-with-reason.** Identical trust model to the already-accepted, already-merged `traceability_manifest_gate.py` (same cross-repo-import pattern, same pinned-directory-path-only trust boundary, no code-signing or hash-pinning anywhere in this repo's CI tooling). Introducing a stricter trust boundary for only this one script would be an inconsistent, un-requested hardening of one call site while every sibling stays as-is. Partially addressed regardless by finding 6's `evidence_source_commit` field, which records the EVIDENCE commit (this repo's own HEAD) for provenance — distinct from, and not a substitute for, pinning the shared TOOL's revision. |
| — | low (glm) | glm | No real security surface: no auth touched, the sole `spec.md` writer is the reused render/escape helper, ack-fingerprint design prevents a stale ack from authorizing a new escalation set. | Acknowledged, no action — this is GLM's own "no action needed" note, recorded here for completeness of the table. |

**Net result:** every high/medium finding from both reviewers has an explicit
disposition; two (findings 1, and the AC-enumeration half of the picture) are
genuine, reviewer-identified scope gaps recorded as a deliberate deferral with
a follow-up triage item, not silently absorbed into "approve."

## External-Code-Review-Findings (Step 3.7, item 2)

Both reviewers agreed: `verdicts: {openai: revise, glm: revise}`
(`contradiction.detected: false`). Every high/medium finding was FIXED before
commit (code + tests, not just documented) — this cascade caught real bugs,
unlike the plan-review round above.

| # | Severity | Reviewer(s) | Finding | Disposition |
|---|----------|-------------|---------|--------------|
| 1 | high | openai | "Fresh CI evidence" wasn't enforced — any JSON file of any age was accepted as if just-collected. | **accepted-and-fixed.** Added a `--evidence-max-age-seconds` freshness ceiling (default 3600s) in `promote_fr_layers.py`: a `--vitest-report` older than the ceiling is now rejected outright (exit 2) before evidence is even built. Does not (and cannot, without CI wiring) prove commit-match — documented as a real limitation, not silently closed. New tests: `test_a_stale_vitest_report_is_rejected_as_not_fresh`. |
| 2 | high | glm | Non-atomic multi-file write with a terminal-state trap: if regen #2 raised (only `OSError`/`ValueError` were caught, narrower than what the real collector can raise), `spec.md` could be left promoted with no matching manifest/ledger — a permanent hole (`explicit` never re-evaluates). `manifest_path.write_text` also had no `parent.mkdir`. | **accepted-and-fixed.** `run()` now saves the original `spec.md` text, and on ANY exception (broadened to `Exception`, not just `OSError`/`ValueError`) from regen #2, restores that original content before returning failure — the working tree ends up unchanged, never half-promoted. `manifest_path.parent.mkdir(parents=True, exist_ok=True)` added. New test: `test_a_regen_2_failure_rolls_back_spec_md_instead_of_leaving_it_half_promoted` (monkeypatches `regen_manifest` to fail on its second call only, asserts spec.md is byte-identical to its pre-run content and neither manifest nor ledger were written). |
| 3 | medium | openai | `args.run_id` was concatenated into the escalation/ack output paths with no validation — a `..`/separator-bearing value could write outside `.shipwright/planning/iterate/`. | **accepted-and-fixed.** `_RUN_ID_SAFE_RE` (`^[A-Za-z0-9][A-Za-z0-9_-]*$`) rejects anything else at the top of `run()`, before any path is touched. New test: `test_an_unsafe_run_id_is_rejected_before_touching_any_path`. |
| 4 | medium | openai | Integration tests only exercised the stub's supplied `executed` values, never a stale/mismatched-commit report — the implementation could promote from arbitrary historical green evidence with tests still green. | **accepted-and-fixed** by finding 1's freshness-ceiling fix + its dedicated test; the "verify commit match" half remains a documented, not fully closed, limitation (vitest JSON carries no commit field to check against — noted in the freshness-guard's own code comment). |
| 5 | medium | glm | The committed ledger lacked `evidence_source_commit` even though `ledger_record()` unconditionally emits it — the artifact wasn't reproducible by the committed script. | **accepted-and-fixed.** Reverted `spec.md`'s 9 promoted rows and deleted the stale ledger, then re-ran the FINAL, fixed `promote_fr_layers.py` fresh against freshly-collected vitest evidence — same 9 FRs promoted (byte-identical spec.md diff), ledger now carries `evidence_source_commit: 543b6da0...` (this branch's actual base commit) for every entry, re-verified green against the real `traceability_manifest_gate.py`. |
| 6 | medium | glm | The post-diff spec still has many `(inferred)` FRs, and `evaluate_manifest` necessarily produced escalations/skip-not-green decisions for them, but no escalation artifact was committed — AC "only undecidable cases escalate, named" had no committed evidence. | **accepted-and-fixed.** `layer_promotion_escalation.json` (naming all 23 escalated FRs + reason codes + the systemic-pattern summary) is committed under this run's iterate directory, refreshed by the final re-run above. |
| 7 | medium | glm | The escalation mechanism doesn't literally call `diff_risk_recheck.py` — the mini-plan says it reuses that script's contract. | **rejected-with-reason** (already correctly scoped — this was the ORIGINAL task instruction: "reuse the diff_risk_recheck.py exit-code contract pattern... rather than inventing a new escalation channel", explicitly not a literal call, since its detectors are CI-supplychain-specific and don't apply to this domain). Strengthened `layer_promotion.py`'s module docstring to state this unambiguously so a future reader doesn't re-raise the same finding. |
| 8 | medium | glm | The implementation requires EVERY observed layer green, stricter than the p3.5 doc's literal "highest observable layer" wording — "the diff contradicts its own 'do not re-derive' instruction." | **rejected-with-reason**, and documented as a DELIBERATE, sanctioned strengthening (not a silent deviation): added an explicit paragraph to `layer_promotion.py`'s docstring naming this precisely, with the rationale already present in this mini-plan's "predicate, made concrete" section — promoting `[unit, e2e]` while a bound unit test is red would misrepresent the cell's own assertion. |
| 9 | medium | glm | Every cross-repo contract this orchestrator depends on (row indexing, `render_layers` signature, `escape_cell`) is validated only against self-authored stubs — a real-checkout regression would still pass. | **rejected-with-reason**, matching the IDENTICAL, already-accepted limitation in the precedent this design mirrors (`test_traceability_manifest_gate_run.py` has the same stub-only integration coverage). Partially mitigated in practice (not by new code): this run's own manual verification against the REAL pinned checkout (the actual promotion run above) plus the REAL `traceability_manifest_gate.py` gate serves as the "smoke test against the real collector" GLM asks for — done by hand this session, not yet automated in CI. |
| 10 | low | glm | Evidence values aren't guaranteed to be dicts — a malformed entry would raise `AttributeError` instead of failing closed; narrow exception handling elsewhere could let a raw traceback through. | **accepted-and-fixed.** `evaluate_requirement`'s missing-evidence check now guards with `isinstance(..., dict)`. `promote_fr_layers.py`'s two try/excepts broadened from `(OSError, json.JSONDecodeError, ValueError)` to `Exception` (documented: the real collector's error surface can't be enumerated). New test: `test_a_non_dict_evidence_entry_is_treated_as_missing_not_a_crash`. |
| 11 | low | glm | The ack-fingerprint's forgeability is convention-only — the fingerprint an operator must ack is published in the same directory as the ack path, so any automated caller could self-approve with a two-line write. | **rejected-with-reason** — documented explicitly in `layer_promotion.py`'s docstring as matching `diff_risk_recheck.py`'s own trust model exactly: the guarantee is "the run's own code never writes the ack", not "an adversary cannot forge one". This is the same trust boundary the original task instruction asked to mirror, not a gap unique to this implementation. |
| 12 | low | glm | (a) An unrecognized layer name (typo/future layer) is silently dropped, invisible in a `no_observable_layer` escalation. (b) A removed FR is `continue`d before being appended anywhere — invisible to an operator reading the run's output. | **accepted-and-fixed, both halves.** (a) `_unknown_layer_names()` now surfaces any non-`LAYER_RANK` layer key in the escalation's `detail` string and a new `unknown_layer_names` field. (b) `evaluate_manifest()` now returns a `removed_fr_ids` list. New tests: `test_unknown_layer_names_are_named_in_the_no_observable_layer_escalation`, `test_evaluate_manifest_lists_removed_fr_ids` (folded into the existing partition test). |

**Net result:** 8 of 12 findings fixed with real code + new tests (5 new
tests: 30 total, up from 25); 4 rejected-with-reason, each backed by either a
matching accepted precedent in this same repo or the original task
instruction's own explicit scoping. `layer_promotion.py`/`promote_fr_layers.py`
were each split (bloat cap, CLAUDE.md "files under 300 lines") into
`layer_promotion_report.py` (systemic-pattern reporting) and
`promote_fr_layers_io.py` (cross-repo import + regen/rewrite I/O) while
applying these fixes — a cohesive, non-per-handler split.

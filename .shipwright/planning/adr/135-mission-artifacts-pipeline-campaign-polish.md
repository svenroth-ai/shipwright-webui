# ADR — S3: native pipeline + campaign artifacts, scenario-6 hardening, typography

- **Run-ID:** iterate-2026-07-19-mission-s3-pipeline-campaign-polish
- **Date:** 2026-07-19
- **Section:** Iterate — feature: mission artifacts Slice 3
- **Campaign:** `2026-07-18-mission-artifacts`, sub-iterate **S3** of 3 (serial; on merged S1 `#292` + S2 `#295`)
- **Complexity:** medium · **change_type:** feature · **spec_impact:** modify
- **affected_frs:** `FR-01.66`

## Context

S1 shipped the resolver and deliberately left scenarios 3 (pipeline) and 5
(campaign) on "today's behaviour" so it could be additive. S2 completed the six
iterate artifacts. What remained was the half of the scenario table that still
borrowed the iterate rail, and the one decision in this campaign that removes a
whole surface: scenario 6, hiding the Mission tab.

## Decision

### 1. Pipeline and campaign get their OWN artifact kinds

Four new discriminated kinds — `phase` for a pipeline step, and
`campaign_runbook` / `campaign_progress` / `sub_iterate` for a campaign — rather
than reusing the §6 six. The kind sets are disjoint, so a rail never mixes them
and the iterate order is untouched. A campaign's progress is not an iterate's
"tests"; pretending otherwise is how a rail starts lying.

`spec` is the one slot deliberately shared across all three scenarios (iterate
spec / adopted spec / campaign brief), each supplying its own label.

### 2. A phase task is matched on its EXACT id, never on phase or session

A run holds many phase tasks and, once splits exist, several for the same phase.
Matching on anything but `phaseTaskId` would attribute one split's work to
another — worse than showing nothing, because it is silently wrong. The test
fixtures build a run where phase-matching AND session-matching each pick the
wrong task, so a regression to either fails a test rather than shipping.

### 3. The campaign's active-unit selection rule is stated ON THE WIRE

`in_progress` → first non-`complete` (failed and escalated land here on purpose:
a stuck unit IS the active one) → otherwise the last. `selectedBy` travels in the
response and renders in the panel, because "which one is running" is a claim, and
a claim whose basis is invisible drifts without anyone noticing.

### 4. Scenario 6 fails toward SHOWING, and that asymmetry is now enforced

Hiding a whole tab gives the user no error and no discoverable cause. Every
ambiguous actions catalog therefore resolves to showing.

## The bug this slice was really about

`isValidatedCustomActions` hid the Mission tab for a **valid JSON document of the
wrong shape**. MEASURED against the real loader and a real temp project, before
any fix:

| `.shipwright-webui/actions.json` | Before | After |
|---|---|---|
| malformed / truncated / empty | shows | shows |
| `{"actions":[]}` | shows | shows |
| **`{"actions":[{"foo":"bar"}]}`** | **HIDES** | shows |
| **`{"actions":[{"id":null}]}`** | **HIDES** | shows |
| top-level array / scalar | shows | shows |
| unreadable (directory) | shows | shows |
| dual-mode (builtin id, or valid run-config) | shows | shows |
| genuine custom catalog | hides | hides |

Malformed and truncated files were already safe because `JSON.parse` throws and
the loader falls back to the bundled default. The hole was between "parses" and
"means anything": `JSON.parse` succeeds, `checkContractVersion` only WARNS, so
the loader reports `fromUser: true` with zero diagnostics, and `facts.ts` maps
`a.id` to `undefined`. A one-element id list matching no builtin looked exactly
like a validated custom-actions catalog.

The declared type `actionIds: readonly string[]` is a CLAIM, not a guarantee —
the values cross a JSON boundary where nothing enforces it. A pure-unit test
could not have found this; the real-filesystem round trip is what did.

## Cache correctness

Pipeline and campaign contexts are **not cached at all**. The iterate cache
exists because that path reads a 0.9 MB manifest, a 0.6 MB decision log and
shells out to git; a pipeline or campaign resolve reads a handful of small files.
Not caching means `status.json` and `shipwright_run_config.json` — both of which
change DURING a run — cannot be served stale. Their paths are still registered in
`sourceRev`, **including while absent** (`${p}:absent`), so later creation
invalidates. Directly targets the S1 failure shape where an input outside the rev
was frozen forever.

## External-Plan-Review-Findings

Provider: openrouter (gemini + openai). 12 findings; 5 high, 6 medium, 1 low.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| G1 | high | Paths from campaign metadata / run-config need S1's `realPathGuard` + containment. | **satisfied by design.** Every document goes `resolveDoc` → `resolveFirstDoc` → `pathGuard` + `realPathGuard`, built from a constant known-layout prefix with `isSafeSlug` on the variable segments only. Traversal slug and escaping `specPath` are both tested. |
| G2 | medium | Hiding a tab that is the ACTIVE view leaves a blank pane or a dead route. | **accepted — verified and covered.** The client fallback existed since S1 and was unit-tested; the real-browser case was NOT. Added an E2E that persists `mission` as the saved view, lands on a custom-actions project and asserts Files is selected and the Mission body never mounts. |
| G3 | medium | The active sub-iterate should derive from the SESSION, else a historical campaign shows a newer unit. | **rejected-with-reason.** There is exactly ONE orchestrator session per campaign (the `campaign:<slug>` task), so "this session's campaign" and "the campaign" are the same thing. A finished campaign resolves `last_complete`. The rule and its basis are on the wire, so what is shown is always inspectable rather than implied. |
| G4 | low | Contended JSON files will yield torn reads; `JSON.parse` will throw. | **satisfied by design.** `getCampaignFact` is wrapped and degrades to `unavailable`; `readStatusJson` returns null on a torn read; `readRunConfig` keeps a last-good TTL; the loader catches. The route cannot 500 on any of them. |
| O1 | high | The pipeline phase-spec / FR mapping is unstated and may be inferred from `title` or `slashCommand`. | **accepted in substance, with an empirical basis.** Nothing is inferred from `title` or `slashCommand`. PROBE against this repo's real data: `phase_completed` events carry `phase`/`commits`/`description`/`detail` and NO `affected_frs` (all 3 real records enumerated); run-config `phase_tasks[]` has no FR field (schema + the real orchestrator fixture both enumerated). There is no per-phase FR source, so none is invented — the adopted `spec.md`, a constant known-layout path checked to exist before it becomes a link, IS the requirements document and is labelled "Spec & requirements". |
| O2 | high | Campaign active-unit selection unspecified for zero / multiple / stale candidates. | **accepted-and-implemented.** Three deterministic rules with `selectedBy` on the wire; zero units → `not_applicable`; unreadable store → `unavailable`. Tested for in-progress, failed, escalated, all-complete, empty, and in-progress-after-a-failure. |
| O3 | high | The tab gate must be server-derived and honoured by navigation, incl. direct access. | **satisfied + extended.** The decision is server-side (`scenario.ts`); the client hides only on an explicit `false`. Added the direct-landing E2E (see G2). Precedence is tested both ways: a stale pointer under a VALID custom-actions project hides; under a WRONG-SHAPE file it does not. |
| O4 | high | New document types must use opaque ids + guards, and must not expose filesystem paths. | **satisfied by design.** Every document is an opaque `mintDocId` handle; descriptors carry a basename `title`, never a path. `result.artifacts` are producer-recorded relative strings rendered as TEXT, not links, and not paths this code constructs. |
| O5 | medium | State model for partially-populated pipeline/campaign artifacts is unstated. | **accepted-and-implemented.** An id is minted ONLY for a document that resolved, so "no dead links" holds by construction. Missing runbook / unit spec → `not_applicable`; unreadable source → visible `unavailable`; guard refusal is kept distinct from "missing". |
| O6 | medium | New artifacts need a stable descriptor taxonomy, not generic Markdown fallback. | **accepted-and-implemented** — this is decision 1 above. |
| O7 | medium | Cache / `sourceRev` invalidation for the new sources. | **accepted-and-implemented** — see "Cache correctness". Tested, including the absent-then-created case. |
| O8 | medium | Test precedence conflicts and re-run S1/S2 regressions, not just the plain baseline. | **accepted-and-done.** All 28 mission E2E flows (S1 + S2 + S3 + live-JSONL + A11) run green, including the FR-01.67 campaign-progress flow. |

## External-Code-Review-Findings

Provider: openrouter (openai over the staged diff; gemini returned an empty
body — recorded as degraded, not as a clean pass). 5 findings; 2 high, 3 medium.
Verdict "block", driven by the two contract deviations dispositioned below.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| C1 | high | The active unit's `result.json` is never read; AC1 asks for spec **and** `result.json`. | **rejected-with-reason (empirically grounded).** PROBE over this repo: `status.json` sub-iterate entries have a stable 8-key shape (`id, slug, spec_path, status, commit, branch, tests_passed, tests_total`) across all 53 real entries; the 57 real `result.json` files share NO stable schema (100+ distinct keys, whatever each runner wrote). Worse, there is **no link from a campaign to its run directory**: 0 of 4 campaigns reference a loop id, and only 6 of 57 result files name their campaign — so resolving one needs a heuristic cross-directory scan disambiguated by branch/commit. `status.json` is the campaign's own authoritative per-unit record, in an unambiguous location, and carries the same facts. Using it is the more correct source, not a shortcut. |
| C2 | high | No native FR descriptor for a pipeline phase; the adopted spec is substituted. | **rejected-with-reason (duplicate of plan O1, empirically refuted).** No per-phase FR source exists in any producer (measured above). Emitting a `requirement` descriptor would fabricate one. The label carries the honest meaning. |
| C3 | medium | The unit `specPath` is constrained only to `campaigns/`, not to the resolved campaign's own slug — another campaign's document can appear as this unit's spec. | **accepted-and-fixed. A real bug.** `specPathParts` now requires the path to be exactly `campaigns/<thisSlug>/sub-iterates/<file>`, pinned to the validated slug. Two RED-first tests added (a cross-campaign path, and the campaign's own RUNBOOK dressed as a unit spec); both failed before the fix. |
| C4 | medium | Missing `spec.md` FR-01.66 AC line and `CHANGELOG-unreleased.d/` fragment. | **accepted** — both delivered at Finalization (F4 / F11). |
| C5 | medium | Campaign tests cannot validate `result.json` behaviour since none is implemented. | **rejected-with-reason (duplicate of C1).** The tests validate the source actually used, and the route-level test reads the per-unit counts through the real `status.json`. |

## Internal-Code-Review-Cascade-Findings

Run by the campaign orchestrator over `0f9a9788..71c717da`. The actions-file fix
was confirmed complete rather than spot-patched, and the cross-campaign path pin
survived an attack pass (`..`, `%2F`, case variants, symlinks, backslash
separators). Both measured rejections held. One BLOCKING finding.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| I1 | **blocking** | `facts.ts` computed `hasValidRunConfig = runConfig.status === "ok"`, collapsing THREE of `RunConfigReadResult`'s four states into "no SDLC run-config" — the last conjunct of the hide decision. A project with a genuine custom-actions catalog whose run-config was present but corrupt, v1-legacy, or on an unsupported schema lost its Mission tab, with no error and no cause. Worse: the `catch` mapped a THROWN read to `{status:"invalid"}`, so an I/O fault (permissions, a locked file) could itself hide the tab. | **accepted-and-fixed.** The boolean is replaced by `RunConfigPresence` (`ok` / `missing` / `unreadable`) and the gate hides only on `missing`. MEASURED before the fix: corrupt, v1-legacy and unsupported-schema configs all hid the tab; only the truly-absent case is supposed to. Ten new tests, all confirmed to fail with the fix reverted. |
| I2 | cheap | `buildPipelineFact` never received `taskRunId`, though the resolver holds it. A task belonging to run A resolved against whatever run-config is on disk NOW: a `phaseTaskId` present in run B rendered under B's runId, and one absent reported "its run no longer lists this step" when the truth was "we compared against a different run". | **accepted-and-fixed.** One comparison against data already in hand; a mismatch yields `unavailable`, never the misleading `task_not_found`. |
| I3 | note | `scenario.custom-actions.test.ts` `factsFor()` is a hand-copied "VERBATIM mirror" of the real mapping — and the bug it exists to catch lived exactly there, so a copy cannot catch a change to the original. | **recorded.** Redundantly covered by `routes.slice3-tab-hide.test.ts`, which drives the real function over real files. The comment claims a rigour the construction does not have; noted as a maintenance smell. |
| I4 | note | `campaign-store` falls back to the stale `campaign.md` table when `status.json` is torn, while `getCampaignFact` still returns `ok`, so "It is running now." can derive from a stale source; a double degradation yields `total: 0`. | **pre-existing store behaviour, not introduced here** — filed as triage, not fixed in this slice. |
| I5 | note | No drift guard between `core/mission-context/types.ts` ∪ `types-slice3.ts` and `client/src/lib/missionContextApi.ts`, though DO-NOT #7 mandates verbatim mirrors and the repo enforces exactly this elsewhere (`action-schema-sync.test.ts`). S3 adds four kinds and five detail shapes to that surface. | **inherited, not introduced** — filed as triage with I4. |

### The shape both blocking bugs share

This slice shipped the *same mistake twice*, on the two conjuncts of one decision:

| Conjunct | Collapse | Consequence |
|---|---|---|
| actions catalog | "parses" treated as "means something" | wrong-shape file hides the tab |
| run-config | "could not read" treated as "not there" | unreadable config hides the tab |

Both were caught only by driving REAL files through the REAL readers. And the
run-config half is the sharper lesson: the correct reasoning was already written
down 60 lines away in `facts-slice3.ts` — *"`missing` / `v1_legacy` / `invalid`
all mean the same thing HERE... none of them is evidence that the phase does not
exist"* — and simply was not applied on the path where the consequence is worse.
Getting the rule right in one place is not the same as enforcing it.

**Falsification.** All ten new tests confirmed to FAIL with their fix reverted,
then restored.

## Self-Review

1. **Spec Compliance** — pass. AC1–AC4 covered by 79 new server cases, 31 new client cases and 13 RUN E2E flows; the two contract deviations (pipeline FR source, campaign `result.json`) are recorded above with measured evidence rather than assertion.
2. **Error Handling** — pass. Every source read returns a typed result; no throw escapes to the route. Unreadable, malformed, absent and guard-refused are four distinct states with four distinct renderings.
3. **Security Basics** — pass. Known-layout paths only; `isSafeSlug` on every variable segment; `pathGuard` + `realPathGuard` on every read; the campaign slug comes from the matched RECORD (a directory name the server read), never from the user-editable title; opaque signed document ids; no new endpoint and no new write surface.
4. **Test Quality** — pass. The scenario-6 fix, the cross-campaign fix and the typography fence were each confirmed to FAIL with their change reverted (9, 2 and 2 tests respectively), then restored. The real-filesystem round trip is what found the shipped bug in the first place.
5. **Performance Basics** — pass. Pipeline/campaign reads are a handful of small files; one run-config read serves both the actions gate and the pipeline fact, so the two cannot disagree about a file mid-write.
6. **Naming & Structure** — pass. Every source file ≤ 300 LOC. `integrityResult` moved to `resolver-parts.ts` and the non-iterate branch extracted to `slice3-sources.ts` to keep `resolver.ts` under; two test files split rather than baselined. Bloat baseline untouched.
7. **Affected Boundaries** — pass. Producers/consumers identified: `write_run_config.py` → `shipwright_run_config.json`; `campaign_init.py` / `campaign_progress.py` → `campaign.md` + `status.json`; the user (or the upload route) → `.shipwright-webui/actions.json`. Real round-trip probes run against all three (see Confidence Calibration).

## Confidence Calibration

Boundaries touched: 3 serialized formats, all human- or producer-written. Probes were empirical.

| Probe | Finding |
|---|---|
| Every plausible `actions.json` written to a real temp project and read by the REAL loader | **FOUND THE SHIPPED BUG** — two valid-JSON-wrong-shape files hid the Mission tab. 8 shapes probed; 2 defective. |
| Same 8 shapes re-run after the fix | PASS — only a genuine custom catalog hides. |
| `.shipwright` rejected by `isSafeSlug` (leading dot) | **FOUND** — validating the whole path silently resolved NO documents at all, so every campaign artifact would have shipped link-less. Fixed by validating only the variable segments, mirroring `specHintCandidate`. |
| Real campaign tree: brief + runbook + unit spec resolved, ids decoded back with `parseDocId` | PASS — each id decodes to the exact file it claims. |
| Cross-campaign `specPath` (external review C3) | **FOUND** — another campaign's document resolved as this unit's spec. Fixed and pinned. |
| `status.json` vs `result.json` schema + linkage across the whole repo | **FOUND** — 0/4 campaigns link to a loop id; 6/57 result files name their campaign; `result.json` has no stable schema while `status.json` does. Refuted the reviewer's suggested source. |
| `phase_completed` + `phase_tasks[]` enumerated for any FR field | **FOUND** — there is none. Prevented a fabricated Requirement artifact. |
| `sourceRev` over a status.json that does not exist yet, then created | PASS — the rev changes; a later-written file invalidates. |
| Real browser, 13 S3 flows + 15 inherited mission flows | PASS — and the run caught a bad TEST fixture of mine (`seedProject({adopted:true})` writes only a marker, not a valid run-config), which had made a dual-mode case pass for the wrong reason. |

**Asymptote:** the last two probe rounds (post-C3-fix suites + the full 28-flow E2E re-run) produced no new findings → boundaries declared calibrated.

**Edge cases NOT probed, and why acceptable:** (a) a campaign with genuinely concurrent `in_progress` units — the rule takes the first deterministically and states its basis, and the serial strategy is what the producer writes today; (b) a run-config mid-atomic-rename — the reader's last-good TTL cache owns that case and is separately tested; (c) a real multi-split pipeline run in this repo — none exists (webui is iterate-driven), so the split fixtures are synthetic by necessity, built from the real orchestrator sample.

## Note on the visual-baseline reach

The typography fix targets `.rec-node .rn-k` / `.rn-r`, which the LEGACY A11 rail
shares with the new artifact rail — so it moved `design-gate.png` too, and the PR
body's original claim that no baselines would move was wrong.

A scoped selector (`.mc-left .rn-k`) was available and was **rejected, not
overlooked**. `.rn-r { margin-top: 1px }` has been inert since it shipped —
margin-block does nothing on a non-replaced inline box — so scoping the fix would
have left the legacy rail carrying a documented no-op and the two rails rendering
the same markup differently. Fixing both is the smaller long-term surface.

Exactly three baselines moved (`task-detail-mission`, `task-detail-mission-live`,
`design-gate`), each inspected before acceptance.
`task-detail-terminal.png` was deliberately not re-baselined: 171 px in one
36x8 box, font antialiasing on the "PREVIEW" eyebrow, passing on its own
threshold — committing sub-threshold noise would blur the terminal zero-diff claim.

## Consequences

Scenarios 3 and 5 no longer borrow the iterate rail. New server modules:
`pipeline-artifacts`, `campaign-artifacts`, `slice3-sources`, `types-slice3`,
`facts-slice3`. The client gains the mirrored types and `MissionSlice3Details`.
`ARTIFACT_ORDER` covers ten kinds across three scenarios; `usesContextRail` now
admits `pipeline` and `campaign` — the S1 test that pinned the opposite was
updated rather than deleted, and the `plain` exclusion it also guarded is now
pinned separately so nothing was lost.

The typography pass fixed a latent hierarchy bug affecting BOTH rails: `.rn-k`
and `.rn-r` were inline spans, so the artifact label and its receipt ran together
on one line and the `margin-top` beside them did nothing (margin-block has no
effect on a non-replaced inline box).

## Rejected alternatives

1. **Reading the active unit's `result.json`** (external C1) — no campaign→run-directory link exists and the file has no stable schema; `status.json` carries the same facts authoritatively.
2. **A per-phase Requirement artifact** (external C2 / O1) — no producer records per-phase FRs; emitting one would fabricate.
3. **Turning `result.artifacts` into links** — the producer documents no root for them, so the link would be a guess, and a guess that resolves to nothing is the dead link AC3 forbids.
4. **Caching the pipeline/campaign contexts** — their sources change during a run and the reads are small; not caching removes the staleness class entirely.
5. **Widening `CampaignStep` with test counts** — `campaign-store.ts` sits at its size ceiling and the campaigns board also consumes it; reading `status.json` directly keeps the shared reader untouched.

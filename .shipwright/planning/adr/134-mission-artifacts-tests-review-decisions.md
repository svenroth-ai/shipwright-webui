# ADR — S2: Tests · Review · Decisions Mission artifacts

- **Run-ID:** iterate-2026-07-19-mission-s2-tests-review-decisions
- **Date:** 2026-07-19
- **Section:** Iterate — feature: mission artifacts Slice 2
- **Campaign:** `2026-07-18-mission-artifacts`, sub-iterate **S2** of 3 (serial; on merged S1 `#292`)
- **Complexity:** medium · **change_type:** feature · **spec_impact:** modify
- **affected_frs:** `FR-01.66`

## Context

S1 shipped the Mission-context resolver and three of CONTRACT §6's six artifacts
(Spec · Requirement · Commit). Tests, Review and Decisions had no producer, so a
finalized iterate's Mission tab could not answer what it tested, what its reviews
found, or what it decided.

## Decision

Three read-only sources folded into S1's existing resolver, its 5-state model and its
one cache. **No new write surface** and **no new endpoint** — the details ride the
existing authorized `mission-context` response.

### 1. Tests = the run's own commit diff, enriched by the traceability manifest

`git show --name-status --no-renames --first-parent -z <sha>` gives A / M / D per file;
the manifest supplies layer, FR links and fold provenance.

`D` is the AC2 case and it is the reason the diff — not the manifest — is the source: a
removed test's manifest entry is *gone*, which is what removal means.

### 2. Review = the external marker files (CONTRACT §9.1, decided by Sven 2026-07-18)

`external_review_state.json` (plan) + `external_code_review_state.json` (external code),
the two sources with a clean existing contract. The internal self/code/doubt passes have
no machine-readable record and are represented explicitly as **`unavailable`** — never
"clean", never hidden. Follow-up: monorepo triage **`trg-74ec44b8`**.

### 3. Decisions = `decision_log.md` filtered on EXACT `Run-ID`

Only the matched ADR **blocks** are extracted and rendered, never the 639 KB log.

## The invariant this slice turns on

"We could not find out" must never render as "there is nothing":

| Situation | State | Visible? |
|---|---|---|
| git failed / no commit recorded / source unreadable | `unavailable` | YES |
| run not finished yet | `not_yet_created` | no |
| git ANSWERED and no test file moved | `not_applicable` | no |
| manifest unreadable but diff real | `available` + `manifestStatus:"unavailable"` | YES — rows real, links stated missing |

## Cache correctness

All new sources are registered in `computeSourceRev` via `slice2RevPaths()`, *including
files that do not exist yet* (they fingerprint `absent`, so their later creation changes
the rev). Direct fix for the class of bug S1's review caught, where an input outside the
rev was frozen forever.

## External-Plan-Review-Findings

Provider: openrouter (openai). 9 findings; 5 high, 4 medium.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | high | Git diff is file-level; contract wants per-TEST rows + "latest execution evidence". Suggests diffing committed manifest snapshots between revisions. | **rejected-with-reason (empirically refuted).** PROBE: the manifest changed in **1 of the last 25 commits** — iterate PRs deliberately carry no compliance regen. Manifest-snapshot diffing would report "no test changes" for ~96% of real commits, the exact false negative this feature forbids. Separately, `executed` is `not_run` for **all 1038** manifest entries, so "execution evidence" has no source; not fabricated. File-level granularity documented in `tests-diff.ts`. |
| 2 | high | `git show <sha>` covers one commit, not the whole iterate range; earlier commits silently omitted. | **accepted — documented limitation.** webui is squash-only, so the merged commit contains the whole iterate; `--first-parent` keeps merges meaningful. Only the framework-recorded `work_completed.commit` is available (measured: non-empty in 49/210 rows) and a run with no commit renders `unavailable`, not "no tests". Noted in code. |
| 3 | high | Cap of 50 rows conflicts with "paginated rows on open"; remaining rows inaccessible. | **partially accepted — cap recalibrated 50 → 500.** PROBE over 60 commits: median 0 test files, p95 = 13, max **116** (the #289 retrofit). A cap of 50 *would* have truncated real commits — the original guess was wrong. 500 gives >4x headroom, bounds the response (~100 KB), and truncation is still reported. A paginated endpoint is rejected as an access-controlled surface for a case the history does not contain; revisit if a real commit ever exceeds 500. |
| 4 | high | Review substitutes `unavailable` for the JSONL-sourced internal passes; AC4 says "not run". | **rejected — operator decision (Sven, 2026-07-18), tracked as `trg-74ec44b8`.** Scraping JSONL without a stable contract would fabricate review history. The reviewer's sub-ask — model `not_run` / `unavailable` / `completed, findingsCount:0` as three distinct states — **is implemented** and tested. |
| 5 | high | "Immutable after completion" asserted but not implemented; descriptors recompute from mutable files. | **rejected-with-reason (constraint).** A snapshot needs a second lifecycle write; S1 owns the only permitted one and this campaign forbids adding another. Immutability is the producer's guarantee — markers are written once at finalization. |
| 6 | medium | `--name-status` line parsing breaks on paths containing tabs/newlines/Unicode; use `-z`. | **accepted-and-fixed.** Switched to NUL-delimited `-z` parsing; tests added for tab, newline and non-ASCII paths, plus a trailing-NUL case. |
| 7 | medium | A Review whose four passes are all "not run" may be hidden by a naive content predicate, violating AC4. | **accepted-and-fixed.** Test added pinning that such a Review stays `available` with four rows. It also exposed a real wording bug — the summary read "0 reviews ran and raised no issues", a literal truth that reads as a clean sweep — now "No review was recorded as having run." |
| 8 | medium | Missing deliverables: `spec.md` FR amendment, changelog fragment, §9.1 decision record. | **accepted** — all three delivered at finalization (this ADR is the §9.1 record). |
| 9 | medium | New detail endpoint could create an authorization gap; Markdown/large files need sanitization + bounds. | **satisfied by design.** No new endpoint: details ride the existing `bind()`-authorized response. `DocumentMarkdown` is the existing sanitized renderer. Every read is `pathGuard` + `realPathGuard` + atomically size-bounded. |

## External-Code-Review-Findings

Provider: openrouter (openai + gemini) over the staged diff. 8 findings; 3 high, 5 medium.
Overall verdict "block" — driven entirely by the four contract deviations already
dispositioned above, plus the `spec.md`/changelog deliverables that are Finalization steps.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| C1 | high | Tests rows are per-FILE, not per-TEST; `entry.layers[0]` collapses a multi-layer file. | **rejected-with-reason (duplicate of plan #1, empirically refuted).** Per-test classification needs historical manifest snapshots; probe shows the manifest changes in 1/25 commits, so that design reports nothing for ~96% of runs. `layers[0]` is documented; multi-layer files are rare and the row keeps `caseCount`. |
| C2 | high | "Latest execution evidence" absent from wire type + UI. | **rejected-with-reason (duplicate of plan #1).** PROBE: `executed` is `not_run` for all 1038 manifest entries — there is no source. Inventing a field would fabricate evidence; the honest move is to omit it. |
| C3 | high | Review does not consume the raw JSONL for internal passes; the prerequisite is only a comment/triage id. | **rejected — operator decision (Sven, 2026-07-18), `trg-74ec44b8`.** This ADR is the formal §9.1 decision record the finding asks for. |
| C4 | medium | AC4 says "not run" for missing types; implementation says `unavailable` / "no record". | **rejected-with-reason.** Deliberate, per the operator's explicit instruction: "not run" and "we cannot read it" are DIFFERENT states, and rendering an unreadable pass as "not run" would be a claim we cannot support. `not_run` IS used wherever a record actually says so. |
| C5 | medium | No paginated Tests endpoint; `truncated` only shows a notice. | **rejected-with-reason (duplicate of plan #3).** Cap recalibrated to 500 on measured data (max real commit = 116). |
| C6 | medium | `MAX_TEST_ENTRIES` truncation returns `ok` with a partial map and no indicator → a test past the cap renders "covers nothing" while the UI claims the manifest is fine. | **accepted-and-fixed.** `TraceabilityIndex` ok-variant gains `truncated`; a partial index now yields `manifestStatus:"unavailable"`. UI wording generalised to cover absent *and* partial. Test added. |
| C7 | medium | Review descriptors not immutable after completion. | **rejected-with-reason (duplicate of plan #5).** Needs a second lifecycle write, forbidden by campaign guardrails. |
| C8 | medium | Missing `spec.md` FR-01.66 dated AC line and `CHANGELOG-unreleased.d/` fragment. | **accepted** — both delivered at Finalization. |

## Self-Review

1. **Spec Compliance** — pass. AC1–AC5 covered by server unit, client unit and 4 RUN E2E flows; the one contract deviation (pagination) is recorded above with an empirical basis.
2. **Error Handling** — pass. Every source read returns a typed result; no throw escapes. Corrupt/oversized/denied/missing are distinct and each maps to a deliberate state.
3. **Security Basics** — pass. `shell:false` arg arrays; sha hex-validated before becoming an argument; `isSafeRunId` before any path build; `pathGuard` + `realPathGuard` on every read; no new endpoint or write surface.
4. **Test Quality** — pass. 40 new server cases + 20 client cases + 4 E2E. Two are REAL-FILE calibration probes against this repo's own 917 KB manifest and 639 KB decision log — and one of them caught a wrong assumption (S1's ADR is not in the tracked log yet).
5. **Performance Basics** — pass. The 0.9 MB manifest is read only when the diff actually yielded rows; one git call, only after the run completed; all reads bounded; results cached on a rev covering every source.
6. **Naming & Structure** — pass. Every file ≤ 300 LOC; `document-read.ts` extracted so `resolver.ts` stays under. Bloat baseline untouched.
7. **Affected Boundaries** — pass. Producers/consumers identified: `mark-review-state.py` → `external_*review_state.json`; the traceability collector → `test-traceability.json`; the ADR writer → `decision_log.md`; git → the commit diff. Real round-trip probes run against all four (see Confidence Calibration).

## Confidence Calibration

Boundaries touched: 4 serialized formats + 1 subprocess. Probes were empirical, not assertions of confidence.

| Probe | Finding |
|---|---|
| Real 917 KB `test-traceability.json` inverted by the shipped reader | PASS — 50+ files indexed, no key contains `::`. Also found `resolved_from` is present in the SCHEMA but populated 0 times today, so the AC2 path is fixture-driven by necessity; documented. |
| Real 639 KB `decision_log.md` parsed by the shipped filter | **FOUND A BUG IN MY ASSUMPTION** — S1's ADR is absent from the tracked log (iterate PRs carry no agent-docs regen). Re-probed with a run that *is* present → passes. Behaviour is correct (`ok` + 0 entries → hidden), and the case is now pinned by a test. |
| Both `Run-ID` bullet spellings (`**Run-ID:**` / `**Run-ID**:`) against the real log | PASS — both occur in the wild; both matched. A single-spelling regex would have dropped a third of the entries. |
| Manifest churn per commit (tests external finding #1) | **FOUND** — 1 of 25 commits. Refuted the suggested alternative design. |
| Test files changed per commit (tests external finding #3) | **FOUND** — max 116, p95 13. Refuted my own cap of 50; raised to 500. |
| `git … -z` output shape against real git 2.54 | PASS — `status\0path\0` confirmed by `od -c` before coding against it. |
| Real two-commit git repo add/modify/DELETE, end-to-end through the browser | PASS — all three classifications correct in the rendered table. |
| Round-trip: run this iterate's own F3 decision-drop, then read it back with the shipped `readRunDecisions` | **FOUND — twice.** (1) First attempt used `write_decision_log.py`, which supports `run_id` internally but does NOT expose it as a CLI flag, so it emitted an ADR with **no `Run-ID` bullet** — invisible to the artifact. Reverted; the correct iterate tool is `write_decision_drop.py`. (2) That revealed the deeper fact below. |

### Product finding: when the Decisions artifact actually populates

The iterate F3 step writes a **decision-drop** (`.shipwright/agent_docs/decision-drops/<run_id>_001.json`,
gitignored); the ADR number and the `decision_log.md` entry are assigned **later, at release
time**, by `/shipwright-changelog` → `aggregate_decisions.py`. So `decision_log.md` gains this
run's ADR only after a release aggregation — which is precisely why the calibration probe found
S1's ADR absent from the tracked log.

Consequence, and it is correct rather than broken: between finalization and the next release the
Decisions artifact reads `ok` with **zero entries** and therefore HIDES (`not_applicable`). It does
not claim the run made no decisions, and it does not report a failure — there is genuinely nothing
in its source yet. Worth knowing when reviewing a freshly-merged iterate's Mission tab. If we later
want decisions visible immediately, the drop file is the source to add — a follow-up, not a fix.

**Asymptote:** the last two probe rounds (post-fix E2E + full mission suite) produced no new findings → boundaries declared calibrated.

**Edge cases NOT probed, and why acceptable:** (a) a test removed from a *still-existing* file — file-level granularity is a documented limitation, not a silent one; (b) a manifest at the 8 MB cap — the cap is 9x the real file and the degradation path is unit-tested with a corrupt file; (c) non-squash multi-commit iterates — webui is squash-only by repo policy (`allow_merge_commit:false`).

## Consequences

Six artifacts now render for a standalone iterate. New server modules: `tests-diff`,
`traceability`, `review-state`, `decisions`, `artifacts-slice2`, `slice2-sources`,
`types-slice2`, `document-read`. Client gains the mirrored types and
`MissionSlice2Details.tsx`; `ARTIFACT_ORDER` covers all six.

Two S1 tests were updated rather than bumped: the integrity test now pins artifact
KINDS (a count alone would not catch a kind being hidden on the integrity path), and
`missionArtifacts.test.ts` had used `decisions` as its stand-in for "an unknown future
kind", which Slice 2 made real.

## Rejected alternatives

1. **Manifest-snapshot diffing** (external #1) — empirically refuted; would report no test changes for ~96% of commits.
2. **A paginated Tests-detail endpoint** (external #3) — a new access-controlled surface for a row count never observed; the cap now exceeds the largest real commit 4x.
3. **Scraping session JSONL for internal review passes** — no stable contract; would fabricate review history. Deferred to `trg-74ec44b8`.
4. **Snapshotting Review at finalization for immutability** — needs a second lifecycle write, forbidden by the campaign guardrails.
5. **Hiding the Review artifact when only unreadable passes exist** — would let a data gap read as an absence; the artifact hides only when no record exists at all.

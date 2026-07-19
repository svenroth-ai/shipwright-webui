# ADR — Decisions reads the drops; the campaign store stops calling a degraded read "ok"

- **Run-ID:** iterate-2026-07-19-mission-decisions-drops-store-honesty
- **Date:** 2026-07-19
- **Section:** Iterate — change: Mission Decisions source + campaign-store provenance
- **Complexity:** medium · **change_type:** change · **spec_impact:** modify
- **affected_frs:** `FR-01.66` (AC line K)
- **Closes triage:** `trg-2228d368` (B1 + B2)

## Context

The `2026-07-18-mission-artifacts` campaign (#292/#295/#296/#297) shipped the
six-artifact Mission rail. Three honesty gaps survived it, all the same defect
family: **a read that failed, or a read of the wrong source, presented as a
settled fact.**

## Decision

### A. Decisions resolves from decision-drops ∪ `decision_log.md`

An iterate's F3 writes `.shipwright/agent_docs/decision-drops/<run_id>_NNN.json`.
The sequential `ADR-NNN` and the `decision_log.md` entry are assigned **later**,
at release time, by `aggregate_decisions.py` — which folds the drops in and then
**deletes** them. So between F3 and the next release the log is empty *by design*
and the log-only reader showed nothing.

ADR-134 recorded this as a "product finding" and deferred it. The measurement says
it was not an edge case:

| Measured on this repository, 2026-07-19 | Value |
|---|---|
| Drops on disk | **18** |
| Distinct `run_id`s in `decision_log.md` | 166 |
| Run-IDs in **both** | **0** |
| Runs whose decision was invisible | **18 of 18** |

- **The numbered log entry wins** when a run is in both. Because the aggregator
  deletes what it folds in, an overlap means a failed unlink — a fault state, not
  the common path — so this is a defensive rule that resolves toward the numbered
  record rather than showing one decision twice under two identities.
- A drop-sourced entry carries `adrId: **null**` and `source: "drop"`, and renders
  as **"Decided — not yet published in a release."** No number is invented: a
  plausible next-in-sequence value is one a reader could cite.
- **A drop appears at F3, i.e. DURING a run**, so a live iterate now shows its own
  Decisions before finalizing. Intended, and pinned by a test.

### B1. The campaign store carries where a status claim came from

`readStatusJson` collapsed **absent** and **torn** into one `null`; the store fell
back to the `campaign.md` table and `getCampaignFact` returned `status: "ok"` with
no record of the substitution. "S2 is running now." could therefore be rendered
from a plan document written days earlier with nothing indicating it.

The fallback **stays** — it is useful. Only its silence goes.

### B2. A drift guard on the server↔client type mirror

DO-NOT #7 mandates verbatim mirrors; the repo enforces it elsewhere
(`action-schema-sync.test.ts`), but the Mission wire types had no guard — and the
campaign added 4 kinds and 5 detail shapes to that unguarded surface.

## The invariant, restated

| Situation | State | Visible? |
|---|---|---|
| drops dir unreadable / log unreadable / scan truncated | `unavailable` | YES |
| run not finished and nothing recorded | `not_yet_created` | no |
| both sources READ and neither holds this run | `not_applicable` | no |
| some entries read, others malformed | `available` + disclosed count | YES |

## External-Plan-Review-Findings

Provider: openrouter (gemini + openai). 14 findings.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| G2 | high | Registering the drops DIRECTORY in `sourceRev` risks cache thrashing across runs. | **rejected-with-reason.** The alternative it proposes (register only specific file paths) is already done *in addition*; dropping the directory reintroduces the exact S1 bug the brief names a hard requirement, and it is also what detects a directory becoming *unreadable* (enumeration failure returns `[]`, indistinguishable from "no drops"). Cost is one artifact rebuild per drop written — a handful per day on a local single-user app. |
| G1 / O2 | med/high | "Deduplicated by run_id" underspecified for multiple drops of ONE run. | **accepted-and-fixed.** The reader keeps **all** of a run's drops, ordered by their `_NNN` sequence, capped at 20 with truncation reported. Test added. |
| O1 | high | A truncated scan must not yield a clean-empty state. | **accepted-and-fixed.** `truncated` now feeds `sawUnreadable` for BOTH sources. Today the caps make empty-and-truncated unreachable, but that is an argument about current constants; "not found" silently meaning "not fully searched" is this iterate's own sin. |
| O3 | high | Drop schema/identity validation unstated; do not split filename on `_`. | **already satisfied.** `run_id` inside the file must equal the requested run exactly; the filename must match `<runId>_` (never a split); `title` required; everything else malformed. Tested. |
| O4 | high | `readStatusJsonRead` only helps where callers migrate. | **accepted — inventoried.** Two other production callers: `facts-slice3.ts` (per-unit test counts; a torn file yields `null` counts which already render "not recorded", and the new `degraded` flag now travels alongside) and `routes/campaigns.ts::readCurrentStatus` (a write-precondition, not a user-facing claim). Neither makes a status claim; the wrapper is documented as such. |
| O5 | high | Campaign-level provenance is too coarse for a per-unit claim. | **accepted-and-fixed.** `statusSource` is now **per step**. A campaign whose `status.json` names S1 but not S2 previously reported "live" for both and dropped the disclosure on exactly the unit that needed it. |
| O6 | med | Define the absent-vs-degraded truth table. | **already satisfied + tested.** Absent ≠ degraded; `unavailable` fires only on `total === 0 && degraded`. |
| O7 | med | Cache tests miss deletion / empty-dir. | **accepted-and-fixed.** Both added — deletion is the *normal* end state, since the aggregator unlinks. |
| O8 | med | A failed log read is equally incompatible with "nothing decided". | **already satisfied.** `logUnreadable` (excluding a merely-absent log) feeds `sawUnreadable`. An enumeration race counts as malformed → disclosed, never a clean miss. |
| O9 | med | Symlinks / path trust on a new read path. | **already satisfied.** `isSafeRunId` + `pathGuard` + `realPathGuard` per entry + `isFile()`; tested. |
| G3 | med | Path traversal via `run_id`. | **already satisfied** (`isSafeRunId`, tested). |
| G4 | low | Extract a shared mirror-parser utility. | **rejected-with-reason.** The two parsers have materially different requirements — the existing one is flat and line-based, this one is nested-path-aware and character-driven. Coupling them now would constrain both; noted as a possible later cleanup. |
| G5 | low | Log a metric on drop/log overlap. | **rejected.** The log-wins rule already resolves it; a metric surface does not exist here. |

## External-Code-Review-Findings

Provider: openrouter (gemini + openai) over the staged diff. 6 findings; verdict
"ship-with-fixes". Five accepted.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| C1 (openai #4) | med | `degraded` is one boolean, but `campaign.md` can be the source that failed while `status.json` read fine — producing the false disclosure "the live status file could not be read". | **accepted-and-fixed.** Provenance now carries `statusJsonState` + `campaignMdUnreadable` and the sentence names the file that actually failed. **This was the disclosure meant to prevent false statements, making one.** |
| C2 (openai #5) | low | A `status.json` that exists but does not record THIS unit was described as "this campaign has no live status file" — materially false for a partial file. | **accepted-and-fixed.** Now "The live status file does not record this unit." |
| C3 (openai #6) | med | The mirror guard never resolved inherited `ArtifactBase` fields, so a drift in `label`/`state`/`summary`/`receipt`/`note` would pass a guard that looks total. | **accepted-and-fixed.** `ArtifactBase` added, plus a dedicated check for the client's SECOND copy (`Slice3ArtifactBase`), whose omission of `kind` is an intentional exception encoded explicitly. Both directions falsified. |
| C4 (openai #1) | med | Per-entry Markdown capped, TOTAL not — 20 × 64 KB > 1 MB. | **accepted-and-fixed.** `MAX_TOTAL_CHARS` added, matching the log reader that always had one; the two halves of the same artifact were bounded differently. |
| C5 (openai #3) | med | The log's own `truncated` was discarded when the log yielded no entries. | **accepted-and-fixed.** Both sources' truncation is carried and feeds `sawUnreadable`. |
| C6 (gemini #1) | med | An unreadable `decision_log.md` was swallowed once a drop rendered successfully — `sawUnreadable` was set but never surfaced. | **accepted-and-fixed.** The summary now discloses an uncountable loss ("this list may be incomplete") as well as a countable one. |
| C7 (openai #2) | med | `readdirSync` materializes the whole directory before the file cap applies. | **rejected-with-reason.** A local single-user app reading its own gitignored staging directory (18 files); `readdirSync` is how every reader in this codebase enumerates. A bounded `opendir` iterator adds real complexity for a scenario requiring the operator to place 100k files in their own staging dir. Noted, not built. |

## Internal-Code-Review-Cascade

**Delegated to the operator** (this runner has no `Agent` tool, so it cannot spawn
the `spec-reviewer` → `code-reviewer` → `doubt-reviewer` cascade itself).
Diff range: `421dcdbe..HEAD` on `iterate/2026-07-19-mission-decisions-drops-store-honesty`.

## Self-Review

1. **Spec Compliance** — pass. AC1–AC8 covered by server unit, client unit and 5 RUN E2E flows; the one rejected contract item (bounded directory iteration) is recorded above with a reason.
2. **Error Handling** — pass. Every read returns a typed result; nothing throws. Absent / unreadable / malformed / truncated are four distinct outcomes with four distinct renderings.
3. **Security Basics** — pass. `isSafeRunId` before any path build, `pathGuard` + `realPathGuard` per entry, `isFile()` check, atomically size-bounded reads. No new endpoint, no new write surface.
4. **Test Quality** — pass. 60 new server cases + 8 client cases + 5 E2E. **14 mutations proven to fail**, plus 2 more for the review fixes and 2 for the inherited-base gap. Two tests are real-file probes against this repo's own 18 drops and 640 KB log.
5. **Performance Basics** — pass. One extra `readdir` of an 18-file directory per rev computation; the drops read is skipped entirely when the log already answered.
6. **Naming & Structure** — pass. Every file ≤ 300 LOC; four cohesive splits (`artifacts-decisions`, `campaign-types`, `campaign-facts`, `MissionDecisionsDetail.test`) rather than one baseline crossing. Bloat baseline untouched.
7. **Affected Boundaries** — pass. Four boundaries identified and probed (see below): `write_decision_drop.py` → the drops reader; `aggregate_decisions.py` → `decision_log.md`; `campaign_progress.py` → `status.json`; server types → client mirror.

## Confidence Calibration

Boundaries touched: 3 serialized formats + 1 cross-workspace type mirror. Probes
were empirical.

| Probe | Finding |
|---|---|
| All 18 REAL drops in this repo, through the shipped reader | PASS — every one parsed, zero malformed, every rendered body carries its run id. |
| Real 640 KB `decision_log.md` vs the real drops directory | **FOUND — the measurement that justifies the iterate.** 18 drops, 166 logged run_ids, **zero overlap**. Also established that the aggregator DELETES drops, so log-wins is defensive rather than routine. |
| `aggregate_decisions.py` source read to confirm the lifecycle | PASS — folds then `unlink`s; deletion failure is caught and reported, which is the only way an overlap arises. |
| UTF-8 **BOM** on a drop (Python producer → Node reader) | **FOUND A BUG.** `JSON.parse` throws at character zero, so a perfectly good decision was reported as MALFORMED — a valid record rendered as a read failure, this iterate's own defect family pointed at itself. Fixed with an explicit code-point check. |
| Non-ASCII (em-dash / CJK / accents), CRLF, embedded newlines, empty-string fields, non-JSON neighbours | PASS — round 1, after the BOM fix. |
| Round 2 (NEW probes): over-cap file, JSON array/scalar/null, over-long field, more drops than the entry cap, a DIRECTORY named like a drop | PASS — no findings. |
| E2E falsification: gut the composed reader, **restart the server**, re-run | **FOUND A BUG IN MY OWN METHOD.** The first attempt left `tsx` serving pre-mutation code, so all 5 specs "passed" against a gutted reader. After restarting, 4 of 5 failed as they must. An unrestarted falsification proves nothing. |
| Mirror guard falsification: nested field, inline-shape rename, multi-line drop, union member, fabricated field, inherited base | **FOUND A BUG IN MY OWN GUARD, TWICE.** (1) The first collector skipped nested members, so deleting `malformedCount` left it green — and the campaign's five detail shapes are all nested. (2) External review then found it never resolved *inherited* `ArtifactBase` fields either. Both fixed and falsified. |

**Asymptote:** probe round 1 found the BOM bug → fixed → round 1 re-run clean →
round 2 (5 new probes) clean. Two consecutive clean rounds → boundaries declared
calibrated.

**Edge cases NOT probed, and why acceptable:** (a) a drops directory with 100k+
entries — requires the operator to fill their own gitignored staging dir, and the
cap still applies after enumeration (recorded as rejected review finding C7);
(b) a drop written *during* the read (an aggregation race) — it degrades to
`malformed`, which discloses rather than hides; (c) concurrent aggregation
deleting a drop mid-render — same path, same disclosure.

## Consequences

Decisions renders for every unreleased run, including live ones. New server
modules: `decision-drops`, `artifacts-decisions`, `campaign-types`,
`campaign-facts`. `DecisionEntryView` gains `adrId: string | null` + `source`;
`DecisionsArtifact.detail` gains `malformedCount`. `Campaign` gains
`provenance`; `CampaignStep` gains `statusSource`.

**Noted, not fixed:** `server/tsconfig.json` excludes `**/*.test.ts`, so a stale
type reference in a test file compiles. That is how a `DecisionsLookup` reference
survived a signature change here, and why `slice3-sources.test.ts`'s
`as CampaignFact` cast hid a missing field. Worth a separate look; changing it
now would surface unrelated errors mid-iterate.

## Rejected alternatives

1. **Registering only drop FILE paths in `sourceRev`** — cheaper, but a run with no drops yet registers nothing, so the first drop could never invalidate: the exact S1 bug.
2. **Fabricating a next-in-sequence ADR number for a drop** — a number a reader could cite that no record supports.
3. **A bounded `opendir` iterator** — complexity for a scenario the operator would have to construct.
4. **Extracting a shared mirror-parser utility** — the two parsers have materially different requirements today.
5. **Making `provenance` optional for deploy-skew** — it is server-internal, so the type system should enforce it; `provenanceNote` still degrades honestly rather than throwing if an untyped path reaches it.

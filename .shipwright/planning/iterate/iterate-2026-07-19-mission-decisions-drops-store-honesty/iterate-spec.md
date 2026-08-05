# Iterate — Mission Decisions reads the drops, and the campaign store stops calling a degraded read "ok"

- **Run-ID:** iterate-2026-07-19-mission-decisions-drops-store-honesty
- **Date:** 2026-07-19
- **Complexity:** medium · **change_type:** change · **spec_impact:** modify
- **affected_frs:** `FR-01.66` (area TSK, Mission view) — dated `(iterate-…)` AC line, NO new FR
- **Closes triage:** `trg-2228d368` (B1 + B2)

## Problem

Three honesty gaps left behind by the `2026-07-18-mission-artifacts` campaign
(PRs #292/#295/#296/#297). All three are the same family of defect the campaign
kept shipping: **a read that failed, or a read of the wrong source, presented as
a settled fact.**

### A. Decisions reads a source that is empty by design for every unmerged run

`decisions.ts` filters `.shipwright/agent_docs/decision_log.md` on
`Run-ID == run_id`. But an iterate's F3 does **not** write that file. It writes a
**decision-drop** (`.shipwright/agent_docs/decision-drops/<run_id>_NNN.json`),
and the sequential `ADR-NNN` is assigned only at release time by
`/shipwright-changelog` → `aggregate_decisions.py`, which folds the drops into
the log **and deletes them**.

So between an iterate's F3 and the next release aggregation, a run's decision
exists **only** as a drop and Decisions renders nothing.

ADR-134 already recorded this as a "product finding" and deferred it. The
measurement says it is not an edge case — it is the normal state:

| Measurement (this repo, 2026-07-19) | Value |
|---|---|
| Drops on disk | **18** |
| Distinct `run_id`s in `decision_log.md` | 166 |
| Run-IDs present in **both** | **0** |
| Runs whose decisions are therefore invisible today | **18 of 18** |

### B1. `campaign-store` reports `ok` for a degraded read

`readStatusJson` collapses **absent** and **torn/malformed** into `null`.
`buildCampaign` then falls back to the `campaign.md` table and `getCampaignFact`
returns `status: "ok"` with no record of where the fact came from. Consequences:

- `buildSubIterateArtifact` renders "**S2 — … is running now.**" from a
  hand-maintained Markdown table while the live status file was unreadable, with
  nothing on screen indicating it.
- Double degradation (campaign.md unparseable **and** status.json torn) yields
  `total: 0` → "**This campaign has no units recorded yet.**" — a read failure
  rendered as an empty fact.

### B2. The server↔client type mirror has no drift guard

DO-NOT #7 mandates verbatim mirrors instead of cross-package imports, enforced
elsewhere by `action-schema-sync.test.ts` / `triage-schema-sync.test.ts`. The
Mission wire types — `types.ts` ∪ `types-slice2.ts` ∪ `types-slice3.ts` against
`missionContextApi.ts` ∪ `missionSlice3Types.ts` — have **no** such guard, and
the campaign added 4 artifact kinds and 5 detail shapes to that unguarded
surface.

## Approach

### A — Decisions resolves from drops ∪ log, deduplicated by `run_id`

New reader `decision-drops.ts`; `decisions.ts` unchanged as the log reader.
A new `readRunDecisionRecord()` composes the two.

- **The log entry wins** when both exist — it is numbered and authoritative.
  Because the aggregator *deletes* what it folds in, overlap is a fault state
  (a failed unlink), not the common path; log-wins is the defensive rule.
- A **drop-sourced** entry carries `adrId: null` and `source: "drop"`, and
  renders as **"Decided — not yet published in a release."** Visibly distinct
  from a numbered ADR, without implying anything is wrong. `adrId` is **never**
  fabricated.
- **A malformed drop does not take down the artifact:** what parsed renders,
  `malformedCount` is disclosed.
- **"could not read" ≠ "nothing decided":** a drops-directory read failure with
  no entries from either source → `unavailable` (VISIBLE). Only a clean read of
  both sources yielding zero entries → `not_yet_created`/`not_applicable`.
- **Bounded:** file count, per-file bytes, entry count, per-entry and total
  markdown chars — all capped, truncation reported.
- **Cache correctness (hard requirement):** `slice2RevPaths` registers the drops
  **directory** *and* every matching drop file. The directory is registered even
  when absent (`${p}:absent`), so its later *creation* invalidates; the files
  are registered so a rewritten drop invalidates. A drop appears at F3, i.e.
  **during** a run — a live iterate now shows its own Decisions before
  finalizing, with no restart. That is intended and is pinned by a test.

### B1 — carry the provenance; represent a degraded read as degraded

- `readStatusJsonRead()` returns discriminated `ok | absent | unreadable`
  (`readStatusJson` stays as a back-compat wrapper).
- `Campaign` gains `provenance: { statusSource, degraded }`.
- `CampaignFacts` carries it through to the artifacts:
  - `total === 0` **and** degraded → `unavailable`, not "no units recorded yet".
  - a status claim not sourced from `status.json` gets a plain-language
    disclosure sentence, distinguishing *torn* from *absent*.
- **The fallback stays** — it is useful. Only its silence goes.

### B2 — a mirror drift meta-test

`server/src/test/mission-context-types-sync.test.ts`, mirroring the
`action-schema-sync.test.ts` approach (parse the file text, compare member sets
across the workspace boundary). Both directions: a field the client is missing
is a stale mirror; a field only the client declares is a fabrication. Covers
interfaces *and* the string-literal unions (`ArtifactKind`, `ArtifactState`,
`ReviewStatus`, …) — that is where the campaign's four new kinds landed.

## Affected Boundaries

| Boundary | Producer | Consumer | Round-trip probe |
|---|---|---|---|
| `decision-drops/<run_id>_NNN.json` | `write_decision_drop.py` (F3) | **new** `decision-drops.ts` | This iterate's own F3 drop, read back by the shipped reader |
| `decision_log.md` | `aggregate_decisions.py` (release) | `decisions.ts` (existing) | Real 640 KB log, 166 run_ids |
| `campaigns/<slug>/status.json` | `campaign_init.py` / `campaign_progress.py` | `campaign-status-json.ts` | Real campaign dirs in this repo |
| server mission types → client mirror | `types*.ts` | `missionContextApi.ts` | The B2 meta-test itself |

**No new write surface.** Reads only. The resolver's only permitted write
remains S1's guarded `task.missionContext` association.

## Acceptance criteria

1. A run whose decision exists only as a drop renders Decisions as `available`,
   marked "Decided — not yet published in a release", with `adrId: null`.
2. A run present in **both** sources renders the numbered log entry only.
3. A drops-directory read failure with no entries → `unavailable` (visible),
   never `not_yet_created`.
4. A malformed drop alongside a valid one → the valid entry renders and the
   malformed one is disclosed; the artifact stays `available`.
5. Creating a drop mid-run changes `sourceRev` and therefore invalidates the
   cache — with the drops directory absent at first computation.
6. A campaign whose `status.json` is torn does not present a `campaign.md`-derived
   status claim as unqualified fact.
7. Double degradation (campaign.md unparseable + status.json torn) → Campaign
   progress `unavailable`, never "no units recorded yet".
8. The mirror meta-test FAILS on a real drift in either direction (proven by
   reverting).

## Test discipline

Every significant new test is **reverted-and-rerun** to prove it fails without
its fix. Absolute expectations, not differentials. Real-data probes against this
repo's 18 real drops and real 640 KB decision log, not only fixtures.

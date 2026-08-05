# Mini-plan — S2: Tests · Review · Decisions Mission artifacts

**Run ID:** `iterate-2026-07-19-mission-s2-tests-review-decisions`
**Campaign:** `2026-07-18-mission-artifacts` (sub-iterate S2 of 3, serial; builds on merged S1 `#292`)
**Complexity:** medium · **change_type:** feature · **spec_impact:** modify · **affected_frs:** `FR-01.66`

## Problem

S1 shipped the Mission-context resolver plus three of CONTRACT §6's six artifacts
(Spec · Requirement · Commit). The remaining three — **Tests**, **Review**,
**Decisions** — have no producer, so a finalized iterate's Mission tab cannot answer
"what did this change test?", "what did the reviews find?", "what did it decide?".

## Approach

Three new read-only sources, each folded into the existing resolver and the existing
5-state model. No new write surface: S1 already owns the ONE permitted lifecycle write
(`task.missionContext`).

### 1. Tests — a git baseline-diff, enriched by the traceability manifest

The CONTRACT asks for "the manifest at iterate start vs. finalize (and/or the git diff
of test files)". The WebUI is a read-only observer and is never running when an iterate
starts, so it cannot capture a start-of-run snapshot. **The run's own commit diff IS the
baseline diff** — `git show --name-status --no-renames <sha>` gives A / M / D per file.

`D` is the load-bearing case (AC2): a removed test cannot be found by inspecting the
current manifest, because its entry is gone — that is what removal means. Only the diff
can classify it.

- `tests-diff.ts` — hex-validated sha, arg-array git (`shell:false`), test-file
  predicate, layer inference, bounded rows (cap 50, truncation REPORTED).
- `traceability.ts` — reads `.shipwright/compliance/test-traceability.json` (917 KB, 29
  requirements, 1038 entries measured) and INVERTS it to a `path → {layers, frs}` index.
  Carries `resolved_from` as `mappedFrom` so a fold renders "mapped from FR-01.44" (AC2).
  Corrupt / oversized / missing → typed `unavailable`.

### 2. Review — the external marker files (CONTRACT §9.1 decision)

**Decided (Sven, 2026-07-18):** ship from the sources that already have a clean contract
— the per-iterate `external_review_state.json` (plan) + `external_code_review_state.json`
(external code), written by `mark-review-state.py`. Measured: 55 files in this repo, one
uniform shape. The INTERNAL self/code/doubt passes have no machine-readable record; they
are represented explicitly as **`unavailable`** — never as clean, never hidden. Follow-up
filed as monorepo triage `trg-74ec44b8`.

Note the source carries `findings_count` but NO per-finding array, so `findings[]` is
always empty and the UI says the details were not recorded rather than rendering an empty
list as "no findings".

### 3. Decisions — `decision_log.md` filtered on exact `Run-ID`

Provenance is already solved: each iterate ADR carries `- **Run-ID:** <run_id>`. Filter
on EXACT equality (AC3 isolation — a prefix test would let a concurrent iterate leak in).
Extract only the matched ADR BLOCKS, never the whole 639 KB log.

## Failure-state discipline (the invariant this slice turns on)

"We could not find out" must never render as "there is nothing":

| Situation | State | Visible? |
|---|---|---|
| git failed / no commit recorded / log unreadable | `unavailable` | YES — compact "currently unavailable" |
| run not finished yet | `not_yet_created` | no |
| git ANSWERED and no test file moved | `not_applicable` | no |
| manifest unreadable but diff real | `available` + `manifestStatus:"unavailable"` | YES — rows shown, links stated as missing |

## Cache correctness

Every new source file is added to `computeSourceRev` via `slice2RevPaths()`, INCLUDING
files that do not exist yet (they fingerprint as `absent`, so their later creation
changes the rev). This is the direct fix for the class of bug S1's review caught, where
an input outside the rev was frozen by the cache forever.

## Footprint

New server modules: `tests-diff` · `traceability` · `review-state` · `decisions` ·
`artifacts-slice2` · `slice2-sources` · `types-slice2` · `document-read` (extracted so
`resolver.ts` stays under 300). Client: `types` mirror + `MissionSlice2Details.tsx` +
`ARTIFACT_ORDER` extended to all six. Every file ≤ 300 LOC; bloat baseline untouched.

## Tests

Server: diff parsing/classification incl. removed, sha rejection, git-failure ≠ empty;
manifest inversion + fold provenance + corrupt/oversized bounding + a REAL-file
calibration probe against this repo's own manifest; review normalization incl.
absent-vs-unreadable and the internal-pass rule; decisions exact-match isolation with
prefix-collision run ids + a REAL-file probe against the 639 KB log. Client: the three
detail renderers + the wording honesty rules. E2E (RUN): a real two-commit git repo whose
second commit adds/modifies/DELETES test files.

# ADR — Mission recovery: pay the scan where it is used, reach back only when there is something new to reach

- **Run-ID:** iterate-2026-07-21-mission-recovery-memo-perf
- **Date:** 2026-07-21
- **Section:** Iterate — change: Mission run-identity recovery cost (FR-01.66)
- **Complexity:** medium · **change_type:** change · **spec_impact:** none
- **affected_frs:** `FR-01.66`

## Context

The internal code review of PR #309 raised four non-blocking findings. Two are
performance defects that make an ADR claim false; two are records that describe
less than the code does. This run closes all four and changes no behaviour.

The prior ADR states the transcript scan is *"paid once per task, not once per
poll"*. Measured against this machine, both halves of that promise leaked:

| Measured 2026-07-21 (read-only) | Value |
|---|---|
| transcripts on disk for this project | 74 |
| …over 1 MB, where the two window sizes actually differ | **58 (78 %)**, median 2.1 MB, max 114 MB |
| store tasks / with a durable association | 419 / 3 |
| store tasks that are pipeline / campaign-titled | **0 / 7** |
| extra bytes decoded + allocated + scanned per poll | **~425 KB** |

## Decision

### 1. The footer is consulted at the rule that uses it, not before it

`ScenarioInputs.transcriptRunId` (a value, computed eagerly in `resolver.ts`)
becomes `recoverTranscriptRunId` (a thunk, invoked by `detectScenario` at ordered
rule 5). Rules 1–4 have all missed by then, so every caller that reaches the scan
also RESOLVES on it, and the route persists that answer.

This is what makes the prior ADR's claim true. It was false for one class: a
campaign- or pipeline-resolved session quoting a *corroborated* footer never
reached rule 5, so nothing consumed the answer, nothing persisted it, and the
negative memo — which only records "this text has no marker" — did not apply. It
re-ran the regex and the record lookup on every poll, forever.

The alternative the review offered, *memoize the positive result*, was
**rejected**: it caches an answer nobody asked for, still pays one full scan, and
gives the memo two meanings with two eviction stories. Deferring removes the work
rather than remembering it.

`ScenarioDecision` also gains `runIdSource`, so the resolver reads the
association off the winning rule instead of re-deriving it from `pointer.status`
plus a separately-computed candidate. Behaviour is identical rule by rule; one
latent contradiction disappears (the association branch reported
`transcript_run_id` beside a null id).

**No once-guard.** The external plan review asked for a memo so a future rule
consulting the thunk twice could not restore the bug. Rejected, and the internal
review agreed it is defensible: a guard would ABSORB that mistake silently. The
invariant is held by a failing test instead — `recovery-schedule.test.ts` asserts
the call COUNT, not the answer.

### 2. The 1 MB window is a reach-back, not a subscription

The wide window exists to see HISTORY. Anything written later is appended at the
END, inside the ordinary 512 KB tail. So it is requested once per task, and after
that only when the transcript has actually changed.

`readTranscriptTail` now returns `{text, revision}`, the revision being
`path:size:mtime` — already in hand from the `findByUuid` the reader performs
anyway, so scheduling costs no extra I/O. `path` catches a replaced transcript,
`size` the append, `mtime` an in-place rewrite. The budget for poll *n* is chosen
from poll *n-1*'s revision, which keeps this to ONE read per poll at the cost of
a one-poll (10 s) lag on a newly arrived footer.

Two rejected designs, both on measurement rather than taste:

- **A 256-char tail signature** (my first draft). Both external providers called
  it an unreliable change detector, and it needed a read before it could choose a
  budget. Replaced by the reader-supplied revision.
- **Gating on the scenario** — narrow the window for scenarios that can never
  use the recovery. That buys ≤ 7 of 419 tasks. The change-detection gate covers
  all 412 once their transcript goes idle, which is the real population.

The invariant is **conditional** and stated as such: a narrower window cannot
lose a recovery *unless* the transcript outruns the ordinary tail within one poll
interval. Such a session is in flight and therefore pointer-identified, so it
does not reach this path.

**What this actually saves — corrected during internal code review.** ~425 KB per
poll of UTF-8 decode, allocation and scanning; **not** I/O.
`SessionWatcher.readChunk` reads the whole file and then slices, so the tail
budget bounds the SLICE. The whole-file read is the larger cost, is outside this
brief, and is filed as triage `trg-4c0e54d6`.

### 3. The persistence half of the (e) reversal is recorded

PR #309 removed the `unregistered_worktree` integrity gate and its ADR recorded
only that *"no read moved"*. A **write** moved: that gate returned through
`integrityResult`, which hard-codes `associateRunId: null`, so while it stood the
ordinary post-Finalize pointer persisted NOTHING. Removing it lets that pointer
fall through to the iterate path and record `source: "iterate_active_pointer"` —
which is what makes the fix survive pruning moments later. The evidence is
unweakened (the pointer PASSED validation) and the `invalid`-pointer path still
writes nothing. Amended into the prior run's ADR and its decision drop, and
restated in this run's commit message because those artifacts are gitignored.

### 4. `runLive` is documented as what it computes

The client mirror described `runLive` as a registered worktree only, omitting the
terminal `work_completed` condition the plan review had added; the server comment
overclaimed in the other direction ("false for every abandoned run"). Both now
carry the same clause set, and `mission-runlive-doc-parity.test.ts` ratchets it —
including a clause tying the prose to the resolver EXPRESSION, so the two
comments cannot agree with each other while both being wrong.

## External-Plan-Review-Findings

11 findings across two providers; full table with dispositions in
`spec.md`. Two HIGH (tail-signature unreliability, the implied double read) drove
the redesign to a reader-supplied revision. One LOW (a once-guard) is
`rejected-with-reason` — recorded here because the first draft of that table said
"accepted-and-fixed" for a guard that had been removed, and the internal review
caught it.

## Internal-Code-Review-Findings

9 findings; full table in `spec.md`. One MEDIUM was a **real bug**: a `persist()`
that fails rolls the association back but left the reach-back marker in place,
pinning the task to the ordinary tail while unidentified — re-entering, through
the read side, the data loss the rollback exists to prevent. Fixed and pinned.
One MEDIUM corrected the read-vs-decode claim above. One LOW
(`associateSource` still non-nullable when the id is null) is
`rejected-with-reason` as scope this brief does not carry.

## Self-Review

Seven points, in `spec.md`. Headline: 14 revert-and-rerun mutations, 14 caught;
no file over 300 LOC (`routes.recovery.test.ts` was SPLIT at 308 rather than
ratcheted); the two files the review flagged as watch items are unchanged in
size; `anti_ratchet_check.py` exits 0.

## Confidence Calibration

In `spec.md`. Two probes changed the design rather than confirming it: the
transcript size distribution (78 % over 1 MB) showed the wide window is not free,
and the task-class distribution (0 pipeline, 7 campaign of 419) killed a
scenario-keyed gate before it was written.

## Consequences

- A pipeline- or campaign-identified session performs **zero** transcript scans.
- An idle unidentified session reaches back once and then reads the ordinary tail
  for as long as its transcript does not move.
- A footer that arrives during an open Mission tab is picked up one poll later
  than before (10 s).
- `MissionContextRouterDeps.readTranscriptTail` is a **breaking internal**
  contract change (`string` → `{text, revision}`); five in-repo test doubles were
  updated. No wire shape changed, so no client-visible effect.
- The transcript whole-file read remains, now recorded rather than implied.

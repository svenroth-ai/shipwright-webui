# Iterate Spec — Mission recovery: pay the scan once, read the wide tail once

- **Run-ID:** iterate-2026-07-21-mission-recovery-memo-perf
- **Date:** 2026-07-21
- **Intent:** CHANGE (Path B) · **Complexity:** medium (escalated from `small`)
- **change_type:** change · **spec_impact:** none · **affected_frs:** `FR-01.66`
- **Source:** internal code review of PR #309 — four non-blocking findings.

## Context

PR #309 shipped the third run-identification source (the session's own `Run-ID`
commit footer). Its ADR claims the scan is *"paid once per task, not once per
poll"*. The internal review found that claim false for one class, found a second
per-poll cost the memo does not cover, and found two records that describe less
than the code does. None changed the merge decision; all four are recorded here.

### Finding 1 — the scan runs before the decision that would use it

`resolver.ts` calls `recoverRunIdFromTranscript` **before** `detectScenario`, and
the negative memo in `run-id-recovery.ts` is written **only when no candidate is
found**. So a session that (a) has no pointer, (b) has no association, and
(c) quotes a *corroborated* footer, but (d) resolves to `pipeline` or `campaign`
at rule 3/4 — never reaches rule 5, never persists, and therefore re-runs the
regex over the tail plus the record lookup on **every poll, forever**.

### Finding 2 — the wide window is requested forever for a plain session

`routes.ts` widens the transcript read from 512 KB to 1 MB whenever
`task.missionContext` is unset. For a genuinely plain session that is permanent.
The memo skips the *regex* but not the *read, decode and allocation*.
The comment claims *"the very next poll drops back"*, which is true only after a
successful recovery.

### Finding 3 — the (e) reversal is half-recorded

The prior ADR documents the removal of the `unregistered_worktree` gate as a
**read** change ("No read moved"). It also changed **persistence**: that gate
returned through `integrityResult`, which hard-codes `associateRunId: null`.
With the gate removed the same pointer now falls through to the ordinary iterate
path and **writes a durable association**. That is the half that makes the fix
survive pruning — and it was unrecorded.

### Finding 4 — the mirrored `runLive` doc omits the terminal condition

`client/src/lib/missionContextApi.ts` describes `runLive` as *"a validated
pointer whose worktree git still registers"*. The implementation is
`chosen.isWorktree && events.status !== "found"` — a `work_completed` record ends
live-ness. The server SoT comment (`types.ts`) is also imprecise in the other
direction ("False for every finished/**abandoned** run" — an abandoned run with a
registered worktree and no `work_completed` is live by design).

## Measurements (real machine, read-only, 2026-07-21)

| Probe | Value |
|---|---|
| this project's transcripts on disk | 74 |
| …over 1 MB (both windows differ) | **58 (78%)**, median 2.1 MB, max 114 MB |
| …under 512 KB (both windows identical, wide costs nothing) | 9 (12%) |
| mean EXTRA bytes DECODED + allocated + scanned per poll | **425 KB** |
| store tasks total / with association | 419 / **3** |
| store tasks that are pipeline (`phaseTaskId`+`runId`) | **0** |
| store tasks campaign-titled | **7** |
| Mission-context poll interval | 10 s (`MISSION_CONTEXT_POLL_MS`) |

Two design consequences, both from the numbers rather than from taste:

1. Finding 2 is **not** moot — 78 % of transcripts are past 1 MB, so the wide
   window really does cost ~425 KB more per poll on average. (Corrected at
   internal code review: that is decode + allocation + scan, NOT I/O —
   `SessionWatcher.readChunk` reads the whole file and then slices, so the tail
   budget bounds the SLICE. See triage `mission-context-whole-file-transcript-read`.)
2. The class that pays it is the **412** neither-pipeline-nor-campaign tasks, not
   the 7 campaign ones. A gate keyed on "this scenario can never use the
   recovery" would therefore buy ≤ 7 tasks. **Rejected as speculative
   complexity**; the change-detection gate below covers all 412.

## Acceptance Criteria

- **AC1** — The transcript scan runs **only** when the ordered scenario table
  actually reaches rule 5. A session resolving to `custom_actions`, `iterate`
  (pointer or association), `pipeline` or `campaign` performs **zero** scans, on
  every poll.
- **AC2** — A corroborated footer in a session that resolves to `campaign` (or
  `pipeline`) is never scanned for, so the forever-loop of finding 1 cannot
  occur. The resolved scenario is unchanged: still `campaign` / `pipeline`.
- **AC3** — The wide (1 MB) reach-back is requested **only** when the transcript
  **revision** (path + size + mtime, supplied by the reader) differs from the one
  observed at the last wide reach-back for that task. An idle unidentified
  session drops to the ordinary 512 KB tail from its second poll onward and stays
  there. Exactly ONE transcript read per poll, at the chosen budget.
- **AC4** — A footer that arrives later is still recovered: after the transcript
  changes, the NEXT poll requests the wide window again and the recovery
  succeeds. The one-poll (10 s) lag is deliberate — the budget for poll *n* is
  chosen from the revision observed at poll *n-1*, which is what keeps it to one
  read.
- **AC4a** — A transcript read that FAILED (no revision) never advances the
  reach-back marker, so a fault cannot suppress recovery permanently.
- **AC5** — Every resolved `MissionContext` is byte-identical to what the
  pre-change code produced, for all six scenarios. This run changes *when* work
  is done, never *what is answered*.
- **AC6** — The association written after a recovery is unchanged
  (`source: "transcript_run_id"`, exactly one `persist()`), and the pointer path
  still writes `source: "iterate_active_pointer"`.
- **AC7** — The prior run's record states the **persistence** half of the (e)
  reversal, in the artifact that becomes the released ADR.
- **AC8** — `runLive` is documented accurately in the server SoT and the client
  mirror, both naming the terminal `work_completed` condition, and a test
  RATCHETS that parity (the existing sync guard strips comments and cannot).

## External-Plan-Review-Findings

| # | Provider | Severity | Finding | Disposition |
|---|---|---|---|---|
| 1 | openai | HIGH | A 256-char tail signature is not a reliable change detector (repetitive output, rotation, rewrite) | **accepted-and-fixed** — replaced by a reader-supplied revision (`path:size:mtime`); AC3 rewritten |
| 2 | openai | HIGH | To compare signatures the route must read FIRST — the gate implies two reads per changed poll | **accepted-and-fixed** — the revision comes back WITH the single read; the budget for poll *n* uses poll *n-1*'s revision (AC4, one-poll lag, stated not hidden) |
| 3 | openai | MEDIUM | Per-task state lifecycle: leak, id reuse, transcript replacement, restart | **accepted** — capped map cleared wholesale at the cap; the revision includes the transcript PATH, so replacement invalidates; restart ⇒ one wide read, documented |
| 4 | openai | MEDIUM | A failed/partial wide read must not advance the marker; concurrent polls | **accepted** — AC4a; an empty revision is never recorded. Concurrency: two polls both reading wide is idempotent, and the association write keeps its existing compare-and-set |
| 5 | openai | MEDIUM | `runIdSource` could silently change persistence for the pointer/association cases | **accepted** — the rule→association mapping is enumerated in the mini-plan and pinned per scenario, context AND `persist()` args (AC5/AC6) |
| 6 | openai | MEDIUM | Nothing stops the `runLive` docs drifting again — the sync test strips comments | **accepted-and-fixed** — AC8 gains a focused doc-parity ratchet |
| 7 | openai | LOW | Retaining raw tail text in a long-lived cache is needless in-memory exposure | **accepted** — moot after #1; the cache holds a revision string, never content |
| 1 | gemini | MEDIUM | Unbounded per-task map = cumulative leak | **accepted** — same fix as openai #3 |
| 2 | gemini | LOW | A size/stat integer is simpler than a tail signature | **accepted** — the same conclusion as openai #1/#2, and `JsonlLocation` already carries it |
| 3 | gemini | LOW | Multi-byte mutilation when slicing 256 chars | **moot** — no content slicing survives |
| 4 | gemini | LOW | A future refactor could invoke the thunk twice, silently restoring the bug | **rejected-with-reason** — a memo guard would ABSORB that mistake; exactly-once is pinned instead by `recovery-schedule.test.ts` "is paid EXACTLY ONCE when rules 1-4 all miss", which fails on the second call. (This row read "accepted-and-fixed" until the internal code review caught that the guard had been removed and the record not updated — the exact defect class this run exists to fix.) |

## Affected Boundaries

| Boundary | Producer | Consumer | Probe |
|---|---|---|---|
| resolver ↔ scenario table (in-process call contract) | `resolver.ts` | `scenario.ts` | unit: the thunk is not invoked when rules 1–4 match |
| route ↔ transcript reader (`readTranscriptTail`) | `wire.ts` (SessionWatcher) | `routes.ts` | unit: the byte budget the route asks for, per poll |
| server wire types ↔ client mirror | `core/mission-context/types.ts` | `client/src/lib/missionContextApi.ts` | `mission-context-types-sync.test.ts` (comment-stripping, so doc-only edits are free) |
| task store (`missionContext` association) | route | store | unchanged — pinned by the existing recovery tests |

## Out of scope

- Any change to the admission rules (canonical shape / line-termination /
  corroboration), the ranking, the 1 MB measured window size, or `runLive`'s
  computation. This run moves no decision, only the schedule of the work.
- Persisting a negative result. Already rejected in #309 (a second meaning for
  `task.missionContext`); still rejected.

## External-Code-Review-Findings

| # | Provider | Severity | Finding | Disposition |
|---|---|---|---|---|
| 1 | openai | MEDIUM | `wideWindows` cleared on EVERY write, so at capacity each poll evicts all 511 other tasks and hands each a fresh 1 MB read — defeating the very optimisation | **accepted-and-fixed** — clear only when a NEW key would overflow; pinned by a cap test (M10) |
| 2 | openai | MEDIUM | No structural once-guard on the thunk; and the test comment still CLAIMED there was one | **accepted-in-part** — the stale comment was a real defect and is fixed. The guard stays out, on purpose: a guard absorbs the mistake, the count assertion reports it, and CI runs the assertion. Rationale is at the call site, not just here |
| 3 | openai | MEDIUM | AC7's record is nowhere in the diff | **accepted-and-fixed** — the amendment lives in the prior run's (untracked) ADR + decision drop, so this run also states the persistence half in the COMMIT MESSAGE and the CHANGELOG drop, which do ship |
| 4 | openai | LOW | The "parity" test checks presence, not parity — two divergent descriptions would both pass | **accepted-and-fixed** — both docs are now held to the same normalised CLAUSE SET (pointer validated · worktree registered · terminal `work_completed` · what the client does) |
| — | gemini | — | returned a truncated fragment that concluded the invalid-pointer path is intended | recorded, not actionable |

## Internal-Code-Review-Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | MEDIUM | A `persist()` that fails rolls back the association but NOT the reach-back marker, so the task is pinned to the ordinary tail while unidentified — permanently unreachable for a footer beyond it. Re-enters, through the read side, the data loss the rollback exists to prevent | **accepted-and-fixed** — `wideWindows.delete` beside `revertMissionContext`; pinned by "a ROLLED-BACK association takes the reach-back marker down with it" (mutation M12) |
| 2 | MEDIUM | The plan-review disposition table claimed the thunk was once-guarded; the guard had been removed. A third instance of the defect class this run exists to fix | **accepted-and-fixed** — gemini #4 above is now `rejected-with-reason`, and the mini-plan matches. The omission itself the reviewer judged defensible |
| 3 | MEDIUM | "425 KB of extra READ per poll" is false: `SessionWatcher.readChunk` reads the whole file and then slices, so the budget bounds the SLICE. The saving is decode + allocation + scan | **accepted-and-fixed** — corrected in `routes.ts`, this spec, the mini-plan and the commit message; the whole-file read filed as triage `mission-context-whole-file-transcript-read` |
| 4 | LOW | "History does not change" is unconditional; ~512 KB appended within one poll interval could carry a footer past the narrow window | **accepted** — the invariant is now stated as CONDITIONAL in `routes.ts` and the mini-plan. Not otherwise mitigated: such a session is in flight and pointer-identified |
| 5 | LOW | The map is written for already-identified tasks, which can never go wide — pure cap pressure | **accepted-and-fixed** — `&& !task.missionContext`; pinned by "an already-identified task does not consume the cap" (mutation M13) |
| 6 | LOW | `scenario.ts` header still pointed at the removed `transcriptRunId` field | **accepted-and-fixed** |
| 7 | LOW | The clause regex encoded the server comment's line wrapping | **accepted-in-part** — already fixed by normalising the doc before matching; the reviewer's simplified single pattern was NOT adopted because it fails the client's phrasing ("whose worktree git still registers"), which their sandbox could not run to discover. Both phrasings are now alternatives |
| 8 | LOW | `associateSource` is still non-nullable and meaningless when `associateRunId` is null | **rejected-with-reason** — the pair the run set out to fix (row 2b) is fixed; collapsing the two fields into one nullable object ripples through `integrityResult`, the non-iterate return and the route, which is scope this brief does not carry. Recorded as a known shape, not a defect |
| 9 | — | No CHANGELOG drop yet | expected at F4 |

**What the reviewer tried and could NOT break** (recorded because it is evidence,
not decoration): the stat-before-read ordering in `wire.ts` means a recorded
revision can only be OLDER than the bytes returned, so a read racing an append
schedules an extra reach-back and never a missed one; the cap only ever costs
extra reads; a tab reopened after a long gap reaches back on its first or second
poll; concurrent/multi-tab polls cost one poll of lag and cannot latch; and the
`runIdSource` refactor is behaviour-equivalent rule by rule, with row 2b's source
change unobservable for TWO independent reasons.

## Self-Review

1. **Spec Compliance** — pass. AC1–AC8 each have a test; AC7 additionally lands
   in the commit message + CHANGELOG drop because the ADR artifacts are
   gitignored here.
2. **Error Handling** — pass. Every new path fails toward the OLD, more
   expensive behaviour: no revision ⇒ reach back again; no memory ⇒ reach back
   again; cap eviction ⇒ reach back again. A fault can cost a read; it can never
   cost a recovery.
3. **Security Basics** — pass. No new input is trusted. The scheduling key is
   filesystem METADATA (`path:size:mtime`), never transcript content, so the
   cache holds no session text (external plan review, openai LOW). `wideWindowCap`
   is a test seam with a production default, not a reachable API surface.
4. **Test Quality** — pass after two corrections. 11 revert-and-rerun mutations,
   11 caught. One of my own tests was proved unfalsifiable *by the harness*
   (it asserted the footer was recovered while serving the same text at either
   budget, so it could not distinguish the windows) and was rewritten around
   `narrowText`; one comment claimed a guard that no longer existed, caught by
   the external code review.
5. **Performance Basics** — pass, and it is the point — though the win is
   smaller than this section first claimed. Measured: 78 % of this project's 74
   transcripts exceed 1 MB, and the wide window cost ~425 KB per poll for 412 of
   419 tasks, permanently. That is UTF-8 decode, string allocation and downstream
   scanning — **not** I/O: `SessionWatcher.readChunk` reads the whole file and
   then slices (internal code review, MEDIUM). The whole-file read is the larger
   cost, is outside this run's charter, and is filed as triage
   `mission-context-whole-file-transcript-read`. It is now one reach-back per task
   plus one per transcript change.
6. **Naming & Structure** — pass. No file over 300 LOC; the two watch items
   (`types.ts` 296, `mission-context-types-sync.test.ts` 300) are unchanged in
   size — the `runLive` doc rewrite is deliberately net-zero lines. When the new
   route tests pushed `routes.recovery.test.ts` to 308 it was SPLIT
   (`routes.recovery-schedule.test.ts`), not ratcheted. `anti_ratchet_check.py`
   exits 0.
7. **Affected Boundaries** — pass. Four boundaries, each probed: the resolver↔table
   call contract (call-count assertions, not just answers), the route↔reader
   contract (byte-budget SEQUENCES), the server↔client mirror (clause-set
   ratchet), the task store (unchanged, pinned by the pre-existing tests).

### One deliberate behaviour change, disclosed

`associateSource` for the association-resolved branch changes from
`"transcript_run_id"` to `"iterate_active_pointer"`. It is unobservable: the
route reads `associateSource` only inside `if (associateRunId && ...)`, and that
branch always carries `associateRunId: null`. It is included because leaving the
pair self-contradictory is how the next reader gets it wrong.

## Confidence Calibration

- **Boundaries touched:** resolver↔scenario table · route↔transcript reader ·
  server wire types↔client mirror · task store (read-only here).

- **Empirical probes run:**
  - *Real transcripts (74 files, read-only).* Size distribution: 58 over 1 MB
    (median 2.1 MB, max 114 MB), 9 under 512 KB. **This inverted a design
    decision** — I had assumed the wide window was near-free because the reader
    clamps to the file size, which is true for only 12 % of real sessions.
  - *Real store (419 tasks, read-only).* 3 associations, 0 pipeline, 7
    campaign-titled. **This killed a gate I was about to build**: narrowing the
    window by scenario would have helped ≤ 7 tasks, so the schedule is keyed on
    transcript change instead, which covers all 412.
  - *11 revert-and-rerun mutations*, listed above, 11 caught. The two that
    matter most: reverting the deferral (11 tests fail) and reverting the cap fix
    (1 test fails, and it is the test the external review's finding created).
  - *Falsifiability of the doc ratchet.* Rewriting the client `runLive` doc to
    drop the pointer/worktree clauses fails it; so does removing the terminal
    condition from the resolver EXPRESSION, which is what stops the two comments
    agreeing with each other while both being wrong.
  - *Full suites.* server 2887 passed / 1 skipped, client 2877 passed, both
    workspaces `tsc --noEmit` clean, lint unchanged.

- **Test Completeness Ledger:** see `## Test Completeness Ledger` below.

- **Confidence-pattern check.**
  *Asymptote (depth):* the last probe round — the cap-eviction test and the
  clause-set ratchet, both added from external-review findings — produced no
  further findings in the schedule's behaviour. The mutation catch rate did not
  move off 100 % across rounds.
  *Coverage (breadth):* the schedule is exercised as a SEQUENCE (4 polls) rather
  than a single call, across four states: never-changing, changing, unreadable,
  and at cap. Both identification paths (pointer, transcript) and all six ordered
  rules are asserted for their association pair.
  *Integration composition:* `cross_component` is not flagged — this diff touches
  no merge/hook/phase-validator/campaign-drain machinery.

- **Edge cases NOT probed, and why that is acceptable:**
  - **A transcript that changes without changing `path:size:mtime`.** An
    in-place rewrite preserving both length and mtime. The transcript is
    append-only JSONL written by Claude Code; the consequence would be one
    delayed reach-back, not a wrong answer.
  - **More than 1 MB appended between two polls of an unidentified session**,
    burying a footer beyond even the reach-back. Unchanged from the pre-existing
    behaviour — the old code had the same 1 MB ceiling — so this run neither
    introduces nor removes it.
  - **Two servers polling the same task concurrently.** Both may reach back; the
    schedule map is per-process and idempotent, and the association write keeps
    its existing compare-and-set under `proper-lockfile`.

## Test Completeness Ledger

| # | Behaviour introduced/changed | Disposition | Evidence |
|---|---|---|---|
| 1 | The footer is consulted only at rule 5 | `tested` | `recovery-schedule.test.ts` "is NOT paid when rule %s matches first" (5 cases) |
| 2 | It is consulted at most once per resolve | `tested` | same file, "is paid EXACTLY ONCE"; mutation M2 |
| 3 | An invalid pointer never consults it | `tested` | same file, "is NOT paid for an INVALID pointer" |
| 4 | `runIdSource` reports the winning rule | `tested` | same file, "reports WHICH source identified the run" |
| 5 | A campaign/pipeline session performs 0 scans across polls | `tested` | same file, Part B, real `_recoveryScanCount()` |
| 6 | An unidentified session scans once and persists | `tested` | same file, Part B; `routes.recovery.test.ts` (association shape + one `persist`) |
| 7 | The reach-back happens once for an unchanging transcript | `tested` | `routes.recovery-schedule.test.ts` budget sequence; mutation M4 |
| 8 | It happens again after the transcript changes, and recovers | `tested` | same file, "reaches back AGAIN…"; mutation M5 |
| 9 | A read with no revision never marks it done | `tested` | same file, "…NO revision…"; mutation M6 |
| 10 | Cap eviction does not punish tasks already in the map | `tested` | `routes.recovery-schedule.test.ts` "evicting at the cap…"; mutation M10 |
| 10a | A rolled-back association drops the reach-back marker | `tested` | same file, "a ROLLED-BACK association…"; mutation M12 |
| 10b | An identified task never consumes the cap | `tested` | same file, "an already-identified task does not consume the cap"; mutation M13 |
| 11 | An identified task never reaches back | `tested` | `routes.recovery.test.ts` "reads the WIDER tail only while unidentified" |
| 12 | `runLive` is documented with every clause on both sides | `tested` | `mission-runlive-doc-parity.test.ts`; mutations M7, M11 |
| 13 | The docs cannot agree with each other and both be wrong | `tested` | same file, "the implementation really is that conjunction"; mutation M8 |
| 14 | `wire.ts` builds the revision from `path:size:mtime` and returns the tail with it | `tested` | E2E `mission-recovery-schedule.spec.ts` — the only coverage of the real `wire.ts` → `SessionWatcher` composition, and PROVED falsifiable: breaking `wire.ts` to return an empty `text` makes "a recovered rail is still there on the SECOND and THIRD read" fail. The literal revision FORMAT is not asserted anywhere; its contract (empty on fault, changes when the file does) is pinned by #7–9. |
| 15 | The prior run's record states the persistence half | `untestable` — `requires-manual-visual-judgment` | Prose in an ADR + decision drop; verified by reading, and restated in the commit message |

Testable-but-untested: **0**.

**Mutation record: 14 revert-and-rerun mutations, 14 caught.** M1 deferral undone
· M2 thunk consulted twice · M3 recovery not persisted · M4 window never narrows
· M5 reach-back never repeats · M6 failed read marks it done · M7 mirror doc drops
`work_completed` · M8 `runLive` loses the terminal condition · M9 `runIdSource`
lies · M10 cap clears on every write · M11 mirror doc loses the pointer clause ·
M12 rollback keeps the marker · M13 identified tasks consume the cap · M14 mirror
doc drops the worktree clause. Plus one E2E falsification (broken `wire.ts` text).

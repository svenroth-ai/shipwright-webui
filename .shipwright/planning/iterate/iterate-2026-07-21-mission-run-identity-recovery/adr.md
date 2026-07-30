# ADR — Mission: recover the run identity, stop erasing the rail

- **Run-ID:** iterate-2026-07-21-mission-run-identity-recovery
- **Date:** 2026-07-21
- **Section:** Iterate — change: Mission view run identity (FR-01.66)
- **Complexity:** medium · **change_type:** change · **spec_impact:** modify
- **affected_frs:** `FR-01.66`

## Context

The Mission tab showed nothing for essentially every iterate the operator had
run. Measured 2026-07-21 against the real store, the real transcripts and the
running server (read-only probes):

| Measured | Value |
|---|---|
| tasks with a durable `missionContext` association | **1 of 416** |
| this project's sessions identifiable (pointer ∪ association) | **20 of 152** |
| live `iterate_active` pointers | 20 |
| …whose `worktree_path` git still registers | **0 of 20** |
| live mission-context probes returning six `unavailable` | **3 of 3** |

Three independent causes, one symptom.

1. **The identity was only discovered while somebody was looking.** The
   association is written only when the mission-context endpoint runs, i.e. only
   with the Mission tab open DURING the live window; `prune_stale_run_pointers`
   then deletes the pointer at Finalize. The operator works in the terminal, so
   nothing durable was ever written.
2. **`unregistered_worktree` erased the rail.** A pointer naming a worktree git
   no longer registers returned six `unavailable` artifacts — the ordinary
   post-Finalize state of every pointer on disk.
3. **A live iterate rendered a blank rail.** Hide-empty hides
   `not_yet_created`, so a run in flight (which has written nothing yet) showed
   an empty rail for its entire early phase.

## Decision

### 1. A third identification source: the run's own commit footer

Precedence: pointer → association → pipeline → campaign → **transcript
`Run-ID`** → plain.

Ranked BELOW pipeline/campaign, unlike the association: an association is a
server-OBSERVED fact, a footer is text a session happens to contain. Verified
against real data — the campaign session `f0186aa9` quotes a sub-iterate's
footer and resolves `campaign` on the live server today; ranking the footer
higher would have demoted it to `iterate`.

Three checks, each derived from a REAL false positive found while probing 67
transcripts:

- **canonical shape** `iterate-YYYY-MM-DD-slug` (+ `isSafeRunId`) — a
  permissive class matched `Run-ID: iterate-` and `Run-ID: security-…`, both of
  which pass `isSafeRunId` and resolve to nothing;
- **line-terminated**, with an ENUMERATED escape set (`\n`, `\r`, `\"`, real
  CR/LF, EOF) — rejects the measured prose `→ decision_log.md (ADR via
  Run-ID: iterate-2026-06-14-repair-claude-json)` in a session that is not an
  iterate;
- **corroborated** by this project's own records (`work_completed` in
  `shipwright_events.jsonl`, or `iterates/<run_id>.json`) — rejects the 2
  cross-repo run ids quoted in webui sessions while keeping 29 of 31.

LAST match wins. Ground truth (the 19 sessions that still have a live pointer):
**18 agree, 0 disagree, 1 has no transcript on disk.** The alternative the
external review proposed — recover only when exactly ONE distinct candidate
remains — was REJECTED: 7 real sessions carry more than one id in the window and
last-wins is correct in every ground-truth case, so uniqueness would cost 7 real
recoveries and buy no measured accuracy.

Window: 1 MB, read only while the task is unidentified. Measured: 512 KB
recovers 42 sessions and misses 4 pointer-truth cases (the closest sits 526 KB
from the end); 1 MB recovers 50 and misses none; 2/4/8 MB add nothing.

The result is PERSISTED through the existing `setMissionContextOnce` +
rollback path (`source: "transcript_run_id"`), so the scan is paid once per
task, not once per poll. No second write surface.

**Measured effect (shipped code over the real store): 20 → 49 identifiable
sessions, +29 recovered, 2 correctly declined.**

### 2. `runLive` — a live run lists its artifacts as pending

`runLive = git still registers the pointer's worktree AND the run has not
recorded `work_completed``. The client then keeps `not_yet_created` VISIBLE,
inert, worded "Not written yet". `not_applicable` stays hidden; `unavailable`
never becomes pending — a read failure must stay distinguishable from "not
written yet".

The terminal-state half came from the external plan review: a worktree is a
filesystem PROXY for "in flight", and an abandoned run leaves one behind;
"pending" for a run that is over is the same lie mirrored.

### 3. The unregistered-worktree gate is REMOVED (reversing an earlier review)

The gate was added in S1 on an external-review HIGH ("never a quiet
fall-through … to the project root"). It is removed here, and the reasoning is
recorded rather than buried:

- **It fired on the normal case, not on an anomaly.** 20 of 20 real pointers
  name a `.worktrees/<slug>` directory git no longer registers, because
  `git worktree remove` leaves the directory behind. All 20 have their
  `work_completed` record in the main root and now render a real rail.
- **It made `chooseRoot`'s own contract unreachable.** That function documents
  the fallback ("a `worktree_path` that is not a member is not an error … the
  post-Finalize / pruned case is the common one") and the gate returned before
  it could ever run.
- **No read moved.** `chooseRoot` still refuses to read below an unregistered
  root; the run_id is grammar-validated; `pathGuard` + `realPathGuard` still
  gate every read. A decoy document inside the unregistered directory is pinned
  as never-read, at both the resolver and the route level.
- **A WRITE did move, and that is the half this ADR originally left out**
  (recorded 2026-07-21 by the internal code review of PR #309, finding 3;
  amended by `iterate-2026-07-21-mission-recovery-memo-perf`). The gate returned
  through `integrityResult`, which hard-codes `associateRunId: null` — so while
  it stood, the ordinary post-Finalize pointer produced **no durable
  association**. Removing it lets that pointer fall through to the normal iterate
  path, where `associate = runId` with `source: "iterate_active_pointer"`. This
  is not a side effect of the read fix, it is what makes the fix SURVIVE: the
  pointer is pruned moments later, and without the write the very next poll
  would be back to `plain`. The evidence is unweakened — the association is
  written from a pointer that PASSED validation, and an `invalid` pointer still
  takes the integrity path and still writes nothing.
- The **`invalid` pointer** path is untouched: a pointer that fails validation
  still yields six honest `unavailable` artifacts and no association.

## External-Plan-Review-Findings

| # | Provider | Severity | Finding | Disposition |
|---|---|---|---|---|
| 1 | gemini | HIGH | A plain session re-scans 1 MB every poll forever | accepted-and-fixed — negative memo (content-fingerprinted) |
| 2 | gemini | HIGH | Regex must handle JSON-escaped newlines | accepted — already implemented + tested on real JSONL |
| 3 | gemini | MEDIUM | Corroboration parses a heavy log | rejected-with-reason — `findWorkCompleted` is (mtime,size)-indexed; a Map hit after one build |
| 4 | gemini | LOW | A pasted run id could hijack a plain session | accepted-with-mitigation — line-termination rejects the one real case; residual risk recorded below |
| 5 | gemini | — | (truncated by the provider) | not actionable |
| 6 | openai | HIGH | Ambiguity: multiple markers in one transcript | rejected-with-reason — last-wins agrees 18/18 with ground truth; uniqueness would cost 7 recoveries |
| 7 | openai | MEDIUM | `runLive` is a filesystem proxy | accepted-and-fixed — a `work_completed` record now ends live-ness |
| 8 | openai | MEDIUM | Negative results are not cached | accepted-and-fixed — same memo as #1 |
| 9 | openai | MEDIUM | `runLive` wire compatibility | accepted — client normalizes `=== true`; a missing-field test pins it |
| 10 | openai | MEDIUM | Tail-boundary parsing semantics | accepted-and-fixed — probes for CRLF, EOF, window cut, broken UTF-8 |
| 11 | openai | MEDIUM | Ensure nothing downstream consumes the raw worktree path | accepted — `chosen.root` is the only read root; decoy-document test added |
| 12 | openai | MEDIUM | Re-validate at the persistence boundary; exact corroboration | accepted — `isMissionContextAssociation`; tests pin that prose/prefix matches do NOT corroborate |
| 13 | openai | LOW | Concurrent polls racing the write | accepted-no-change — compare-and-set is synchronous; persist takes the lockfile |
| 14 | openai | LOW | Rail-level empty logic + clickability | accepted — covered by the pending-rail and inertness tests |

## External-Code-Review-Findings

| # | Provider | Severity | Finding | Disposition |
|---|---|---|---|---|
| 1 | openai | MEDIUM | Memo keyed on `transcript.length` freezes every session past 1 MB, where the tail is always exactly `MAX_SCAN_CHARS` while its content slides — and the footer arrives BY sliding in | accepted-and-fixed — the memo now fingerprints the tail's END as well |
| 2 | openai | MEDIUM | The memo test ASSERTED that broken behaviour as the contract | accepted-and-fixed — replaced with a scan-counter observation plus a saturated-tail recovery test |
| 3 | openai | MEDIUM | The terminator accepted ANY backslash, so `…-real-run\)` in prose would match | accepted-and-fixed — enumerated `\n` / `\r` / `\"` |
| — | gemini | — | returned an empty review | recorded, not actionable |

## Self-Review

1. **Spec Compliance** — pass. All 8 ACs have a test; the three fixes match the
   measured causes.
2. **Error Handling** — pass. Every new path fails toward honesty: no marker →
   `plain`; unreadable log → not evidence; failed persist → rollback (unchanged).
3. **Security Basics** — pass. Transcript-derived input is grammar-validated,
   corroborated by exact match on a parsed field, re-validated at the
   persistence boundary, and never interpolated into a path.
4. **Test Quality** — pass, after two corrections. 17 revert-and-rerun
   mutations, 17 caught; two of my own tests were proven unfalsifiable during
   the process (one by the harness, one by the external review) and rewritten.
5. **Performance Basics** — pass. The wider read is bounded, conditional and
   dropped after the first successful recovery; the scan is memoized; the
   corroboration is an indexed Map hit.
6. **Naming & Structure** — pass. Two files split to stay under 300 LOC
   (`resolver-io.ts`, `missionWording.ts`); no file ratcheted; the bloat
   baseline is untouched.
7. **Affected Boundaries** — pass. Producer/consumer identified for all four
   boundaries; the transcript boundary is probed with CRLF, EOF, window-cut,
   broken-UTF-8 and real-file cases, and the wire boundary by the drift guard.

## Confidence Calibration

Probes run:

- **Real transcripts (67 files, read-only)** — the shipped `findRunIdFooter` +
  `hasRunRecord` over the operator's own sessions. Found: the `iterate-` and
  `security-` fabrications, the prose-quote false positive, the 526 KB
  flagship case that a 512 KB window misses, and 2 cross-repo ids.
- **Real store (152 sessions in this project)** — 20 → 49 identifiable.
- **Live server (3 sessions)** — all three returned six `unavailable`;
  the brief's expectation for case 2 (`not_yet_created`) was already stale, and
  the measurement was followed instead.
- **Event-log field mapping** — my FIRST probe read `event`/`run_id` and
  reported "17 of 31 recoveries have no evidence". The real fields are
  `type`/`adr_id`; corrected, it is 2 of 31. A probe can be wrong in the same
  direction as the code, so the mapping was verified against the raw file.
- **Tail boundary** — CRLF, EOF-without-newline, window-cut, broken UTF-8 lead
  byte, saturated 1 MB sliding window.
- **E2E on an isolated stack** — 4 new flows; the unregistered-worktree flow
  was re-run against a deliberately re-broken server and FAILED as required.

Asymptote: the last two probe rounds (stricter terminator; saturated-tail memo)
produced no further findings in the recovery numbers — 29 recoveries before and
after. Declared calibrated.

Edge cases NOT probed, and why that is acceptable:

- **A user PASTING another run's full commit footer into an unrelated chat.**
  It would be adopted. Accepted: it requires a line-terminated footer for a run
  that exists in this project, the consequence is a wrong rail on one card, and
  a live pointer or an association always outranks it.
- **Two concurrent servers racing the same association.** Unchanged from the
  pointer path, which already holds the `proper-lockfile` and rolls back.

## Consequences

- A finished iterate keeps its Mission rail forever, without the tab ever having
  been open during the run.
- `MissionContext` gains `runLive` (additive; older clients ignore it, an older
  server's absent value reads as not-live).
- `MissionContextAssociation.source` gains `transcript_run_id`; a build older
  than this one soft-drops such an association at load (it re-recovers).
- The `unregistered_worktree` integrity result no longer exists; the honest
  `invalid`-pointer one is unchanged.

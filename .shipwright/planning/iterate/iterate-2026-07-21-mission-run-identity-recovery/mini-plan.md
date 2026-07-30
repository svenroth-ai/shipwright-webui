# Mini-plan — Mission: recover the run identity, stop erasing the rail

**Run ID:** `iterate-2026-07-21-mission-run-identity-recovery`
**Complexity:** medium · **change_type:** change · **spec_impact:** modify · **affected_frs:** `FR-01.66`

## Problem

The Mission tab shows nothing for essentially every iterate the operator has run.
Three independent causes, all MEASURED on 2026-07-21 against the operator's real
store (`~/.shipwright-webui/sdk-sessions.json`, 416 sessions / 150 in this
project), the real transcripts (`~/.claude/projects/**`, 65 on disk for this
project) and the live server (read-only probes of `:3847`).

| Measured | Value |
|---|---|
| tasks with a durable `missionContext` association | **1 of 416** |
| this project's sessions identifiable TODAY (pointer ∪ association) | **19 of 150** |
| live `iterate_active` pointers | 20 |
| of those, pointers whose `worktree_path` git still registers | **0 of 20** |
| live mission-context probes returning six `unavailable` artifacts | **3 of 3** |

### Cause 1 — the identity is only ever discovered while someone is watching

`task.missionContext` is written only when the mission-context endpoint runs, i.e.
only when the Mission tab is open **during the live window**. `prune_stale_run_pointers`
then deletes the pointer once the worktree is gone. The operator works in the
terminal, so nothing durable is written (1 in 416) and the identity is lost at
Finalize. The S3-era work widened *which* resolves persist but never addressed
that a resolve has to happen at all.

### Cause 2 — a live iterate renders a blank rail

Hide-empty hides `not_yet_created`. For a run in flight nothing is written yet, so
every artifact is hidden and the whole rail vanishes during exactly the phase the
operator would want to watch. Hide-empty was designed to mean *"this scenario has
no such artifact"*, not *"not yet"*.

### Cause 3 — `unregistered_worktree` erases the rail for every finished iterate

Probing the live server, all three sample sessions returned six `unavailable`
artifacts with the note *"This run's working copy is not a registered worktree of
this project."* Measured cause: `git worktree list` registers **zero** of the 20
pointers' `.worktrees/<slug>` paths (the directories linger after
`git worktree remove`, so they exist but are not registered). `resolver.ts` treats
non-membership as an integrity failure and returns the six-fold `unavailable` —
even though **all 20** of those runs have a `work_completed` record in the main
root and would resolve fully from there.

This gate also makes `chooseRoot`'s documented `!member` fallback DEAD CODE: the
resolver returns before it can ever run for a pointer that carries a worktree path.

## Approach

Three surgical changes, one per cause.

### FIX 1 — recover the run identity from the session's own transcript

Precedence becomes: validated pointer → persisted association → pipeline →
campaign → **transcript-recovered run id** → plain.

Ranked BELOW pipeline/campaign (not third, as first sketched) because the
transcript id is weaker evidence than a server-observed pointer: measured, a
campaign session quotes its sub-iterates' `Run-ID` footers, and ranking the
transcript above `campaign` would demote that session to `iterate`.

**Grammar (measured, not assumed).** Marker = `Run-ID:` + the canonical
`iterate-YYYY-MM-DD-slug` shape + **line-terminated**. Both narrower rules were
derived from real false positives:

- a loose id class matched `Run-ID: iterate-` and `Run-ID: security-` (template
  and non-iterate mentions) — a fabricated id that passes `isSafeRunId` and
  resolves to nothing;
- an id NOT at end-of-line matched the prose `→ decision_log.md (ADR via
  Run-ID: iterate-2026-06-14-repair-claude-json)` in a session that is not an
  iterate at all. The line-terminated rule rejects exactly that case and keeps
  every true one.

**Corroboration.** A recovered id is adopted only when the project's own records
back it: a `work_completed` row for it in `shipwright_events.jsonl`, or an
`iterates/<run_id>.json`. Measured effect: it rejects the 2 cross-repo run ids
quoted in webui sessions while keeping 29 of 31 recoveries. An unreadable event
log is NOT evidence.

**Window.** Scanned within a bounded 1 MB tail — measured: 512 KB recovers 42
sessions and misses 4 pointer-truth cases (the flagship one sits 526 KB from the
end); 1 MB recovers 50 and misses none; 2/4/8 MB add nothing. The larger tail is
read ONLY for a task with no association yet, so an identified task keeps today's
512 KB read.

**Persist.** A successful transcript resolve writes the association through the
SAME `setMissionContextOnce` + rollback path (no second write surface), so the
recovery costs one scan per task, not one per poll.

### FIX 2 — a live iterate shows its artifacts as pending

The server reports `runLive` (additive field): true only when the pointer
validated AND `chooseRoot` selected a registered, existing worktree — i.e. the run
is in flight. The client then keeps `not_yet_created` artifacts VISIBLE, inert,
worded plainly ("not written yet"). `not_applicable` stays hidden always;
`unavailable` stays visible and distinct (a read failure must never look like
"not yet").

### FIX 3 — fall back to the main root instead of erasing the rail

Delete the `unregistered_worktree` integrity return; let `chooseRoot` do what its
own contract already documents ("a `worktree_path` that is not a member is not an
error… the post-Finalize / pruned case is the common one"). No read ever happens
below an unregistered root — that is `chooseRoot`'s job and it is unchanged; the
run_id is grammar-validated; `pathGuard` + `realPathGuard` still gate every read.
The `invalid` pointer integrity path is untouched.

## Acceptance criteria

1. A session whose pointer was pruned and which has no association resolves its
   run from its own transcript, and the association is persisted once.
2. A transcript with NO canonical marker stays `plain` — never a guessed or
   partial run id.
3. A marker that is not line-terminated (a prose mention) is NOT adopted.
4. A recovered id with no corroborating record in this project is NOT adopted.
5. An `invalid` pointer keeps today's meaning: `unavailable`, no fallback.
6. A pointer naming an unregistered worktree resolves from the main root and
   renders its real artifacts.
7. A live iterate renders its not-yet-written artifacts as visible, inert,
   plain-worded pending entries; a finished one keeps hide-empty.
8. `unavailable` never renders as pending.

## Risk

- **Mis-attribution** — mitigated by the three-part rule (canonical grammar,
  line-terminated, corroborated) and measured at 0 disagreements against 18
  pointer ground-truth cases.
- **Reversing an external-review decision** (FIX 3 removes a gate an earlier
  openai HIGH asked for) — argued from measurement in the ADR.
- **Per-poll cost** — bounded: the larger read happens only for unassociated
  tasks, at a 10 s poll.

## Affected Boundaries

| Boundary | Producer | Consumer | Probe |
|---|---|---|---|
| `Run-ID:` commit footer inside `~/.claude/projects/**/<uuid>.jsonl` | shipwright F6 (out of process) | `run-id-recovery.ts` | real transcripts, 65 files |
| `task.missionContext` in `sdk-sessions.json` | `association.ts` | `sdk-sessions-validate.ts`, resolver | round-trip test (write → validate → read) |
| `MissionContext` wire shape | server `types.ts` | client `missionContextApi.ts` | `mission-context-types-sync.test.ts` |
| `shipwright_events.jsonl` | shipwright F5b | `iterate-record.ts` | real 478-line log |

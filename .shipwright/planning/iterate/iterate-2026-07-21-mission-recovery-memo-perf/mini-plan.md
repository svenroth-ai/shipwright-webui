# Mini-Plan — iterate-2026-07-21-mission-recovery-memo-perf

## Chosen approach

### A. Defer the scan into the decision table (AC1, AC2)

`detectScenario` is the *ordered* table; rule 5 is where the footer is consulted.
Pass the recovery as a **thunk** so the cost is paid at the point of use:

```ts
// scenario.ts
recoverTranscriptRunId?: (() => string | null) | null;   // called at MOST once, at rule 5
```

`ScenarioDecision` additionally reports **which** source produced `runId`:

```ts
runIdSource: "pointer" | "association" | "transcript" | null;
```

`resolver.ts` then derives the association from that single field instead of
re-deriving it from `pointer.status` + a separately-computed `transcriptRunId`.
The thunk is deliberately **not** guarded (reversing the plan review's gemini #4):
a memo would absorb a future double-call silently, so exactly-once is held by a
FAILING TEST instead — `recovery-schedule.test.ts` asserts the call COUNT, not
just the answer.

The rule → association mapping, enumerated (openai #5) and pinned by test:

| Winning rule | `runIdSource` | `associateRunId` | `associateSource` |
|---|---|---|---|
| 1 custom_actions | `null` | `null` | — (early return) |
| 2 pointer ok | `pointer` | the run id | `iterate_active_pointer` |
| 2b association | `association` | `null` | *(unused)* |
| 3 pipeline | `null` | `null` | — (early return) |
| 4 campaign | `null` | `null` | — (early return) |
| 5 transcript | `transcript` | the run id | `transcript_run_id` |
| 6 plain | `null` | `null` | — (early return) |

Row 2b is the one latent inconsistency this removes: today it reports
`associateSource: "transcript_run_id"` alongside a `null` `associateRunId`. The
route already ignores the source when the id is null, so nothing observable
moves — but the pair stops contradicting itself.

### B. Gate the wide reach-back on transcript REVISION (AC3, AC4, AC4a)

The 1 MB window exists to reach **backwards** into history. Anything written
later is appended at the END, inside the ordinary 512 KB tail. So the wide window
only needs re-reading when the transcript has actually changed since the last
wide reach-back. The invariant is CONDITIONAL — it fails only if more than the
ordinary tail is appended inside one poll interval, which is an in-flight session
and therefore pointer-identified (internal code review, LOW).

*(Revised after the external plan review. The first draft compared the last 256
characters of the tail; both providers rejected that as an unreliable change
detector, and gemini pointed out the reader already has the real signal.)*
`SessionWatcher.findByUuid` already returns `{path, sizeBytes, mtimeMs}` on every
call, so the reader returns a **revision** with the text it read:

```ts
readTranscriptTail: (uuid, maxBytes?) => Promise<{ text: string; revision: string }>
//   wire.ts: revision = `${loc.path}:${loc.sizeBytes}:${loc.mtimeMs}`, "" on any fault
```

`path` catches transcript replacement, `sizeBytes` catches the append, `mtimeMs`
catches an in-place rewrite. Gate, per task:

```
wide  ⟺  task is unidentified  AND  (never reached back  OR  lastRevision ≠ wideRevision)
```

ONE read per poll: the budget for poll *n* is chosen from the revision observed
at poll *n-1*, so a footer that arrives is picked up one poll (10 s) later. That
lag is the price of not doing a probe-then-read round trip, and it is stated in
AC4 rather than hidden.

- idle unidentified session → wide once, then 512 KB forever (the 412-task win);
- changing session → alternates wide/narrow;
- read fault → `revision: ""`, never recorded, so it cannot suppress recovery;
- a persist that fails and ROLLS BACK the association → the marker is deleted
  with it, or the task would be pinned to the ordinary tail while unidentified
  (internal code review, MEDIUM — this was a real bug in the first draft);
- an already-identified task → not recorded at all; it can never go wide, so an
  entry would be pure cap pressure (internal code review, LOW);
- process restart → the map is empty ⇒ one wide read per task. Intended.

The map is capped and cleared wholesale — but ONLY when a new key would overflow
it; clearing on every write would, at capacity, evict every other task on each
poll (external code review, openai MEDIUM). It holds a revision string and never
content (openai #7), and lives in the router closure so tests cannot leak into
each other.

**What this buys, precisely:** ~425 KB per poll of UTF-8 decode, allocation and
scanning. NOT I/O — `SessionWatcher.readChunk` reads the whole file and then
slices, so the budget bounds the slice (internal code review, MEDIUM). The
whole-file read is the bigger prize and is filed as triage
`mission-context-whole-file-transcript-read`.

### C. Complete the two records (AC7, AC8)

Amend the prior run's `adr.md` **and** its decision drop (the artifact that
becomes the released ADR) with the persistence half. Correct the `runLive` doc in
both `types.ts` (SoT) and `missionContextApi.ts` (mirror), net-zero lines in
`types.ts` — it sits at 297 LOC, one of the review's two watch items.

## Alternative considered — memoize the positive result

Finding 1 offered "memoize the result under the same fingerprint" as the
alternative to deferring. **Rejected.** It caches an answer nobody asked for: a
campaign session would still pay one full scan, and the memo would then have to
carry *two* meanings (no-marker, and marker-but-unused) with two eviction
stories. Deferring removes the work instead of remembering it, and it makes the
ordered table the single place that decides whether the footer matters at all.

## Alternative considered — gate the window on the scenario

Ask the resolver whether it reached rule 5 and narrow the window for scenarios
that never can. **Rejected on measurement:** 0 pipeline + 7 campaign tasks of
419. It would add a field to the internal contract to help ≤ 1.7 % of tasks,
while B covers all of them anyway once their transcript goes idle.

## Watch items (from the review)

`server/src/core/mission-context/types.ts` 297 LOC and
`server/src/test/mission-context-types-sync.test.ts` 300 LOC — neither may grow.
The sync test is comment-stripping, so doc-only edits need no test change. New
tests go in a **new** file rather than into `scenario.test.ts` (294) or
`run-id-recovery.test.ts` (292).

## Files

| File | Change |
|---|---|
| `core/mission-context/scenario.ts` | thunk input + `runIdSource` output |
| `core/mission-context/resolver.ts` | pass the thunk; derive associate from `runIdSource` |
| `core/mission-context/run-id-recovery.ts` | doc: the claim is now true, and why |
| `core/mission-context/types.ts` | doc: `runLive` terminal condition (net 0 lines) |
| `external/mission-context/routes.ts` | revision-gated reach-back + truthful comment |
| `external/mission-context/wire.ts` | supply the revision from the existing `findByUuid` |
| `external/mission-context/test-harness.ts` | multi-task, per-poll reads, cap seam |
| `client/src/lib/missionContextApi.ts` | doc: `runLive` mirror parity |
| `core/mission-context/recovery-schedule.test.ts` | NEW — AC1/AC2/AC5/AC6 |
| `external/mission-context/routes.recovery-schedule.test.ts` | NEW — AC3/AC4/AC4a (split out at 308 LOC) |
| `server/src/test/mission-runlive-doc-parity.test.ts` | NEW — AC8 |
| `client/e2e/flows/mission-recovery-schedule.spec.ts` | NEW — the rail survives repeated reads |
| `core/mission-context/scenario.test.ts` | mechanical: value → thunk |

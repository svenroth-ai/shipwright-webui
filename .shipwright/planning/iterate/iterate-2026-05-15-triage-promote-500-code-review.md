# Code Review — iterate-20260515-triage-promote-500

- **Mode:** external code review (openrouter: openai + gemini) over the
  finalized triage-only diff (`--mode code`), 2026-05-15.
- **Diff scope:** `triage.ts`, `triage.test.ts`, `triage-lock.ts`,
  `triage-lock.test.ts`, `triage.real-lock.test.ts`, `index.ts` (triage
  wiring only). The commingled ADR-104 `TaskCard` project-pill changes
  are a separate iterate — excluded.

## Findings triage

### #1 — OpenAI MEDIUM (bug) — FIXED

A `finally { await releaseTriage(); }` that throws overrides the route's
already-determined `return` — a failed proper-lockfile unlock (lock dir
removed externally, perms changed) would turn a successful 201/200 or a
deliberate 503 into an opaque 500. Pre-existing shape, but the iterate
owns this code. Fixed: `releaseQuietly()` helper wraps the unlock in its
own try/catch, logs + swallows the failure. Applied to both `finally`
blocks (promote + statusFlipRoute).

### Gemini (garbled, but a real gap) — FIXED

Gemini's response gestured at: if a prior promote attempt created the
task in memory but its `persist()` failed (now an `ELOCKED → 503`), the
task is off-disk; the idempotent-recovery branch reused it WITHOUT
re-persisting, so a server restart loses the task. Fixed: the recovered
branch now also `await deps.store.persist()` — idempotent, so a re-run
on an already-persisted task is a harmless rewrite, and a prior failed
persist is healed on retry.

### #2 — OpenAI MEDIUM (test) — FIXED

The real-lock suite covered AC4 for a held triage `.weblock` but not the
other AC4 branch — contention on the `sdk-sessions.json` persist lock.
Added a real-lock test that holds a genuine `proper-lockfile` lock on
`sdk-sessions.json` and asserts `/promote` → 503 (proves the work-body
`ELOCKED` catch around `store.persist()`).

### #3 — OpenAI LOW (test) — PARTIALLY ADDRESSED

The real-lock suite did not re-run every FR-01.30 behavioral AC (AC6)
under real locks. Added the lock-relevant one — **idempotent retry**
(promote same item twice → 201 recovered, same task, no duplicate). The
remaining FR-01.30 ACs (partial-promote 207, concurrent 409, 400/404
validation) are lock-implementation-agnostic — pure route logic — and
stay covered by the 23-test mock-lock suite (`triage.test.ts`); the
real-lock harness's job is the lock-interaction proof, which idempotent
retry exercises.

## Gemini

Response returned truncated/garbled (mid-analysis, no structured
findings). The persist-on-recover gap was salvaged from it; OpenAI's
structured review carried the rest.

## Outcome

ship — 3 findings fixed (1 bug, 2 test gaps), 1 partially addressed with
justification. Triage suites green post-fix: 23 mock-lock + 5 real-lock
+ 2 lock-factory = 30; full server suite 1028/1028.

# Mini-Plan: triage-promote-500

- **Run ID:** iterate-20260515-triage-promote-500
- **Spec:** `2026-05-15-triage-promote-500.md`

## Approach (chosen)

Three coordinated changes, smallest blast radius first:

### Change 1 — RC1: non-colliding lockfile path (new `server/src/core/triage-lock.ts`)

Per external review (OpenAI #1 / Gemini #3): make the non-colliding
lock a **tested contract**, not a one-off wiring lambda. New module
`server/src/core/triage-lock.ts` exports `createTriageLock()`:

```ts
export function createTriageLock(): (p: string) => Promise<() => Promise<void>> {
  return (p) => lockfile.lock(p, { retries: 3, lockfilePath: `${p}.weblock` });
}
```

`proper-lockfile` then coordinates via a `<file>.weblock` directory;
Python's `_FileLock` keeps its `<file>.lock` regular file. No collision
in either direction. Probe C proved acquisition succeeds with the
sidecar present. `index.ts` wires `lock: createTriageLock()`. The
global `lockPath` helper (projects.json, settings.json,
sdk-sessions.json's own persist) is untouched — verified: the triage
routes are the only Node-side writer of `triage.jsonl`
(`triage-write.ts:appendStatusEvent`, called only from `triage.ts`).

### Change 2 — RC2: drop the redundant outer sdk-sessions lock (`server/src/routes/triage.ts`)

Remove the `deps.lock(deps.sessionsLockPath)` acquire/release around the
create-or-recover block in the promote route. Rationale:
- `store.persist()` already locks `sdk-sessions.json` for the
  cross-process file write — the outer lock only duplicated it and,
  being non-reentrant, self-deadlocked.
- The `findByPromotedFromTriageId` re-check + `store.create()` are
  synchronous (no `await` between them and `persist()`), so within the
  single-process webui event loop they are atomic by construction.
- Same-project promotes are already serialized by the `triage.jsonl`
  `.weblock` lock (every promote in a project locks the same file).
  Cross-project promotes mutate disjoint `sessions` Map entries.
- The idempotency re-check (`findByPromotedFromTriageId`) is **kept** —
  it is the load-bearing duplicate-create guard; only the redundant
  lock around it is removed.

Remove the now-unused `sessionsLockPath` field from `TriageRoutesDeps`
and its wiring in `index.ts` (no dead code).

### Change 3 — RC3: graceful lock-failure handling (`server/src/routes/triage.ts`)

Wrap the **whole transaction body** (not just lock acquisition) of
promote + `statusFlipRoute` in try/catch/finally, and **classify** the
error (external review OpenAI #3/#5/#6, Gemini #1/#2):

- `catch`: only `proper-lockfile` **`ELOCKED`** contention →
  `503 { error: "lock_unavailable", message: "A write lock is held by
  another operation; please retry." }`. The message is generic — no
  path / raw-error detail (OpenAI #9); details go to `console.warn`
  server-side only. Any **other** error (`EACCES`, `ENOSPC`,
  `realpath` `ENOENT`, …) is **re-thrown** → Hono 500 + logged — real
  storage failures must not be masked as contention (OpenAI #3,
  Gemini #1).
- Wrapping the whole body (not just `deps.lock()`) means an `ELOCKED`
  from `store.persist()`'s own `sdk-sessions.json` lock also yields
  503, satisfying AC4 (OpenAI #6).
- `finally`: lock release runs in its **own** nested try/catch — a
  release failure is logged, never overrides an already-decided
  response (OpenAI #5, Gemini #2 — no permanently-leaked lock, no
  "write succeeded but client saw 500").

Add an early `existed` short-circuit (`resolveTriagePath` already
returns `existed`): when `triage.jsonl` does not exist, return
`404 triage_item_not_found` before locking — correct semantics (no
items can exist) and avoids a `realpath` ENOENT throw. The TOCTOU
window (file lazily created mid-request) is negligible and retryable;
a legit promote always follows a GET that already listed items, so
`existed` is true in the real flow (OpenAI #4 — considered, accepted).

Applies to all three lock sites: promote (triage lock) + dismiss/snooze
(`statusFlipRoute` triage lock).

## Files

| File | Change |
|---|---|
| `server/src/core/triage-lock.ts` | **new** — `createTriageLock()` collision-safe lock factory (`.weblock` lockfilePath) |
| `server/src/core/triage-lock.test.ts` | **new** — asserts the factory acquires with a regular-file `.lock` sidecar present + uses a `.weblock` dir |
| `server/src/index.ts` | triage routes wired with `lock: createTriageLock()`; drop `sessionsLockPath` from the deps object |
| `server/src/routes/triage.ts` | remove outer sdk-sessions lock; remove `sessionsLockPath` from `TriageRoutesDeps`; whole-body try/catch/finally with `ELOCKED`→503 classification on promote + statusFlipRoute; `existed`→404 guard |
| `server/src/routes/triage.test.ts` | drop `sessionsLockPath` from harness; add tests: lock throws `ELOCKED`→503, lock throws non-lock error→500 (re-throw), missing-file→404; keep existing 11 promote/dismiss/snooze tests green |
| `server/src/routes/triage.real-lock.test.ts` | **new** — F0.5 surface verification: real `proper-lockfile` end-to-end through the Hono route — sidecar present (RC1), shared real lock for store+route (RC2), concurrent same-id promote, stale-`.lock`+held-`.weblock`→503 coexistence, dismiss/snooze success |
| `.shipwright/planning/01-adopted/spec.md` | FR-01.30 row description + 2 new `(E)` ACs (F1/Step 2) |

## Work breakdown

1. Branch `iterate/triage-promote-500` from `main`.
2. RED — add failing tests (`triage.test.ts` 503/404 cases +
   `triage.real-lock.test.ts` sidecar + shared-lock cases). Confirm
   they fail (500 / deadlock-timeout) pre-fix.
3. GREEN — Change 2 + Change 3 in `triage.ts`, Change 1 in `index.ts`.
4. Run `npx vitest run` + `npx tsc --noEmit` (server).
5. Self-review (7-point) + confidence calibration.
6. Code-reviewer subagent pass + external code review of the diff.
7. F0.5 surface verification.
8. Finalization F0–F12 (FR-01.30 spec update, ADR-104, changelog).

## Test strategy

- **Unit (`triage.test.ts`, in-process lock mock):** existing 11 cases
  unchanged + new — `deps.lock` throws → 503; missing `triage.jsonl` →
  404. The in-process mock keeps concurrency-assertion tests
  deterministic.
- **Integration (`triage.real-lock.test.ts`, real `proper-lockfile`):**
  the RC1/RC2 regression guard. Without Change 1 the sidecar case is
  500; without Change 2 the shared-lock case deadlocks (vitest
  timeout). With the fix: 201/200. Also asserts a pre-held `.weblock`
  lock yields 503.
- **Full suite:** `npx vitest run` (server) green; `tsc --noEmit` clean.

## Alternative considered (rejected)

**Keep the outer sdk-sessions lock; make it non-colliding** by giving
the triage routes' lock a `.weblock` suffix for sdk-sessions.json too.
This removes the self-deadlock (route locks `sdk-sessions.json.weblock`,
`persist()` locks `sdk-sessions.json.lock` — different dirs) without
deleting code.
**Rejected:** the outer lock would then mutually-exclude *only* other
triage-route promotes, not `external/routes.ts` writes to the same
file — a misleading lock that implies cross-writer protection it does
not provide. Removing it (Change 2) is honest: `store.persist()`'s own
lock is the real file-write guard, and the in-process synchronous
re-check is the real idempotency guard. Less code, no false signal.

**Also rejected:** porting Python's `_FileLock` byte-lock primitive to
Node so the two genuinely compose. No portable `fcntl`/`msvcrt`
equivalent in Node; large surface; the documented mitigation
(line-atomic appends + last-status-wins) already makes true mutual
exclusion unnecessary for correctness.

## External Review Integration (Branch A — OpenRouter, 2026-05-15)

15 findings (2 HIGH, 6 MEDIUM, 7 LOW). No finding required a scope
change or user decision; all integrated into the plan above:

| Finding | Sev | Resolution |
|---|---|---|
| OpenAI#2 — removing outer lock must not weaken idempotency | HIGH | `findByPromotedFromTriageId` re-check KEPT; `store.create()` confirmed 100% synchronous (no await before `sessions.set`); same-id promotes serialized by the triage `.weblock` lock. New real-lock concurrent-same-id test added. |
| Gemini#2 — lock must release in `finally` even on persist throw | HIGH | Whole-body try/**finally**; release in its own nested try/catch (logs, never overrides response). |
| OpenAI#1, Gemini#3 — `.weblock` must be a contract, not one wiring site | MED | New tested module `triage-lock.ts`; verified triage routes are the only Node writer of `triage.jsonl`. |
| OpenAI#3, Gemini#1 — don't mask non-lock FS errors as 503 | MED | `catch` classifies: only `ELOCKED`→503; everything else re-thrown→500+log. Test for a non-lock error→500. |
| OpenAI#6 — `store.persist()` ELOCKED could still 500 | MED | Whole-body wrap (not just `deps.lock()`) → persist ELOCKED also →503. Real-lock test pre-locks `sdk-sessions.json`. |
| OpenAI#4 — `existed`→404 vs lazy concurrent file creation | MED | Accepted: a legit promote always follows a GET that listed items; TOCTOU window negligible + retryable. Noted in ADR. |
| OpenAI#5 — release exception after mutation → false 500 | MED | Release wrapped in own try/catch inside `finally`. |
| OpenAI#10 — re-verify dismiss/snooze under real lock | MED | Real-lock test covers dismiss + snooze success; in-process-mock tests keep 400/404 (validation is pre-lock, primitive-independent). |
| OpenAI#7, Gemini#5 — test artifact cleanup | LOW | Real-lock test `afterEach` force-removes the temp dir incl. `.lock`/`.weblock`. |
| OpenAI#8 — coexistence: stale `.lock` + held `.weblock` | LOW | Real-lock test asserts that combination →503 (web lock wins). |
| OpenAI#9 — no path/raw-error leakage in 503 body | LOW | 503 body is fixed/generic; detail only `console.warn`. |
| Gemini#4 — confirm `store.create()` fully synchronous | LOW | Confirmed by reading `sdk-sessions-store.ts` (`randomUUID()` sync, ends `sessions.set`). |

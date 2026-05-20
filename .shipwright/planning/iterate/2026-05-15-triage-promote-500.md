# Iterate Spec: triage-promote-500

- **Run ID:** iterate-20260515-triage-promote-500
- **Type:** bug
- **Complexity:** medium
- **Status:** draft

## Goal

`POST /api/triage/:projectId/promote` (and `dismiss` / `snooze`) return
`500 Internal server error` on any project the shipwright Python producer
hooks have written to. Fix the lock-coordination so the Triage tab's
write actions work, and so genuine lock contention fails as a clean
error instead of a 500.

## Root Causes (empirically reproduced — see Confidence Calibration)

- **RC1 — lock-primitive collision.** The webui locks `triage.jsonl`
  with `proper-lockfile`, which creates a **directory** at
  `triage.jsonl.lock`. The shipwright Python producer hooks
  (compliance / Phase-Quality / drift) write triage events via their
  own `_FileLock`, which leaves a **regular file** at the same path.
  `proper-lockfile.lock()` → `mkdir` `EEXIST` → cannot `rmdir` a
  regular file → throws `ELOCKED`. The throw is at
  `await deps.lock(pathRes.absolute)` (`triage.ts:195` / `:361`),
  outside any try/catch → Hono `onError` → 500. The Python sidecar
  file persists on disk, so the collision is permanent (not a race).
- **RC2 — non-reentrant self-deadlock.** The promote route holds
  `lock(sdk-sessions.json)` (`triage.ts:232`), then calls
  `store.persist()`, which re-acquires the **same** lock via the
  store's own lock dep. `proper-lockfile` is not re-entrant → inner
  lock throws `ELOCKED` → 500. Latent today (RC1 throws first);
  surfaces the instant RC1 is fixed.
- **RC3 — no graceful lock-failure path.** Every `deps.lock()` call in
  `triage.ts` is outside try/catch, so any lock failure degrades to an
  opaque 500 instead of an actionable response.

## Acceptance Criteria

- [ ] AC1: `POST /promote` succeeds (201) on a project that has a
      Python `_FileLock` regular-file sidecar `triage.jsonl.lock`
      present on disk.
- [ ] AC2: `POST /promote` completes its full transaction
      (`store.create` + `store.persist` + triage status flip → 201)
      when the route and `SdkSessionsStore` share the production
      `proper-lockfile` lock implementation — no self-deadlock.
- [ ] AC3: `POST /dismiss` and `POST /snooze` succeed (200) with the
      Python sidecar present.
- [ ] AC4: When a write lock genuinely cannot be acquired (triage
      `.weblock` OR `sdk-sessions.json` persist lock — `ELOCKED`),
      promote/dismiss/snooze return `503 { error: "lock_unavailable" }`
      with a generic retry-oriented message (no path detail) — never
      500. A non-lock filesystem error still surfaces as 500 (logged),
      not misclassified as contention.
- [ ] AC5: webui's lock file no longer collides with Python's
      `triage.jsonl.lock`; Python's lock no longer breaks webui.
- [ ] AC6: All existing FR-01.30 behavioral ACs (idempotent retry 201,
      partial-promote 207, concurrent-promote 409, 400/404 validation)
      still hold.

## Affected FRs

- **FR-01.30** (Triage Tab + Promote bridge): no behavioral AC change.
  The FR-row *implementation description* is updated — the promote
  transaction no longer acquires a separate `sdk-sessions.json` lock,
  and the "Cross-process lock note" Known Limitation is resolved
  (distinct lockfile paths). Two new `(E)` ACs added for the
  sidecar-coexistence + 503-on-contention guarantees.

## Out of Scope

- Changing the `triage.jsonl` or `sdk-sessions.json` on-disk wire
  formats — untouched.
- Changing the global `lockPath` helper used by projects.json /
  settings.json / sdk-sessions.json's own writes — only the triage
  routes' lock wiring changes.
- Making webui and Python mutually exclude each other's writes — they
  never did (documented "don't compose"); the mitigation
  (append-mode line-atomicity + last-status-wins) stays in force.
- Deleting the stale Python sidecar files on disk — they are Python's
  artifacts; Python re-creates them.
- The pre-existing two-webui-process-sharing-sdk-sessions.json
  limitation (no cross-process store reload) — unchanged.

## Design Notes

n/a — no UI change. Server-route + wiring only.

## Affected Boundaries

n/a — no serialized data format changes. The fix changes lock-file
*paths* (proper-lockfile coordination directories), not any on-disk
data schema. `triage.jsonl` and `sdk-sessions.json` wire formats are
untouched, so there is no producer/consumer round-trip to probe. The
relevant cross-process surface is the lock *primitive* mismatch, which
is covered directly by the RC1/RC2 reproduction probes below.

## Confidence Calibration

- **Boundaries touched:** none (see "Affected Boundaries"). The lock
  primitive is the cross-process surface; probed directly below.
- **Empirical probes run (pre-build):**
  - Probe A — `proper-lockfile.lock(target, {retries:3})` with a
    0-byte regular-file `target.lock` sidecar present (stale-backdated):
    **threw `ELOCKED`**. Confirms RC1.
  - Probe B — `proper-lockfile.lock(target)` called twice for the same
    path in one process (re-entrant): second call **threw `ELOCKED`**.
    Confirms RC2 (non-reentrant).
  - Probe C — `proper-lockfile.lock(target, {lockfilePath:
    target+'.weblock'})` with the regular-file sidecar still present:
    **lock ACQUIRED**. Confirms the RC1 fix direction.
  - On-disk evidence — `.shipwright/triage.jsonl.lock` is a live 0-byte
    **regular file** (Python `_FileLock` artifact), confirming the
    collision is active on this very project right now.
- **Edge cases NOT probed yet (to run during build):**
  - missing `triage.jsonl` → lock target `realpath` ENOENT path;
  - the four FR-01.30 behavioral ACs (idempotent 207/201, 409, 400/404)
    re-run under the real-lock harness to confirm no regression.
- **Confidence-pattern check:** no "are you confident?" yes-then-bug
  pattern has fired in this run; diagnosis was driven by reproduction,
  not assertion. If one fires during build, run one more probe before F0.

## Verification (medium+)

- **Surface:** api
- **Runner command:** `npx vitest run server/src/routes/triage.real-lock.test.ts`
  — an integration test that drives the real Hono triage route with the
  **production** `proper-lockfile` lock implementation (`.weblock`
  helper) and a real `SdkSessionsStore` whose persist lock is the real
  `proper-lockfile`, against a temp project that has a regular-file
  `triage.jsonl.lock` sidecar. Asserts promote/dismiss/snooze return
  201/200 (not 500), and that a held lock yields 503.
- **Evidence path:** `.shipwright/runs/iterate-20260515-triage-promote-500/surface_verification.json`
  + the vitest run log.
- **Justification (surface=none):** n/a — the api surface is the
  promote endpoint and is verifiable end-to-end with the real lock
  primitive in-process via Hono `app.request`.

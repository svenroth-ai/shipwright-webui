# Mini-Plan: fix-pty-reused-prewarm-race

- **Run ID:** iterate-2026-05-27-fix-pty-reused-prewarm-race
- **Spec:** `2026-05-27-fix-pty-reused-prewarm-race.md`
- **Branch:** `iterate/fix-pty-reused-prewarm-race` (worktree
  `.worktrees/fix-pty-reused-prewarm-race`, base `origin/main` @
  `d626596`)

## Files to add / change

| File | Change | LOC est. |
|---|---|---|
| `server/src/terminal/pty-manager.ts` | Add `hadWriterAttach` field to `PtyEntry`; init `false` in `spawn()`; flip to `true` in `attach()` writer branches + `detach()` promote branch; add public `hasHadWriterAttach()` | ~15 |
| `server/src/terminal/routes.ts` | Capture `hadPriorWriter` before `attach()`; replace `ptyReused: ptyExistedBeforeAttach` with `ptyReused: hadPriorWriter`; update comment | ~10 |
| `server/src/terminal/pty-manager.test.ts` | RED tests for the 5 `hasHadWriterAttach` transitions | ~50 |
| `server/src/terminal/pty-replay-attach-detach.test.ts` OR a new `prewarm-race-regression.test.ts` | RED routes-level test: prewarm-then-WS emits `ptyReused:false`; reload-WS emits `ptyReused:true` | ~40 |
| `client/e2e/flows/fix-pty-reused-prewarm-race-smoke.spec.ts` | NEW Playwright spec: click Launch IMMEDIATELY, assert data-frame ≤ 5 s | ~100 |

NO change to `client/src/components/terminal/useAutoLaunch.ts` — the
guard arming logic is correct as-is; we're only fixing the signal
upstream.

## Test strategy (RED → GREEN)

1. **Unit RED:** write `hasHadWriterAttach` tests FIRST — they fail
   because the method doesn't exist (TS compile error). Then add
   field + method → GREEN.
2. **Routes RED:** write a test that exercises the prewarm-then-WS
   sequence — currently emits `ptyReused:true` (BUG). After the
   routes.ts change → emits `ptyReused:false` (FIXED).
3. **E2E RED:** the new spec clicks Launch IMMEDIATELY. Before fix:
   manual-send park dialog renders (no `claude --session-id`
   data-frame in the WS within 5 s) → RED. After fix: data-frame
   fires → GREEN.

## Approach

Sequence in `routes.ts` becomes:

```ts
const ptyExistedBeforeAttach = ptyManager.get(taskId) !== undefined;  // ADR-104 (terminalReset) — UNCHANGED
const hadPriorWriter = ptyManager.hasHadWriterAttach(taskId);          // NEW — ptyReused source
const meta = ptyManager.spawn(taskId, { ... });
// ...
const terminalReset = deriveTerminalReset(ptyExistedBeforeAttach, task.firstJsonlObservedAt);
// onOpen:
const { role } = ptyManager.attach(taskId, connToken);  // sets hadWriterAttach=true when writer
// ready envelope:
ptyReused: hadPriorWriter,
```

The `hadPriorWriter` is captured PRE-attach so its value reflects
"was there a writer here BEFORE this attach". The `attach()` call
that follows will set the flag for the NEXT attach to see.

## Regression matrix

| Scenario | Before | After | Guard armed? |
|---|---|---|---|
| Prewarm-only → first WS attach | `ptyReused:true` (BUG) | `ptyReused:false` (FIX) | NO ✓ |
| WS attach (no prewarm) | `ptyReused:false` | `ptyReused:false` | NO ✓ |
| Reload (same task) | `ptyReused:true` | `ptyReused:true` | YES ✓ |
| Multi-tab (Tab B sees Tab A writer) | `ptyReused:true` | `ptyReused:true` | YES ✓ |
| StrictMode dev double-mount | `ptyReused:true` (papercut) | `ptyReused:true` (papercut unchanged — separate root cause) | YES |
| Server restart → fresh attach | `ptyReused:false` (no entry) | `ptyReused:false` (fresh entry, hadWriterAttach=false) | NO ✓ |

## Risks + mitigations

- **R1: The `hasHadWriterAttach` flag is in-memory only.** Acceptable
  — when the server restarts, the pty itself dies too. A
  post-restart attach correctly sees a fresh entry with
  hadWriterAttach=false. No persistence needed.
- **R2: Subtle race if `attach()` runs concurrently with
  `hasHadWriterAttach()` from a different WS upgrade.** Node is
  single-threaded; the JS event loop serializes both. The
  pre-attach read + the in-attach write happen on the same task
  in the same synchronous tick (routes.ts wraps both in the same
  WSContext setup). No race window.
- **R3: Existing tests assert on `ptyReused` semantics with the
  old definition.** Mitigation: grep for `ptyReused` in the test
  suite; update fixtures + assertions. The most likely affected
  test is `terminal-reset.test.ts` (touched the same field for
  ADR-104). Run the full server vitest after the routes change to
  catch any drift.

## Done-when

1. Unit + routes tests GREEN (all 5 hasHadWriterAttach transitions
   + the prewarm-race regression).
2. F0.5 E2E spec GREEN (Launch IMMEDIATELY → data-frame ≤ 5 s).
3. Full server vitest GREEN (~1080 tests, no regressions).
4. `tsc --noEmit` clean on both server + client.
5. Self-Review + Confidence Calibration sections of the iterate
   spec filled in with empirical findings.
6. F0..F12 finalize completes; PR opens for review.

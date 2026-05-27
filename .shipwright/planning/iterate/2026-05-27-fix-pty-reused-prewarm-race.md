# Iterate Spec: fix-pty-reused-prewarm-race

- **Run ID:** iterate-2026-05-27-fix-pty-reused-prewarm-race
- **Type:** bug (production-code fix for a UX papercut)
- **Complexity:** medium (touches `ptyReused` semantics — io-boundary-adjacent)
- **Status:** draft

## Goal

Fix the **prewarm-race** that surfaced empirically during PR #73's E2E
authorship: when `prewarmPty` (POST `/api/terminal/<id>/spawn`) wins
the race against the WS upgrade, the WS upgrade sees a pre-existing
`PtyEntry` → emits `ready{ptyReused: true}` → `useAutoLaunch` arms
the one-shot guard → Launch parks behind a manual-send confirm
**instead of auto-executing**.

This affects real users on slow networks / slow disk who click
Launch immediately after navigating to `/tasks/<id>`. The C5 E2E
spec works around it by waiting for the first ready envelope BEFORE
clicking — but a Test workaround is the wrong place for a production
fix.

## Acceptance Criteria

- [ ] (E) `PtyEntry` gains a `hadWriterAttach: boolean` field
      (server/src/terminal/pty-manager.ts), initialised `false` in
      `spawn()`.
- [ ] (E) `PtyManager.attach()` sets `entry.hadWriterAttach = true`
      whenever `role === "writer"` (first writer attach OR same-conn
      re-attach).
- [ ] (E) `PtyManager.detach()` sets `entry.hadWriterAttach = true`
      on reader-promotion-to-writer (defensive — should already be
      true, but explicit).
- [ ] (E) `PtyManager.attach()` signature widens to return
      `{ role: "writer"|"reader", hadPriorWriter: boolean }` where
      `hadPriorWriter` is the value of `hadWriterAttach` AT THE START
      of `attach()` (before the mutation). This is the atomic read +
      write external review flagged as HIGH: a separate
      `hasHadWriterAttach()` public method would race against
      concurrent `attach()` calls (gemini HIGH + openai #2 HIGH).
- [ ] (E) `server/src/terminal/routes.ts` WS upgrade reads
      `hadPriorWriter` from the `attach()` return value and emits
      `ready{ptyReused: hadPriorWriter}` instead of
      `ready{ptyReused: ptyExistedBeforeAttach}`.
      `ptyExistedBeforeAttach` is RETAINED for `terminalReset`
      derivation (ADR-104 unchanged) but no longer feeds
      `ptyReused`.
- [ ] (E) RED→GREEN unit tests in
      `server/src/terminal/pty-manager.test.ts`:
  - First `attach()` returns `{role:"writer", hadPriorWriter:false}`
    immediately after `spawn()`.
  - Second `attach()` (different conn) returns
    `{role:"reader", hadPriorWriter:true}` while a writer is bound.
  - Re-attach by the SAME conn returns
    `{role:"writer", hadPriorWriter:true}`.
  - After the writer detaches, the next NEW `attach()` returns
    `{role:"writer", hadPriorWriter:true}` (the regression-fence
    "reload sees ptyReused:true").
  - Reader-promotion-to-writer (writer detaches, reader gets
    promoted via `onPromoteToWriter`): the reader's PRIOR
    `attach()` return already had `hadPriorWriter:true` — covered
    by the second case above; an additional test verifies the
    flag is non-decreasing across promotion (openai #3 medium).
  - **Race fence (openai #2 + gemini HIGH):** TWO near-simultaneous
    `attach()` calls — second sees `hadPriorWriter:true` even
    when both arrive before any other observation, because the
    atomic-API resolves them in sequence rather than reading-then-
    mutating across an event loop tick.
- [ ] (E) RED→GREEN regression test in
      `server/src/terminal/routes.test.ts` (or
      `pty-replay-attach-detach.test.ts`): a WS upgrade that follows
      a prewarm-only `/spawn` POST emits `ready{ptyReused: false}`
      (NOT true). A subsequent reload WS emits `ready{ptyReused: true}`.
- [ ] (E) F0.5 end-to-end: add a NEW Playwright spec
      `client/e2e/flows/fix-pty-reused-prewarm-race-smoke.spec.ts`
      that clicks Launch IMMEDIATELY (no wait-for-first-ready) and
      asserts the auto-execute data-frame fires within 5 s. This
      proves the fix from a user's perspective.
- [ ] (E) Existing server vitest suite still GREEN
      (~1080 tests; specifically `pty-manager.test.ts` +
      `pty-replay-attach-detach.test.ts` regressions).
- [ ] (E) `tsc --noEmit` clean on server.

## Spec Impact

- **Classification:** modify (ADR-068-A1 semantic clarification)
- **Affected FRs:** none directly; the `ptyReused` field semantics
  inside ADR-068-A1 are refined but no FR row in `spec.md` mentions
  the field. The change is an ADR-level semantic correction.
- **Justification:** No FR table row references `ptyReused` directly.
  CLAUDE.md rule 19 (ADR-068-A1 amendment) is the closest
  user-facing contract; it will be updated in this iterate's ADR
  decision-drop to clarify the refined `ptyReused` semantics.

## Out of Scope

- The dev-only StrictMode WS-double-mount issue (memory
  `strictmode_aborts_first_ws_in_e2e`). This iterate fixes the
  prewarm-race; dev-mode StrictMode is a separate root cause.
- Removing the `wait-for-first-ready-before-click` workaround
  from `C5-embedded-terminal-split-smoke.spec.ts` — the C5 spec
  is on a different branch (PR #73). Once both merge, a tiny
  follow-up can remove that wait; for now, both behaviors coexist
  safely (waiting for ready never HURTS).
- Any change to `terminalReset` semantics (ADR-104).
- Any change to the auto-launch coordinator / one-shot guard logic
  in `useAutoLaunch.ts` (the guard is correct; it was the SIGNAL
  that was wrong).

## Affected Boundaries

| Producer | Consumer | Format |
|---|---|---|
| `server/src/terminal/routes.ts` (ready envelope emit) | `client/src/hooks/useTerminalSocket.ts` (`JSON.parse` on receive) → `client/src/components/terminal/useAutoLaunch.ts` (one-shot guard arming logic on `socket.ptyReused`) | JSON WS envelope `ready{... ptyReused: boolean ...}` |

`touches_io_boundary` = **YES**. The wire FIELD SHAPE is unchanged
(`ptyReused: boolean` stays a boolean on the `ready` envelope), but
the FIELD SEMANTICS shifts. Boundary Probe coverage:

- `client/src/components/terminal/__ws_frame_roundtrip.test.ts`
  (already merged in C5) — round-trips the `ready` envelope. The
  field is present in fixtures; semantic shift doesn't break the
  round-trip.
- `client/src/components/terminal/useAutoLaunch.ts` lines 97-104:
  guard arms iff `socket.ptyReused === true`. Under the new
  semantics this fires correctly for the documented cases (reload,
  multi-tab) and no longer mis-fires on prewarm-only ptys.

## Verification (F0.5)

- **Surface:** `web` — mandatory (the fix changes user-visible UX).
- **Runner command** (same isolated stack contract as PR #73):
  ```bash
  cd server && npm run build
  cd ../client && npm run build
  # In a separate shell:
  USERPROFILE=$tmp HOME=$tmp SHIPWRIGHT_NETWORK_PROFILE=local PORT=4847 \
    node server/dist/index.js

  BASE_URL=http://127.0.0.1:4847 \
    ./client/node_modules/.bin/playwright test \
      --config=client/playwright.config.ts \
      client/e2e/flows/fix-pty-reused-prewarm-race-smoke.spec.ts
  ```
- **Evidence path:** `client/playwright-report/` + the per-run
  `.shipwright/runs/<run_id>/surface_verification.json`.

## Confidence Calibration

- **Boundaries touched:** `ready{ptyReused}` semantics (see above).
- **Empirical probes run (planned):**
  1. Unit RED → GREEN: `hasHadWriterAttach` test family for all
     transitions (5 cases).
  2. Routes-level RED → GREEN: prewarm-then-WS-attach emits
     `ptyReused:false`; subsequent reload emits `ptyReused:true`.
  3. F0.5 web GREEN: new E2E spec clicks Launch IMMEDIATELY,
     observes auto-execute data-frame ≤ 5 s.
  4. Regression: full server vitest GREEN.
- **Edge cases NOT probed + why acceptable:**
  - **Dev-mode StrictMode double-mount.** Separate root cause;
    documented in CLAUDE.md and out-of-scope.
  - **Multi-tab race** (Tab A writer + Tab B reader). Behavior
    unchanged: Tab B sees `ptyReused:true` because Tab A's writer
    attach already set the flag. Existing tests cover this.
  - **Server-restart resilience.** Even though `hadWriterAttach`
    is in-memory only and doesn't survive a server restart, the
    pty itself doesn't survive either — so a post-restart attach
    spawns a fresh pty with hadWriterAttach=false (correct: the
    "prior writer" history is gone).
- **Confidence-pattern check:** External review fired a strong
  HIGH-severity warning on the original non-atomic API design
  (separate `hasHadWriterAttach()` public method racing against
  `attach()`). Adopted the atomic-return contract before any
  code landed; the dedicated race-fence test (test #6) locks
  the invariant down. No "are you confident?-yes-then-bug"
  pattern fired during the run.

## Empirical findings

- **Race fence locked.** The race-fence test (two back-to-back
  `attach()` calls) passes because the read-and-mutate happens
  in a single synchronous JS tick. Documented as "Node's
  single-threaded event loop guarantees no inter-step
  interleaving" in the test comment so a future maintainer
  knows why the test is sufficient.
- **`terminalReset` separation holds.** Existing
  `terminal-reset.test.ts` (6 tests) all pass — the ADR-104
  signal still uses `ptyExistedBeforeAttach`. The two booleans
  do different things and shouldn't be re-conflated.
- **Reader-promotion latch is defensive but proven.** The
  reader-promote-then-third-attach test confirms the latch
  is non-decreasing across promotion. Without this test, a
  future refactor that NULLed the writer slot inside the
  promote branch could regress.

## Self-Review (7-point)

1. **Scope match:** All ACs delivered. Atomic `attach()` API
   (driven by external-review HIGH) lands cleanly; routes.ts
   replaces `ptyReused: ptyExistedBeforeAttach` with
   `ptyReused: hadPriorWriter`. `terminalReset` semantic unchanged
   (still uses `ptyExistedBeforeAttach`).
2. **Test coverage:** 6 new RED→GREEN unit tests for the
   transitions (prewarm, multi-tab, re-attach, post-detach
   reload, reader-promotion, race-fence). 1 new F0.5 E2E spec.
   Full server vitest 1255/1255 GREEN; regression sweep 18/18.
3. **Side effects:** None unexpected. The change is server-internal
   semantics; wire shape unchanged. Client `useAutoLaunch.ts`
   needs no edit — it reads the same field name.
4. **Architecture:** No new write surface. `PtyEntry` gains one
   `boolean` field. Public API change: `attach()` returns one
   more field — only 1 caller in `routes.ts` + tests.
5. **Code quality:** Comments tie field semantics to ADR-068-A1 +
   the iterate run-id; explicit "distinct from
   ptyExistedBeforeAttach" note prevents future re-conflation
   (openai #10 medium). Latched-true invariant documented.
6. **Compliance:** `spec_impact = modify` — refines ADR-068-A1
   semantics. The relevant CLAUDE.md rule 19 will be re-stated
   in the ADR decision-drop with the new `ptyReused` semantics.
   No FR table row references the field directly; no FR rows
   need editing.
7. **Affected Boundaries:** WS envelope `ready.ptyReused` —
   wire-shape unchanged, semantic shift. Existing Boundary
   Probe `__ws_frame_roundtrip.test.ts` still passes (the field
   is a boolean either way). The semantic shift is verified by
   the new unit tests + the F0.5 E2E spec.

## References

- Producer iterate that surfaced the bug:
  `iterate-2026-05-26-campaign-C-C5-e2e-followup` (PR #73).
- Memory `feedback-e2e-wait-for-first-ws-ready-before-click`
  documents the test-side workaround that this iterate makes
  unnecessary in production.
- ADR-068-A1 (CLAUDE.md rule 19) — the contract whose semantics
  this iterate clarifies. Reference: `useAutoLaunch.ts:97-104`.
- Memory `project_resume_guard_remount_gap` — the iterate that
  introduced `ptyReused` for the reload guard
  (`fix-resume-guard-survives-reload`). The original intent was
  exactly the reload/multi-tab case; this iterate makes the
  signal match that intent.

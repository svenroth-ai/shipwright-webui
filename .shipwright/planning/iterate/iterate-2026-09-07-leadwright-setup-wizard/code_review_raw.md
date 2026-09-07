Stage-2 code-quality review (code-reviewer), leadwright lead-setup Intent
Wizard (W14, iterate-2026-09-07-leadwright-setup-wizard). Reconstructed from
this session's own record (raw agent reply was not durably saved before this
write — see reviews.json disposition note); the finding content below is
accurate to what was found and how each was resolved.

Run behind a Stage-1 (spec-reviewer) PASS, per the cascade's own ordering
rule.

## Findings (6 total)

1. **HIGH** — `VerdictStep.tsx` (the wizard's most complex component: builds
   the proposal, runs the verdict, auto-retries once on a 409 verdict_stale,
   renders 6+ conditional result branches) had zero test coverage.
   Disposition: FIXED. Added `VerdictStep.test.tsx` (10 tests) covering
   notConfigured / ranOk===false / enabled-Finish / findings-grouped-by-layer
   / committed+restart-notice / lead_exists / locked / daemon_config_missing
   / error, and the auto-retry-exactly-once-on-verdict_stale effect
   (including that a second verdict_stale render does NOT re-trigger
   refetch).

2. **MEDIUM** — `commit.test.ts` covered the symlink->403 mapping only via
   the daemon-config.json write's catch block (through a mocked
   `withOrgFileLockFn` throwing `OrgFileSymlinkEscapeError`); no test
   exercised `commitCore`'s FIRST catch block — the charter.md write's own
   symlink->403 mapping — at the route-core level (only unit-tested in
   isolation via `commit-writes.test.ts`'s `writeNewCharterFile` tests).
   Disposition: FIXED. Added a `commit.test.ts` case injecting a
   `writeCharterFn` that throws `OrgFileSymlinkEscapeError`, asserting the
   403 response AND that `withOrgFileLockFn` was never called (proving the
   short-circuit happens before any lock is taken).

3. **MEDIUM** — `assertNotSymlink` was duplicated: a private copy in
   `commit-writes.ts` (for the unlocked charter.md write) and the
   lock-internal one in `org-file-lock.ts` — the exact drift risk
   `org-file-lock.ts`'s own header comment warns about ("two independent
   copies of this exact logic").
   Disposition: FIXED. Exported `assertNotSymlink` and its `LstatFn` type
   from `org-file-lock.ts`; `commit-writes.ts` now imports both instead of
   redeclaring them. Verified via `tsc --noEmit` and the full
   `commit-writes.test.ts` / `commit.test.ts` / `org-file-lock.test.ts`
   suites.

4. **MEDIUM** — `AuthorityStep.tsx`'s `maxConcurrentTasks` field had no
   validation, unlike every other numeric field in the wizard
   (`BudgetStep.tsx`'s `isFraction`/`budgetValid` pattern) — a non-numeric
   or non-positive value would silently flow into
   `max_concurrent_tasks: Number(a.maxConcurrentTasks)` as `NaN` or a bad
   value.
   Disposition: FIXED. Added `isPositiveInteger()`, gated `canNext` on it,
   and added an inline `lead-wizard-max-concurrent-invalid` error message
   matching the `lead-wizard-hard-stop-invalid` idiom.

5. **LOW** — three near-identical `try/catch` blocks in `commit.ts` mapping
   `OrgFileSymlinkEscapeError`->403 and `ELOCKED`->409 across the three
   ordered writes.
   Disposition: NOT FIXED, per the reviewer's own explicit recommendation —
   "not worth the indirection for 3 uses with slightly different shapes".

6. **LOW** — `webuiBaseUrl` fallback hardcoded in two places.
   Disposition: NOT FIXED — reviewer noted it is unreachable in production;
   not flagged as needing a fix.

## Verdict

PASS to proceed to Stage 3 (doubt-reviewer), findings 1-4 fixed and
independently re-verified (tsc --noEmit clean, full server suite 4021/4021,
full client suite 3940/3940, E2E 3/3) before that spawn.

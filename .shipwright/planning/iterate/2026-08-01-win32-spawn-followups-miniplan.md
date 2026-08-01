# Mini-Plan: win32-spawn-followups

- **Run ID:** iterate-2026-08-01-win32-spawn-followups
- **Spec:** `.shipwright/planning/iterate/2026-08-01-win32-spawn-followups.md`
- **Type:** change (SIMPLIFY sub-mode) · **Complexity:** medium · **Spec Impact:** NONE

## Context a reviewer needs

Three cleanup debts deferred, deliberately and on the record, by PR #340
(`iterate-2026-07-31-win32-shell-spawn-remediation`). That PR replaced
`shell: true` with explicit PATHEXT + `cmd.exe /d /s /c` resolution on four
Windows command-invocation sites. Its "Out of Scope" section names these three
as follow-ups someone should decide deliberately.

The module at the centre, `server/src/core/preview-win32-spawn.ts`, is a
**security-load-bearing** surface (ADR-044, audit findings F03 + F31) guarded by
`server/src/core/preview-win32-resolve.test.ts`, which is marked **FROZEN —
MUST-NOT-MODIFY by the fixer** and encodes four security guards from review
rounds 2-3. It is mirrored, by necessity, into a **published** npm package
(`bootstrapper/lib/win32-spawn.mjs`; `files: ["lib/", …]`) because DO-NOT #7
forbids cross-package imports, with a drift guard at
`server/src/test/win32-spawn-mirror-parity.test.ts`.

## Files to create / modify

| # | File | Change |
|---|---|---|
| 1 | `server/src/core/win32-spawn.ts` | **new** — the resolver; returns `null` on an unresolvable BARE name; no `preview-session-manager` import |
| 2 | `server/src/core/preview-win32-spawn.ts` | **shrink** to a thin wrapper — re-export `splitWin32Command` + `ResolvedSpawn`; throw `PreviewProfileInvalidError` on `null` |
| 3 | `server/src/core/cli-compat.ts` | delete `probeClaudeVersionAsync`; import from `./win32-spawn.js` |
| 4 | `server/src/core/cli-compat.probe-spawn-async.test.ts` | **delete** — its subject is gone (11 tests) |
| 5 | `server/src/core/win32-spawn.test.ts` | **new** — path-flavour pins + the `null` contract |
| 6 | `server/src/test/win32-spawn-mirror-parity.test.ts` | re-point at the new original; assert the core imports no preview module |
| 7 | `server/src/test/no-shell-true-spawn.test.ts` | add `server/src/core/win32-spawn.ts` to `REMEDIATED` |
| 8 | `bootstrapper/lib/win32-spawn.mjs` | `path.win32` for the string decisions; correct the DIVERGENCES header + the stale `@returns` |
| 9 | `bootstrapper/test/win32-spawn.test.mjs` | tighten the loosened ComSpec assertions to the exact win32 string |
| 10 | `shipwright_bloat_baseline.json` | ratchet the `cli-compat.ts` entry **down** after the deletion |

## Work breakdown (sequential, TDD)

1. **Behavior-Snapshot** the green baseline (F-simplify Phase 1). Refuses a red
   start. Baseline measured: server **274 files / 3198 passed / 1 skipped**,
   bootstrapper **11 files / 153 passed**.
2. **Item 1 — delete the dead export.** Remove `probeClaudeVersionAsync` and its
   test file; ratchet `shipwright_bloat_baseline.json` down.
   *Test expectation:* `npm run typecheck` green; the **sync** probe suite
   `cli-compat.probe-spawn.test.ts` unmodified and still green.
3. **Item 2 — extract the core.** Create `win32-spawn.ts`; reduce
   `preview-win32-spawn.ts` to the throwing wrapper; re-point `cli-compat.ts`.
   *Test expectation:* the FROZEN `preview-win32-resolve.test.ts` passes
   **unmodified** — that is the proof the extraction preserved the preview path.
4. **Item 3 — flavour the path semantics.** Use `path.win32` for the pure-string
   decisions (`extname`, the ComSpec `join`) in both the server core and the
   mirror; keep the HOST `path` for fs-candidate construction, commented.
   *Test expectation:* new exact-string pins written RED-first, then green; each
   falsified by swapping `path.win32` back to `path.posix`.
5. **Re-point the guards.** Mirror-parity + no-shell-true; correct the mirror's
   DIVERGENCES header. *Test expectation:* both green; parity guard falsified by
   a deliberate bypass.
6. **Behavior-Verify** (Phase 3) + full suites + F0.5 (`surface = web`).

## Test strategy

- **New:** `server/src/core/win32-spawn.test.ts` — the `null` return contract,
  the exact ComSpec string (host-independent), and the fs-candidate limit.
- **Modified:** the two source-scan guards (re-point + widen);
  `bootstrapper/test/win32-spawn.test.mjs` (tighten two loosened assertions).
- **Deleted:** `cli-compat.probe-spawn-async.test.ts` — **11 tests**. This is a
  deliberate coverage *reduction* whose justification is that the code under
  test is deleted in the same commit. Net test count must still go **up**.
- **Untouched (load-bearing):** `preview-win32-resolve.test.ts` (FROZEN),
  `cli-compat.probe-spawn.test.ts`, `preview-session-manager.win32.test.ts`.
- **E2E / F0.5:** `surface = web` — real stack boot + `GET /api/diagnostics` +
  the Diagnostics screen in a real browser.

## Alternative approach (rejected)

**Rename the file, keep one module.** Rename `preview-win32-spawn.ts` →
`win32-spawn.ts`, keep the single throwing `resolveSpawn`, let `cli-compat.ts`
keep catching. **Rejected on substance, not aesthetics:** the throw is
`PreviewProfileInvalidError`, which lives in `preview-session-manager.ts`, so
one module must keep that import and the boot path keeps entering the preview
ESM cycle — the exact fragility PR #340 recorded as its third deferred item. It
also keeps exceptions as the control flow for a non-exceptional "not found".

**Also rejected — a `{throwOnUnresolved}` option flag.** One function, two
behaviours, chosen by a boolean each caller pins to an opposite constant
(constitution Karpathy #2, Simplicity First). The wrapper is the same branch
resolved at the module boundary, where a reader sees it.

## Risk / blast radius

- **Highest risk:** silently changing the preview spawn path (ADR-044 /
  DO-NOT #9). Mitigation: the FROZEN guard is not edited, and passing it
  unmodified is AC-3.
- **Second:** drifting the published mirror. Mitigation: the parity guard is
  re-pointed and falsified before it is trusted.
- **Third:** the deleted test file masking a real coverage loss. Mitigation:
  explicit before/after test-count reconciliation, stated in the ledger.

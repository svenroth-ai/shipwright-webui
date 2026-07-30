# Iterate ADR — D20 preview-child-lifecycle

- Run ID: `iterate-2026-07-10-preview-child-lifecycle`
- Campaign: `webui-deep-audit-2026-07-10` · Sub-iterate: `D20`
- Complexity: medium · Hardening: STANDARD
- Risk flags (classifier): `touches_io_boundary` (real); `touches_auth` (spurious keyword hit — no auth code)
- Depends on: D03 preview-win32-spawn (merged) · Blocks: D21 preview-config-validation

## Decision

Manage the Preview dev-server child's lifecycle end-to-end (audit F11/F12/F13):

1. **F11 drain** — `drainStdio(child)` attaches `data` listeners to
   stdout+stderr into a bounded 16KB char ring so a never-read OS pipe buffer
   can't backpressure-freeze the child; `.tail()` is attached to
   `PreviewExitedEarlyError` / `PreviewTimeoutError` as a diagnostic.
   `setEncoding("utf8")` decodes across chunk boundaries.
2. **F12 dedup** — an in-flight `Map<projectId,{hash,promise}>` in the manager.
   `spawn()` is a dedup wrapper over `doSpawn()`: same-profile concurrent
   spawns coalesce onto the pending promise; a different-profile one serializes
   (await the pending start, re-enter to respawn). `finally` clears the entry on
   rejection too (no poisoned retry).
3. **F13 tree-kill + await-exit** — `treeKill(child, sig, deps)`: win32
   `taskkill /pid <pid> /t /f` (`shell:false`), POSIX `process.kill(-pid, sig)`
   group signal (child spawned `detached` so it leads its own group). Used by
   `killAll()`, the profile-change respawn, AND the transient in-spawn cleanup.
   `awaitExit(child, ms)` makes the respawn wait for the old child to release
   its port before the new probe.

New cohesive module `server/src/core/preview-child-lifecycle.ts` holds the
lifecycle helpers + the port/readiness probes (moved verbatim), because
`preview-session-manager.ts` is at its 393-line bloat baseline. New tests in
`preview-child-lifecycle.test.ts`. This expands the spec's 2-file footprint per
the campaign guardrail (existing files at bloat baseline → new cohesive files
mandated; anti-ratchet forbids growing them). Serial ordering (D20→D21) means
no parallel collision.

Preserved D03/ADR-044 invariants: `shell:false` on every path, the win32
`resolveSpawn` cmd.exe wrapper + PATHEXT resolution, single-spawn-path.

## AC2 — RED-first evidence

Neutralizing each fix (seams kept) and running `preview-child-lifecycle.test.ts`:
6 manager regressions FAIL (F11 drain-listener, F11 tail-in-error, F12 dedup,
F12 different-profile-serialize, F13 killAll group-kill, F13 respawn-awaits-exit);
10 helper unit tests pass. Restoring the fix → 16/16 green.

## Self-Review (7-item)

1. **Spec Compliance** — pass. F11/F12/F13 implemented within footprint (+2
   cohesive files per guardrail); D03 invariants preserved.
2. **Error Handling** — pass. `treeKill` try/catch → fallback kill (swallows
   ESRCH on an already-dead group); `awaitExit` bounded timeout; in-flight
   `finally` clears on rejection; spawn ENOENT/error paths unchanged.
3. **Security Basics** — pass. `shell:false` everywhere incl. the `taskkill`
   spawn (discrete argv); probes host-locked to 127.0.0.1 (moved verbatim);
   env still drops `CLAUDE_*`/`SHIPWRIGHT_*`.
4. **Test Quality** — pass. 16 tests; RED-first proven; injected
   platform/processKill/killSpawn seams keep real `taskkill`/`process.kill` off
   the host.
5. **Performance Basics** — pass. Bounded 16KB ring; `setEncoding` avoids
   buffer re-decode churn; no new polling.
6. **Naming & Structure** — pass. Cohesive module; manager stays ≤393; DRY
   `opts()` helper in tests.
7. **Affected Boundaries (ADR-024)** — pass. The boundary is the child-process
   stdio pipe + OS process group (not a serialized on-disk format). Producer =
   webui spawn; consumer = OS/child + the route layer. Empirical round-trip
   probes: drain-listener attach, tail capture round-trips through the error,
   tree-kill signal reaches the injected group-kill seam. The route layer
   consumes `.code`/`.seconds`/`.tail` — `.tail` is additive, non-breaking.

## Confidence Calibration (touches_io_boundary)

Boundaries + empirical probes:
- **stdio pipe (F11)** — probe: `data` listener attached to stdout+stderr
  (`listenerCount ≥ 1`) + emitted stderr round-trips into `error.tail`. Finding:
  pre-fix 0 listeners / empty tail (RED); post-fix works.
- **process group / tree-kill (F13)** — probe: POSIX `-pid` group signal +
  win32 `taskkill /t /f` argv asserted through the injected seam; throw →
  fallback-kill asserted. Finding: pre-fix only the direct child signalled
  (RED); post-fix group-kill.
- **concurrent spawn (F12)** — probe: `Promise.all` same-profile coalesce +
  different-profile serialize/tree-kill. Finding: pre-fix double-spawn / orphan
  (RED); post-fix single child / serialized.

Asymptote: each probe found the pre-fix defect → fix → re-probe green; two
consecutive clean runs (preview subset + full server suite) with no new
findings → calibrated. **Edge not probed:** a real cross-process
`taskkill`/`process.kill(-pid)` against a live OS group — unit tests must not
spawn/kill real host process groups. Acceptable: the platform seam is
unit-verified and the real spawn path is unchanged from D03; no frontend change
so the browser gate does not apply.

## External-Plan-Review-Findings

| # | Provider | Sev | Finding | Disposition |
|---|----------|-----|---------|-------------|
| 1 | openai/gemini | high | New `preview-child-lifecycle.ts` violates the spec's 2-file footprint | rejected-with-reason — campaign guardrail supersedes: manager at 393 bloat baseline, anti-ratchet forbids growth, new cohesive file mandated; serial D20→D21 = no collision |
| 2 | openai | high | Dedup key underspecified for mismatched concurrent requests | accepted-and-verified — coalesce is gated on `inflight.hash === profileHash`; different-profile now serializes (also code-review #3) |
| 3 | gemini | high | `detached` + direct `child.kill` in transient cleanup orphans the group | accepted-and-fixed — transient cleanup routed through `treeKill` |
| 4 | gemini | med | POSIX `kill(-pid)` throws ESRCH on an exited group | accepted-and-verified — wrapped in try/catch → fallback kill |
| 5 | gemini | med | Rejected in-flight promise could poison future spawns | accepted-and-verified — `finally` deletes the entry on rejection; +regression test |
| 6 | gemini | low | Multi-byte UTF-8 split across chunks → substitution char in tail | accepted-and-fixed — `setEncoding("utf8")` on both streams |

## External-Code-Review-Findings

| # | Provider | Sev | Finding | Disposition |
|---|----------|-----|---------|-------------|
| 1 | openai | med | New test file outside footprint (AC4) | rejected-with-reason — existing test file at 341 bloat baseline; new cohesive test file mandated (same as plan #1) |
| 2 | openai | med | `detached` keyed off `process.platform`, not the injected platform seam | accepted-and-fixed — `detached: (this.lifecycle.platform ?? process.platform) !== "win32"` |
| 3 | openai/gemini | med | Different-profile concurrent spawn double-spawns + orphans the old child | accepted-and-fixed — serialize by projectId then respawn; +regression test |
| 4 | openai | med | Early-exit tail test doesn't robustly prove reproduction; no timeout-path tail test | partially-accepted — exit-path assertion captures the rejection once (type + tail on one object); timeout shares the identical `drained.tail()` call site (verified), so a separate test is redundant under the LOC ceiling |

## Internal code-reviewer

`reviews.code: delegated_to_orchestrator` — the runner has no Agent tool; the
campaign orchestrator spawns the spec-reviewer→code-reviewer cascade over the
diff and merges findings back here.

### Deferred follow-ups (LOW, from the internal code-reviewer — NOT fixed in D20)

- **POSIX treeKill has no SIGKILL escalation.** A group that ignores SIGTERM is
  left running; win32 `taskkill /F` is force, so the no-orphan guarantee is
  platform-asymmetric. Deferred: a bounded SIGTERM→(await)→SIGKILL escalation
  is its own iterate (needs a grace timer + a second signal path).
- **Pre-existing killAll-during-in-flight-spawn race.** A `killAll()` that fires
  while a `spawn()` is mid-flight can't reach the not-yet-cached child; the new
  `inFlight` map now makes that child reachable, so a future iterate could have
  `killAll()` also drain/await in-flight promises. Deferred (pre-existing, LOW).

## Diff-coverage remediation (post-review)

The hard diff-coverage gate (80% fail-under) failed at 71% total —
`preview-child-lifecycle.ts` at 60.6% because the moved port/readiness probes
(`defaultProbePort`/`buildReadyUrl`/`defaultProbeReady`) and the `treeKill`
win32/fallback edges + `drainStdio` setEncoding branch were exercised only
indirectly. Added `preview-child-lifecycle.branches.test.ts` (19 tests, 210 LOC)
covering each: module → 100% lines / 92% branch (scoped `--coverage.include`).
No production change (every listed line was reachable-as-written).

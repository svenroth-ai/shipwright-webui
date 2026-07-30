# Mini-Plan — D20 preview-child-lifecycle

Run ID: iterate-2026-07-10-preview-child-lifecycle
Complexity: medium · Hardening: STANDARD · Campaign: webui-deep-audit-2026-07-10

## Problem

`server/src/core/preview-session-manager.ts` manages the Preview dev-server
child, but its process lifecycle is unmanaged in three ways (audit F11/F12/F13):

- **F11** — child stdout/stderr are `stdio: "pipe"` but never consumed. A
  never-read OS pipe buffer (~64KB) fills and backpressure-freezes any
  line-buffered dev server (uvicorn/flask/rails per user-authored profiles);
  boot output >64KB can trigger a false `preview_timeout`; diagnostics are lost.
- **F12** — concurrent `spawn()` for the same project has no in-flight dedup.
  Two browser tabs (a supported workflow) clicking Preview inside the dev
  server's ~1-3s startup window both pass the `get()` cache check (neither has
  cached yet) → double-spawn → the second child is an untracked orphan
  `killAll()` can never reach.
- **F13** — `killAll()` / profile-change respawn only `SIGTERM` the direct
  child. `npm run dev` makes npm the direct child; the real server is a
  grandchild that survives. Respawn also probes the port immediately after
  kill, before the old child releases it.

## Fix direction (within footprint)

New cohesive module `preview-child-lifecycle.ts` (manager is at its 393 bloat
ceiling):

- `drainStdio(child)` — attach `data` listeners to stdout+stderr into a bounded
  16KB ring; expose `.tail()` as diagnostic for early-exit/timeout errors (F11).
- `treeKill(child, sig, deps)` — win32 `taskkill /pid <pid> /t /f`
  (`shell:false`); POSIX `process.kill(-pid, sig)` group signal (child spawned
  `detached` so it leads its own group). Test seams: `platform`, `processKill`,
  `killSpawn` (F13).
- `awaitExit(child, timeoutMs)` — resolve on `exit` or bounded timeout, so the
  respawn waits for the old child to release its port before the new probe (F13).
- In-flight `Map<projectId,{hash,promise}>` in the manager — `spawn()` becomes a
  dedup wrapper over `doSpawn()`; a concurrent same-profile spawn coalesces onto
  the first promise (F12).
- Moved the port/readiness probes into the new module to keep the manager under
  its ceiling (no behavior change).

Preserved D03 invariants: `shell:false`, the win32 `resolveSpawn` cmd.exe
wrapper + PATHEXT resolution, and ADR-044's single-spawn-path.

## Tests (TDD)

New `preview-child-lifecycle.test.ts`: helper unit tests + 5 manager-level
regressions (F11 drain-listener + tail-in-error, F12 concurrent-dedup, F13
killAll group-kill + respawn-awaits-exit). RED-first proven by neutralizing each
fix behavior (seams kept) — 5 fail; restored — 15 pass.

## Non-goals

- No per-session stop/teardown route (noted as a future follow-up, out of scope).
- Transient in-spawn error-cleanup kill left as a direct `child.kill` (finding
  scope is killAll + respawn only; surgical).

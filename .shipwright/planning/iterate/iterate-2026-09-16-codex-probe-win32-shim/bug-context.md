# Bug fix context: codex_cli_not_found on Windows

**Complexity:** small (no iterate spec file at this tier; this is the spec context for external review).

## Bug report

`POST /launch` for a Codex-runtime task fails with `codex_cli_not_found` on
Windows even when Codex CLI is genuinely installed and working.

## Root cause

`isCodexCliAvailable()` (`server/src/external/launch/runtime-chokepoint.ts`)
called `defaultRun('codex', ['--version'])`
(`server/src/core/readiness-probe-run.ts`), which spawns via `execFile` with
`shell:false`. `defaultRun` is documented as built only for genuine `.exe`
tools (uv, python, git); `codex` on Windows installs as a `.cmd` shim (no
`codex.exe`), which `execFile` cannot resolve without a shell, so it throws
ENOENT and the probe unconditionally reports "not found". Reproduced directly
(standalone `execFile('codex', ['--version'], ...)` → `spawn codex ENOENT`).

`probeReadiness()`'s `/api/readiness` codex readiness-card hint
(`server/src/core/readiness-probe.ts`) shares the exact same
`defaultRun('codex', ...)` call via its generic `run` seam, so it has the
identical bug.

## Fix

Route both call sites through the existing, already-reviewed
`server/src/core/win32-spawn.ts`'s `resolveSpawn(argv, cwd)` (ADR-044) instead
of `defaultRun` — the same mechanism already used to resolve `.cmd`/`.bat`
shims (claude/npm/gh) elsewhere in this codebase.

A new sibling function, `defaultRunShim`, was added next to `defaultRun` in
`readiness-probe-run.ts` rather than modifying `defaultRun` itself, because
`defaultRun`'s win32 branch is load-bearing for a *different*, already-tested
fix: it hands `execFile` a `probeEnv`-augmented `env` so a
`~/.local/bin`-only `uv` install is still found (iterate-2026-08-23).
`resolveSpawn` has no `env` parameter (it reads the real `process.env.PATH`
only), so routing `defaultRun` itself through it would silently regress that
augmented-PATH lookup for uv/python/git. `codex` has no such augmented-PATH
need (its installer puts the shim straight on PATH), so `defaultRunShim` can
call `resolveSpawn` unconditionally on win32 with no such risk.

- `isCodexCliAvailable()` now calls `defaultRunShim` instead of `defaultRun`.
- `probeReadiness()` now defaults its codex arm's run function to
  `defaultRunShim` (`runCodex = deps.run ?? defaultRunShim`), while uv/python/
  git keep `defaultRun` unchanged. An injected `deps.run` test seam still
  governs both arms identically, preserving existing test behavior.
- POSIX is an unaffected pass-through (`execvp` already resolves a shim
  script by bare name).

## Tests added

- `readiness-probe-run.test.ts`: `defaultRunShim` resolves and runs a real
  `.cmd` PATH shim (proving both the regression against unmodified
  `defaultRun` AND the fix, on an actual Windows host), still runs a real
  `.exe`, reports not-found without throwing, and is a pass-through on POSIX.
- `runtime-chokepoint.test.ts`: `isCodexCliAvailable()` (the real, unmocked
  function) finds and runs a real `.cmd` Codex shim on PATH.

Full server test suite (4295 tests) passes; `tsc --noEmit` and `oxlint` are
clean (pre-existing warnings only, unrelated to this diff).
